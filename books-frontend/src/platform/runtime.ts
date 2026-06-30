/** Runtime helpers for the web app. */

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}
