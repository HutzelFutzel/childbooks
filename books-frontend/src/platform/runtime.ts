/**
 * Runtime detection. The same JS bundle runs both in a plain browser and
 * inside the Tauri webview; these helpers let the platform adapters branch.
 */

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export function isBrowser(): boolean {
  return typeof window !== "undefined" && !isTauri();
}

export function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}
