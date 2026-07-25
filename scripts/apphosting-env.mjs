/**
 * apphosting-env.mjs — read the frontend's build-time env out of apphosting.yaml.
 *
 *   node scripts/apphosting-env.mjs >> "$GITHUB_ENV"
 *
 * App Hosting applies `apphosting.yaml`'s `env:` block when it builds the
 * Next.js app, but nothing else does — a plain `yarn build:web` (CI, the deploy
 * pipeline's pre-flight build) runs with none of it. Since NEXT_PUBLIC_* values
 * are inlined at build time, that build isn't the same build production gets,
 * and it fails on anything the app requires at build time. Printing the vars as
 * `NAME=value` lines lets CI feed them straight into `$GITHUB_ENV` so the check
 * builds exactly what App Hosting will, from the one file that defines it.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const APP_HOSTING_PATH = join(ROOT, "apphosting.yaml");

/**
 * The `env:` entries of apphosting.yaml as a `Map<name, value>`. Minimal parse
 * (`- variable: NAME` followed by a `value:` line) — enough for the flat,
 * string-valued config we keep there, and it avoids a YAML dependency in a
 * script that has to run before `yarn install` would matter.
 *
 * Returns an empty map when the file is missing; callers that care (see
 * `check-env.mjs`) report that as a failure.
 */
export function appHostingEnv() {
  if (!existsSync(APP_HOSTING_PATH)) return new Map();
  const yaml = readFileSync(APP_HOSTING_PATH, "utf8");
  const re = /-\s*variable:\s*([A-Z0-9_]+)\s*\n\s*value:\s*["']?([^"'\n]*)["']?/g;
  const declared = new Map();
  for (const m of yaml.matchAll(re)) declared.set(m[1], m[2].trim());
  return declared;
}

// Run directly: emit `NAME=value` lines. Values containing a newline would
// corrupt `$GITHUB_ENV`, and the parse above can't produce one anyway, so this
// stays a plain join.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [name, value] of appHostingEnv()) console.log(`${name}=${value}`);
}
