/**
 * set-secrets.mjs — push backend secrets from functions/.env.local to Cloud
 * Secret Manager. Committed + self-contained so `yarn setSecrets` works anywhere
 * (the local `manage-prod.local.mjs` helper reuses these exports too).
 *
 *   yarn setSecrets            # sync values from functions/.env.local
 *   yarn setSecrets status     # show which secrets are set vs missing
 *   node scripts/set-secrets.mjs --yes   # sync without the confirmation prompt
 *
 * SINGLE SOURCE OF TRUTH: the secret NAMES are parsed straight out of
 * functions/src/secrets.ts (every `defineSecret("…")`), so adding a secret there
 * is automatically picked up here — nothing to keep in sync by hand.
 *
 * It never prints secret VALUES. `status` checks existence by exit code only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRETS_TS = join(ROOT, "functions/src/secrets.ts");
const ENV_LOCAL = join(ROOT, "functions/.env.local");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const c = (color, s) => `${C[color]}${s}${C.reset}`;

export function projectId() {
  try {
    return JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8")).projects?.default ?? "childbook-60f89";
  } catch {
    return "childbook-60f89";
  }
}

/**
 * The subset of secrets that ALSO belong in GitHub Actions (for the CI/CD Slack
 * pings). Deliberately tiny: the workflows don't need your AI/Stripe/Lulu keys —
 * the running function reads those from Secret Manager — so copying them into a
 * second store would only widen the leak surface. `.env.local` stays the single
 * source of truth; `yarn setSecrets` fans this allowlist out to GitHub too.
 */
export const GITHUB_ACTION_SECRETS = ["SLACK_WEBHOOK_URL"];

/**
 * Every secret name declared in functions/src/secrets.ts. Parsed from the
 * `defineSecret("NAME")` calls so this list can never drift from the code.
 */
export function secretNames() {
  let src;
  try {
    src = readFileSync(SECRETS_TS, "utf8");
  } catch (err) {
    throw new Error(`Could not read ${SECRETS_TS}: ${err?.message ?? err}`);
  }
  const names = [...src.matchAll(/defineSecret\(\s*["']([A-Z0-9_]+)["']\s*\)/g)].map((m) => m[1]);
  const unique = [...new Set(names)];
  if (unique.length === 0) {
    throw new Error(
      `Found no defineSecret("…") declarations in ${SECRETS_TS}. Refusing to continue ` +
        "(the file may have moved or its format changed).",
    );
  }
  return unique;
}

/** Group a secret by name prefix, for readable output (purely cosmetic). */
export function groupOf(name) {
  if (name.startsWith("LULU_")) return name.includes("LIVE") ? "Lulu (live)" : "Lulu (sandbox)";
  if (name.startsWith("STRIPE_")) return name.includes("LIVE") ? "Stripe (live)" : "Stripe (sandbox)";
  return "AI providers";
}

/** Minimal dotenv reader for functions/.env.local. */
export function readEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return {};
  const out = {};
  for (const line of readFileSync(ENV_LOCAL, "utf8").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export const isPlaceholder = (v) => !v || /dummy|replace-me|your-|example\.com/i.test(v);

/** A non-blocking sanity warning when a value's shape looks wrong for its name. */
function shapeWarning(name, value) {
  const checks = [
    ["STRIPE_LIVE_SECRET_KEY", (v) => v.startsWith("sk_live_"), "expected sk_live_…"],
    ["STRIPE_SANDBOX_SECRET_KEY", (v) => v.startsWith("sk_test_"), "expected sk_test_…"],
    ["STRIPE_LIVE_WEBHOOK_SECRET", (v) => v.startsWith("whsec_"), "expected whsec_…"],
    ["STRIPE_SANDBOX_WEBHOOK_SECRET", (v) => v.startsWith("whsec_"), "expected whsec_…"],
    ["OPENAI_API_KEY", (v) => v.startsWith("sk-"), "expected sk-…"],
  ];
  for (const [n, ok, hint] of checks) {
    if (name === n && !ok(value)) return hint;
  }
  return null;
}

/** The secrets present (non-placeholder) in functions/.env.local. */
export function nonPlaceholderSecrets() {
  const env = readEnvLocal();
  return secretNames().filter((n) => !isPlaceholder(env[n]));
}

function fbSecretSet(project, name, value) {
  return spawnSync(
    "npx",
    ["--no-install", "firebase", "functions:secrets:set", name, "--data-file", "-", "--project", project],
    { cwd: ROOT, input: value, stdio: ["pipe", "ignore", "inherit"] },
  );
}

function fbSecretExists(project, name) {
  const r = spawnSync(
    "npx",
    ["--no-install", "firebase", "functions:secrets:access", name, "--project", project],
    { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] },
  );
  return r.status === 0;
}

// ── GitHub Actions secrets (via the `gh` CLI) ────────────────────────────────

/** Whether the `gh` CLI is installed AND authenticated for this repo. */
export function ghReady() {
  const installed = spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;
  if (!installed) return { ok: false, reason: "the GitHub CLI (`gh`) is not installed" };
  const authed = spawnSync("gh", ["auth", "status"], { cwd: ROOT, stdio: "ignore" }).status === 0;
  if (!authed) return { ok: false, reason: "`gh` is not authenticated — run `gh auth login`" };
  return { ok: true };
}

/** Set a GitHub Actions repo secret (value via stdin so it never hits argv/logs). */
function ghSecretSet(name, value) {
  return spawnSync("gh", ["secret", "set", name], {
    cwd: ROOT, // gh infers the repo from the git remote here
    input: value,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

/**
 * Push the GitHub allowlist ({@link GITHUB_ACTION_SECRETS}) from
 * functions/.env.local to GitHub Actions secrets. Best-effort: if `gh` isn't
 * ready it warns and skips (the GCP sync is what deploys actually depend on).
 */
export function syncGithubSecrets({ quiet = false } = {}) {
  const log = (...a) => !quiet && console.log(...a);
  const env = readEnvLocal();
  const names = GITHUB_ACTION_SECRETS.filter((n) => !isPlaceholder(env[n]));
  if (names.length === 0) {
    log(`\n${c("dim", "No GitHub-synced secrets have real values in functions/.env.local — skipping GitHub.")}`);
    return { set: 0, skipped: 0, failed: 0 };
  }
  const ready = ghReady();
  if (!ready.ok) {
    log(`\n${c("yellow", "skip GitHub sync")} ${c("dim", `(${ready.reason})`)}`);
    return { set: 0, skipped: names.length, failed: 0 };
  }
  log(`\nSyncing GitHub Actions secrets ${c("dim", "(for CI/CD)")}\n`);
  let set = 0, failed = 0;
  for (const name of names) {
    process.stdout.write(`  ${c("cyan", "set ")}  ${name} … `);
    const r = ghSecretSet(name, env[name]);
    if (r.status === 0) { log(c("green", "ok")); set++; }
    else { log(c("red", "FAILED")); failed++; }
  }
  log(`\n${c("bold", "GitHub:")} ${set} set, ${failed} failed.`);
  return { set, skipped: 0, failed };
}

/**
 * Push every non-placeholder secret from functions/.env.local to Secret Manager.
 * Returns counts so callers (deploy) can report. Pure side-effect on Secret Manager.
 */
export function syncSecrets({ project = projectId(), quiet = false } = {}) {
  const env = readEnvLocal();
  const names = secretNames();
  const log = (...a) => !quiet && console.log(...a);
  log(`\nSyncing secrets from functions/.env.local → project ${c("cyan", project)}\n`);
  let set = 0, skipped = 0, failed = 0;
  for (const name of names) {
    const val = env[name];
    if (isPlaceholder(val)) {
      log(`  ${c("yellow", "skip")}  ${name} ${c("dim", "(blank/placeholder)")}`);
      skipped++;
      continue;
    }
    const warn = shapeWarning(name, val);
    if (warn) log(`  ${c("yellow", "warn")}  ${name} ${c("dim", `(${warn})`)}`);
    process.stdout.write(`  ${c("cyan", "set ")}  ${name} … `);
    const r = fbSecretSet(project, name, val);
    if (r.status === 0) { log(c("green", "ok")); set++; }
    else { log(c("red", "FAILED")); failed++; }
  }
  log(`\n${c("bold", "Done:")} ${set} set, ${skipped} skipped, ${failed} failed.`);
  if (set > 0 && !quiet) log(c("yellow", "Redeploy to bind the new versions:  yarn deploy\n"));
  return { set, skipped, failed };
}

/** Print which secrets exist in Secret Manager vs missing (existence checks run in parallel). */
export async function status({ project = projectId() } = {}) {
  const names = secretNames();
  console.log(`\n${c("bold", "Secrets")} — project ${c("cyan", project)}  ${c("dim", `(${names.length} declared)`)}\n`);
  console.log(c("dim", "(checking Secret Manager in parallel…)\n"));
  const exists = await Promise.all(names.map((n) => Promise.resolve().then(() => fbSecretExists(project, n))));
  const byName = new Map(names.map((n, i) => [n, exists[i]]));
  const groups = [...new Set(names.map(groupOf))];
  for (const group of groups) {
    console.log(`  ${c("bold", group)}`);
    for (const n of names.filter((x) => groupOf(x) === group)) {
      console.log(`    ${byName.get(n) ? c("green", "set    ") : c("red", "MISSING")}  ${n}`);
    }
    console.log("");
  }
  const missing = names.filter((n) => !byName.get(n));
  return { missing };
}

/** Yes/no prompt (auto-no when not a TTY). */
export function confirm(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} `, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = new Set(process.argv.slice(2));
  try {
    if (args.has("status")) {
      await status();
    } else {
      const pending = nonPlaceholderSecrets();
      if (pending.length === 0) {
        console.log(
          `\nNo non-placeholder secrets found in functions/.env.local — nothing to sync.\n` +
            `Add real values there first (see functions/.env.example).\n`,
        );
      } else {
        const proceed = args.has("--yes") || args.has("-y") || (await confirm(
          `Sync ${c("bold", pending.length)} secret(s) from functions/.env.local to Secret Manager? [y/N]`,
        ));
        if (proceed) {
          syncSecrets();
          // Fan the CI/CD allowlist out to GitHub Actions too, so functions/.env.local
          // stays the one place you edit. Best-effort — never fails the run.
          syncGithubSecrets();
        } else console.log("Aborted.");
      }
    }
  } catch (err) {
    console.error(c("red", `\n${err?.message ?? err}\n`));
    process.exit(1);
  }
}
