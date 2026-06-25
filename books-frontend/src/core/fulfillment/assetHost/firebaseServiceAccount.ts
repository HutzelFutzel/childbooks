/**
 * Firebase Storage asset host authenticated with a SERVICE ACCOUNT (admin key),
 * implemented for the desktop client without `firebase-admin` (which is Node-only
 * and can't run in the webview).
 *
 * Flow (all crypto via Web Crypto, all network via Tauri's fetch which bypasses
 * CORS):
 *   1. Sign a JWT with the service-account private key (RS256).
 *   2. Exchange it at Google's OAuth2 token endpoint for an access token
 *      (cached until it nears expiry).
 *   3. Upload the file to the GCS JSON API (multipart) with a generated
 *      `firebaseStorageDownloadTokens` metadata value.
 *   4. Return the Firebase-style tokenized download URL — public and fetchable
 *      by Lulu, with no signed-URL math and without making the bucket public.
 *
 * ⚠️ SECURITY: embedding a service-account key in a client app grants full admin
 * access to your Firebase project to anyone who can read the bundle. This is for
 * PRIVATE/personal builds only. Move this to a backend (Admin SDK) before
 * distributing the app.
 */
import { httpFetch } from "../../../platform/http";
import { FulfillmentError, fulfillmentKindFromStatus } from "../errors";
import type { AssetHost, UploadedAsset } from "../types";

export interface FirebaseServiceAccountConfig {
  /** Service-account email (`client_email` in the JSON). */
  clientEmail: string;
  /** PEM private key (`private_key` in the JSON), real newlines. */
  privateKey: string;
  /** Storage bucket, e.g. "your-project.appspot.com". */
  storageBucket: string;
}

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ASSET_PREFIX = "print-assets";

function base64UrlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}

/** Decode a PEM (PKCS#8) private key to its DER bytes. */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function objectPath(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${ASSET_PREFIX}/${stamp}-${safe || "asset"}`;
}

function newToken(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `tok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createFirebaseServiceAccountAssetHost(
  config: FirebaseServiceAccountConfig,
): AssetHost {
  if (!config.clientEmail || !config.privateKey || !config.storageBucket) {
    return {
      id: "firebase-sa",
      async upload(): Promise<never> {
        throw new FulfillmentError(
          "Firebase service account is not configured. Set VITE_FIREBASE_CLIENT_EMAIL, " +
            "VITE_FIREBASE_PRIVATE_KEY and VITE_FIREBASE_STORAGE_BUCKET in your .env.",
          { kind: "config" },
        );
      },
    };
  }

  let keyPromise: Promise<CryptoKey> | null = null;
  let cachedToken: { value: string; expiresAt: number } | null = null;

  function importKey(): Promise<CryptoKey> {
    if (!keyPromise) {
      keyPromise = crypto.subtle.importKey(
        "pkcs8",
        pemToDer(config.privateKey),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
    }
    return keyPromise;
  }

  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;

    const key = await importKey();
    const iat = Math.floor(now / 1000);
    const claims = {
      iss: config.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat,
      exp: iat + 3600,
    };
    const signingInput = `${base64UrlFromString(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
    )}.${base64UrlFromString(JSON.stringify(claims))}`;

    let signature: ArrayBuffer;
    try {
      signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        key,
        new TextEncoder().encode(signingInput),
      );
    } catch (err) {
      throw new FulfillmentError("Could not sign the service-account JWT (bad private key?).", {
        kind: "config",
        cause: err,
      });
    }
    const jwt = `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;

    let res: Response;
    try {
      res = await httpFetch(TOKEN_URI, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=${encodeURIComponent(JWT_BEARER)}&assertion=${encodeURIComponent(jwt)}`,
      });
    } catch (err) {
      throw new FulfillmentError("Network request to Google token endpoint failed.", {
        kind: "network",
        cause: err,
      });
    }
    if (!res.ok) {
      let details = "";
      try {
        details = await res.text();
      } catch {
        /* ignore */
      }
      throw new FulfillmentError(`Google token request failed with status ${res.status}.`, {
        kind: fulfillmentKindFromStatus(res.status),
        status: res.status,
        details,
      });
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new FulfillmentError("Google token response had no access token.", { kind: "auth" });
    }
    cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
    return cachedToken.value;
  }

  return {
    id: "firebase-sa",
    async upload(blob: Blob, name: string): Promise<UploadedAsset> {
      const token = await getAccessToken();
      const path = objectPath(name);
      const downloadToken = newToken();

      const boundary = `cb-${Math.random().toString(36).slice(2)}`;
      const metadata = JSON.stringify({
        name: path,
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      });
      const preamble =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${metadata}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`;
      const epilogue = `\r\n--${boundary}--`;
      const body = new Blob([preamble, blob, epilogue], {
        type: `multipart/related; boundary=${boundary}`,
      });

      const uploadUrl =
        `https://storage.googleapis.com/upload/storage/v1/b/` +
        `${encodeURIComponent(config.storageBucket)}/o?uploadType=multipart`;

      let res: Response;
      try {
        res = await httpFetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        });
      } catch (err) {
        throw new FulfillmentError("Failed to upload asset to Firebase Storage.", {
          kind: "upload",
          cause: err,
        });
      }
      if (!res.ok) {
        let details = "";
        try {
          details = await res.text();
        } catch {
          /* ignore */
        }
        throw new FulfillmentError(`Asset upload failed with status ${res.status}.`, {
          kind: fulfillmentKindFromStatus(res.status),
          status: res.status,
          details,
        });
      }

      const url =
        `https://firebasestorage.googleapis.com/v0/b/` +
        `${encodeURIComponent(config.storageBucket)}/o/` +
        `${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
      return { url };
    },
  };
}
