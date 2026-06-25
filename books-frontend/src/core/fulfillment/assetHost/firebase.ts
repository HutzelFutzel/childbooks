/**
 * Firebase Storage asset host (Firebase Web SDK).
 *
 * Uploads each print-ready file to Firebase Storage and returns the public,
 * tokenized download URL (`getDownloadURL`) that Lulu's servers can fetch.
 *
 * IMPORTANT — this is the CLIENT (Web SDK) path, configured with your Firebase
 * *web app config* (apiKey, projectId, storageBucket, …). That config is NOT a
 * secret: the Web SDK is designed to ship in client apps, and access is gated
 * by Firebase Storage *security rules*, not by hiding these values. A *service
 * account* (a private-key JSON) is a different thing entirely — it grants admin
 * access and must ONLY ever live on a server (the Admin SDK), never in this
 * desktop bundle. See `.env.example` for where each value goes.
 *
 * For dev with no auth, open the Storage rules to allow unauthenticated writes
 * (see the setup notes). Lock them down before launch.
 */
import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { FulfillmentError } from "../errors";
import type { AssetHost, UploadedAsset } from "../types";

export interface FirebaseAssetHostConfig {
  apiKey: string;
  projectId: string;
  storageBucket: string;
  authDomain?: string;
  appId?: string;
  messagingSenderId?: string;
}

/** Dedicated Firebase app name so we never clobber any other app instance. */
const APP_NAME = "childbooks-assets";

/** Folder prefix within the bucket for uploaded print assets. */
const ASSET_PREFIX = "print-assets";

/** Make a unique, storage-safe object path from a desired name. */
function objectPath(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${ASSET_PREFIX}/${stamp}-${safe || "asset"}`;
}

export function createFirebaseStorageAssetHost(config: FirebaseAssetHostConfig): AssetHost {
  if (!config.apiKey || !config.storageBucket || !config.projectId) {
    return {
      id: "firebase",
      async upload(): Promise<never> {
        throw new FulfillmentError(
          "Firebase Storage is not configured. Set VITE_FIREBASE_API_KEY, " +
            "VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_STORAGE_BUCKET in your .env.",
          { kind: "config" },
        );
      },
    };
  }

  const options: FirebaseOptions = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    authDomain: config.authDomain,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
  };
  const app = getApps().find((a) => a.name === APP_NAME) ?? initializeApp(options, APP_NAME);
  const storage = getStorage(app);

  return {
    id: "firebase",
    async upload(blob: Blob, name: string): Promise<UploadedAsset> {
      const fileRef = ref(storage, objectPath(name));
      try {
        await uploadBytes(fileRef, blob, {
          contentType: blob.type || "application/octet-stream",
        });
        const url = await getDownloadURL(fileRef);
        return { url };
      } catch (err) {
        throw new FulfillmentError("Failed to upload asset to Firebase Storage.", {
          kind: "upload",
          cause: err,
        });
      }
    },
  };
}
