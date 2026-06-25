/**
 * Picks the right storage backend for the current runtime and exposes a
 * single accessor used by the repositories / stores.
 */
import type { StorageBackend } from "../core/storage/types";
import { isTauri } from "./runtime";

let backendPromise: Promise<StorageBackend> | null = null;

export function getStorage(): Promise<StorageBackend> {
  if (!backendPromise) {
    backendPromise = (async () => {
      if (isTauri()) {
        const { tauriStorage } = await import("./storage-tauri");
        return tauriStorage;
      }
      const { webStorage } = await import("./storage-web");
      return webStorage;
    })();
  }
  return backendPromise;
}
