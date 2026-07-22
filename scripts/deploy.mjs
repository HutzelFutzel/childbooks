/**
 * Production deploy orchestrator — the one command to ship the backend.
 *
 *   yarn deploy
 *
 * Does, in order:
 *   1. builds the functions bundle (esbuild)
 *   2. deploys functions + Firestore rules/indexes + Storage rules
 *   3. pings the deployed /health and /providers so you immediately see it's up
 *
 * The Next.js frontend deploys via Firebase App Hosting's GitHub integration
 * (a push to the connected branch triggers a rollout), so it is intentionally
 * NOT handled here. Pass `--web` to also build + deploy it from the CLI.
 *
 * Secrets: when run interactively, offers to sync any real values from
 * functions/.env.local to Secret Manager first (so a freshly-added key is bound
 * by this deploy). Skip with `--no-secrets`, or force it with `--secrets`.
 * Otherwise set them with `yarn setSecrets` / `firebase functions:secrets:set`.
 *
 * Flags:
 *   --web         also build + deploy the frontend (firebase deploy --only apphosting)
 *   --secrets     sync secrets from functions/.env.local without prompting
 *   --no-secrets  never sync secrets (skip the prompt)
 *   --dry-run     print what it would do, without deploying
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { confirm, nonPlaceholderSecrets, syncSecrets } from "./set-secrets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = new Set(process.argv.slice(2));
const WANT_WEB = ARGS.has("--web");
const DRY = ARGS.has("--dry-run");
const FORCE_SECRETS = ARGS.has("--secrets");
const SKIP_SECRETS = ARGS.has("--no-secrets");

function projectId() {
  try {
    return JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8")).projects?.default ?? "childbook-60f89";
  } catch {
    return "childbook-60f89";
  }
}
const PROJECT = projectId();
const BACKEND = `https://us-central1-${PROJECT}.cloudfunctions.net/api`;

function run(label, cmd, args) {
  console.log(`\n▶ ${label}\n  ${cmd} ${args.join(" ")}`);
  if (DRY) return;
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${r.status ?? "?"}).`);
    process.exit(r.status ?? 1);
  }
}

async function ping(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${BACKEND}${path}`, { signal: ctrl.signal });
    return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 160) };
  } catch (err) {
    return { ok: false, status: 0, body: String(err?.message ?? err) };
  } finally {
    clearTimeout(t);
  }
}

console.log(`Deploying childbooks → project ${PROJECT}${DRY ? "  (dry run)" : ""}`);

// 0. Optionally sync secrets from functions/.env.local so a freshly-added key is
// bound by this deploy. Auto-skips when there's nothing to sync or in CI.
if (!DRY && !SKIP_SECRETS) {
  let pending = [];
  try {
    pending = nonPlaceholderSecrets();
  } catch (err) {
    console.warn(`(skipping secret sync: ${err?.message ?? err})`);
  }
  if (pending.length > 0) {
    const doSync =
      FORCE_SECRETS ||
      (await confirm(`\n▶ Sync ${pending.length} secret(s) from functions/.env.local to Secret Manager first? [y/N]`));
    if (doSync) syncSecrets({ project: PROJECT });
  }
}

// 1. Verify required env/config is in place BEFORE building — a deploy with a
// missing PUBLIC_APP_URL or frontend backend URL ships a broken store.
run("Check environment", "node", ["scripts/check-env.mjs"]);

// 2. Build the backend bundle.
run("Build functions", "yarn", ["build:functions"]);

// 2. Deploy backend + rules + indexes (+ optional frontend).
// Storage has no `storage:rules` sub-target (that syntax means a named deploy
// target); the single-bucket rules deploy with the bare `storage` selector.
const targets = ["functions", "firestore:rules", "firestore:indexes", "storage"];
if (WANT_WEB) {
  run("Build web", "yarn", ["build:web"]);
  targets.push("apphosting");
}
run(
  "Deploy",
  "npx",
  ["--no-install", "firebase", "deploy", "--only", targets.join(","), "--project", PROJECT, "--non-interactive"],
);

// 3. Post-deploy health ping.
if (!DRY) {
  console.log("\n▶ Verifying deployed backend");
  for (const path of ["/health", "/providers"]) {
    const r = await ping(path);
    console.log(`  ${r.ok ? "✅" : "❌"} ${path} → ${r.status}  ${r.body}`);
  }
  console.log(
    "\nDone. For the full picture (Stripe/Lulu/Storage + go-live readiness), open\n" +
      "Admin → Configuration → System health.\n",
  );
}
