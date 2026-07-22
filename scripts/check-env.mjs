/**
 * check-env.mjs — pre-deploy / CI guard for required configuration.
 *
 *   yarn check:env          # validate everything, exit 1 on any failure
 *
 * Checks (no secret VALUES are ever printed):
 *   1. apphosting.yaml declares every NEXT_PUBLIC_* variable the frontend
 *      build needs, with non-empty values (Next inlines them at build time —
 *      a missing one ships a silently broken bundle).
 *   2. Every secret declared in functions/src/secrets.ts exists in Cloud
 *      Secret Manager for the active project (via `firebase functions:secrets:access`,
 *      existence by exit code only). Skipped with --no-secrets or when the
 *      firebase CLI isn't authenticated.
 *   3. PUBLIC_APP_URL is among the configured values (Stripe redirects are
 *      built from it; the backend hard-fails checkout without it).
 *
 * Run automatically by `yarn deploy` (scripts/deploy.mjs). In CI:
 *   node scripts/check-env.mjs --no-secrets   # config-file checks only
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { secretNames, projectId, readEnvLocal } from "./set-secrets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = new Set(process.argv.slice(2));
const SKIP_SECRETS = ARGS.has("--no-secrets");

const failures = [];
const warnings = [];
const ok = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.error(`  ❌ ${msg}`);
};
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`  ⚠️  ${msg}`);
};

// ---- 1. Frontend build-time env (apphosting.yaml) ---------------------------

const REQUIRED_FRONTEND_VARS = [
  "NEXT_PUBLIC_BACKEND_URL",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];

console.log("\n▶ Frontend env (apphosting.yaml)");
const appHostingPath = join(ROOT, "apphosting.yaml");
if (!existsSync(appHostingPath)) {
  fail("apphosting.yaml is missing — App Hosting builds will have NO env vars.");
} else {
  const yaml = readFileSync(appHostingPath, "utf8");
  // Minimal parse: `- variable: NAME` followed by a `value: "…"` line.
  const declared = new Map();
  const re = /-\s*variable:\s*([A-Z0-9_]+)\s*\n\s*value:\s*["']?([^"'\n]*)["']?/g;
  for (const m of yaml.matchAll(re)) declared.set(m[1], m[2].trim());
  for (const name of REQUIRED_FRONTEND_VARS) {
    const value = declared.get(name);
    if (value === undefined) fail(`${name} is not declared in apphosting.yaml.`);
    else if (!value) fail(`${name} is declared but empty in apphosting.yaml.`);
    else ok(`${name} is set.`);
  }
  const emu = declared.get("NEXT_PUBLIC_USE_FIREBASE_EMULATORS");
  if (emu && emu !== "false") fail(`NEXT_PUBLIC_USE_FIREBASE_EMULATORS is "${emu}" — production must be "false".`);
}

// ---- 2 + 3. Backend secrets (Cloud Secret Manager) --------------------------

const PROJECT = projectId();
console.log(`\n▶ Backend secrets (project ${PROJECT})`);

/** Non-placeholder values in functions/.env.local (emulator source of truth). */
const envLocal = readEnvLocal();
const isPlaceholder = (v) => !v || /^(your[-_]|xxx|todo|changeme|<)/i.test(v);

let names = [];
try {
  names = secretNames();
} catch (err) {
  fail(String(err?.message ?? err));
}

if (SKIP_SECRETS) {
  console.log("  (skipping Secret Manager lookups — --no-secrets)");
} else if (names.length > 0) {
  for (const name of names) {
    const r = spawnSync(
      "npx",
      ["--no-install", "firebase", "functions:secrets:access", name, "--project", PROJECT],
      { cwd: ROOT, stdio: "ignore", shell: false },
    );
    if (r.status === 0) {
      ok(`${name} exists in Secret Manager.`);
    } else if (!isPlaceholder(envLocal[name])) {
      warn(`${name} is missing in Secret Manager (a local value exists — run \`yarn setSecrets\`).`);
    } else {
      warn(`${name} is not set in Secret Manager (features depending on it will be disabled).`);
    }
  }
}

// PUBLIC_APP_URL is critical: the backend refuses to build Stripe redirects
// without it, so every checkout would 500 in production.
if (!SKIP_SECRETS) {
  const r = spawnSync(
    "npx",
    ["--no-install", "firebase", "functions:secrets:access", "PUBLIC_APP_URL", "--project", PROJECT],
    { cwd: ROOT, stdio: "ignore", shell: false },
  );
  const inSecrets = r.status === 0;
  const inEnvFile = existsSync(join(ROOT, `functions/.env.${PROJECT}`))
    ? /^\s*PUBLIC_APP_URL\s*=\s*\S+/m.test(readFileSync(join(ROOT, `functions/.env.${PROJECT}`), "utf8"))
    : false;
  if (inSecrets || inEnvFile) ok("PUBLIC_APP_URL is configured (Stripe redirects will work).");
  else fail(`PUBLIC_APP_URL is configured NEITHER in Secret Manager nor functions/.env.${PROJECT} — every checkout will fail.`);
}

// ---- Result -----------------------------------------------------------------

console.log("");
if (failures.length > 0) {
  console.error(`✖ Environment check failed (${failures.length} problem${failures.length === 1 ? "" : "s"}).`);
  process.exit(1);
}
console.log(
  warnings.length > 0
    ? `✔ Environment check passed with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`
    : "✔ Environment check passed.",
);
