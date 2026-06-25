/**
 * Generic HTTP-PUT asset host (no backend required).
 *
 * Uploads each blob with a single `PUT {uploadBaseUrl}/{key}` and returns the
 * corresponding `{publicBaseUrl}/{key}` URL for the provider to fetch. This works
 * with any object store / file gateway that accepts an authenticated PUT and
 * serves the object publicly — e.g. an S3/R2 bucket fronted by a pre-shared
 * token, or a simple file server.
 *
 * Secrets (the auth header) live in local app settings for now. When a backend
 * is added, swap this for a host that asks the backend for a signed URL — the
 * {@link AssetHost} interface and all callers stay the same.
 */
import { httpFetch } from "../../../platform/http";
import { FulfillmentError, fulfillmentKindFromStatus } from "../errors";
import type { AssetHost, UploadedAsset } from "../types";

export interface HttpPutAssetHostConfig {
  /** Base URL files are PUT to, e.g. "https://uploads.example.com/childbooks". */
  uploadBaseUrl: string;
  /** Public base URL the same files are served from (often equal to uploadBaseUrl). */
  publicBaseUrl: string;
  /** Optional Authorization header value for the PUT (e.g. "Bearer …"). */
  authHeader?: string;
}

function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/** Make a unique, filesystem/URL-safe object key from a desired name. */
function objectKey(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${stamp}-${safe || "asset"}`;
}

export function createHttpPutAssetHost(config: HttpPutAssetHostConfig): AssetHost {
  if (!config.uploadBaseUrl || !config.publicBaseUrl) {
    return {
      id: "httpPut",
      async upload(): Promise<never> {
        throw new FulfillmentError(
          "Asset host is misconfigured: uploadBaseUrl and publicBaseUrl are required.",
          { kind: "config" },
        );
      },
    };
  }

  return {
    id: "httpPut",
    async upload(blob: Blob, name: string): Promise<UploadedAsset> {
      const key = objectKey(name);
      const headers: Record<string, string> = {
        "Content-Type": blob.type || "application/octet-stream",
      };
      if (config.authHeader) headers.Authorization = config.authHeader;

      let res: Response;
      try {
        res = await httpFetch(joinUrl(config.uploadBaseUrl, key), {
          method: "PUT",
          headers,
          body: blob,
        });
      } catch (err) {
        throw new FulfillmentError("Failed to upload print asset.", {
          kind: "upload",
          cause: err,
        });
      }
      if (!res.ok) {
        throw new FulfillmentError(`Asset upload failed with status ${res.status}.`, {
          kind: fulfillmentKindFromStatus(res.status),
          status: res.status,
        });
      }
      return { url: joinUrl(config.publicBaseUrl, key) };
    },
  };
}
