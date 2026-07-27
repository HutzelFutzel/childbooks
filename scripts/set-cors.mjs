/**
 * set-cors.mjs — apply (and verify) the Storage bucket's CORS policy.
 *
 *   yarn setCors             # apply cors.json to the bucket, then verify
 *   yarn setCors:check       # verify only (no credentials needed), exit 1 on failure
 *   node scripts/set-cors.mjs --if-needed   # apply only when the probe fails
 *   node scripts/set-cors.mjs --dry-run     # print what it would do
 *
 * Why this exists: the browser downloads every generated image with
 * `getBlob()` (an XHR against firebasestorage.googleapis.com), so the BUCKET
 * must allow the app's origin. That's a bucket property — it is NOT covered by
 * `firebase deploy --only storage`, which deploys storage RULES. Without it the
 * studio looks like it generated nothing: the version node exists, Sparks are
 * spent, the object is in the bucket, and every tile stays blank.
 *
 * Verification is a plain CORS preflight, so it needs no credentials and works
 * in CI: an unconfigured bucket answers 200 with no `access-control-allow-*`
 * headers, a configured one echoes the origin back. The probe also requests the
 * `authorization` header the Firebase SDK sends, so a config that forgets it in
 * `responseHeader` (and would therefore still fail in the browser) is caught.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appHostingEnv } from "./apphosting-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORS_PATH = join(ROOT, "cors.json");

/** The bucket the CLIENT reads — the only one whose CORS matters. */
export function storageBucket() {
  const declared = appHostingEnv().get("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (declared) return declared;
  try {
    const env = readFileSync(join(ROOT, "books-frontend/.env"), "utf8");
    const m = env.match(/^\s*NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET\s*=\s*(\S+)/m);
    if (m) return m[1];
  } catch {
    /* fall through to the derived name */
  }
  try {
    const rc = JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8"));
    return `${rc.projects?.default ?? "childbook-60f89"}.firebasestorage.app`;
  } catch {
    return "childbook-60f89.firebasestorage.app";
  }
}

/** Origins declared in cors.json (across all rules). */
export function corsOrigins() {
  const rules = JSON.parse(readFileSync(CORS_PATH, "utf8"));
  return [...new Set(rules.flatMap((r) => r.origin ?? []))].filter((o) => o !== "*");
}

/**
 * Ask the bucket whether `origin` may issue an authenticated GET. Resolves to
 * the echoed `access-control-allow-origin` value, or null when the bucket has
 * no matching rule (which is exactly what a browser sees as a CORS block).
 */
export async function probeOrigin(bucket, origin, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://storage.googleapis.com/${bucket}/cors-probe`, {
      method: "OPTIONS",
      signal: ctrl.signal,
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    return res.headers.get("access-control-allow-origin");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when every origin in cors.json is allowed by the live bucket policy. */
export async function corsIsApplied(bucket, origins = corsOrigins()) {
  const results = await Promise.all(
    origins.map(async (origin) => ({ origin, allowed: Boolean(await probeOrigin(bucket, origin)) })),
  );
  return { ok: results.every((r) => r.allowed), results };
}

function applyCors(bucket, { dryRun }) {
  const cmd = "gcloud";
  const args = ["storage", "buckets", "update", `gs://${bucket}`, `--cors-file=${CORS_PATH}`];
  console.log(`\n▶ Applying CORS to gs://${bucket}\n  ${cmd} ${args.join(" ")}`);
  if (dryRun) return true;
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false });
  if (r.status === 0) return true;
  if (r.error?.code === "ENOENT") {
    console.error("  ✖ gcloud isn't installed. Install the Google Cloud CLI, or run:");
    console.error(`    gsutil cors set cors.json gs://${bucket}`);
    return false;
  }
  console.error(`  ✖ gcloud exited ${r.status ?? "?"} (are you authenticated? \`gcloud auth login\`)`);
  return false;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has("--check");
  const ifNeeded = args.has("--if-needed");
  const dryRun = args.has("--dry-run");
  const bucket = storageBucket();
  const origins = corsOrigins();

  console.log(`Storage CORS for gs://${bucket}`);
  console.log(`  origins: ${origins.join(", ") || "(none declared)"}`);

  const before = await corsIsApplied(bucket, origins);
  for (const r of before.results) {
    console.log(`  ${r.allowed ? "✅" : "❌"} ${r.origin}`);
  }

  if (before.ok && (checkOnly || ifNeeded)) {
    console.log("\n✔ Bucket CORS already allows every declared origin.");
    return 0;
  }

  if (checkOnly) {
    console.error(
      "\n✖ Bucket CORS is missing or incomplete — the browser cannot download generated images.\n" +
        "  Fix with: yarn setCors\n",
    );
    return 1;
  }

  const applied = applyCors(bucket, { dryRun });
  if (dryRun) return 0;
  if (!applied) {
    // `--if-needed` runs inside `yarn deploy`; a missing/unauthenticated gcloud
    // must not sink an otherwise good deploy, so warn loudly and carry on.
    console.error(
      ifNeeded
        ? "\n⚠️  Could not apply bucket CORS — generated images will not load in the browser until you run `yarn setCors`.\n"
        : "\n✖ Could not apply bucket CORS.\n",
    );
    return ifNeeded ? 0 : 1;
  }

  // A fresh policy takes a few seconds to reach every frontend, so a single
  // post-apply probe can still show a stale reject. Poll before crying wolf.
  let after = await corsIsApplied(bucket, origins);
  for (let i = 0; i < 5 && !after.ok; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    after = await corsIsApplied(bucket, origins);
  }
  for (const r of after.results) console.log(`  ${r.allowed ? "✅" : "❌"} ${r.origin}`);
  if (!after.ok) {
    console.error("\n✖ CORS was applied but the bucket still rejects some origins.\n");
    return ifNeeded ? 0 : 1;
  }
  console.log("\n✔ Bucket CORS applied.\n");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code));
}
