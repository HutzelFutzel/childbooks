/**
 * Dev orchestrator — starts the backend (and optionally the web app), plus the
 * two pieces that make payments and print orders testable locally.
 *
 * Usage (args are forwarded by yarn, e.g. `yarn dev:backend --order`):
 *   node scripts/dev.mjs              # functions build + emulators
 *   node scripts/dev.mjs --all        # + the Next web app
 *   node scripts/dev.mjs --stripe     # + the Stripe CLI webhook listener
 *   node scripts/dev.mjs --order      # + Stripe, + print-order status polling
 *   node scripts/dev.mjs --all --order
 *
 * NO TUNNEL IS INVOLVED. Local dev talks to the REAL Storage bucket (see
 * scripts/dev-emulators.mjs), so the print files handed to Lulu — and ebook
 * download links — are ordinary `firebasestorage.googleapis.com` URLs that are
 * reachable and stable. That's what the old ngrok setup was working around.
 *
 * Why --stripe: Stripe delivers payment events (checkout completed, refunds, …)
 * to our `/stripe-webhook` receiver, which is the SOURCE OF TRUTH for marking an
 * order paid and triggering fulfillment. Locally there's no public URL, so we run
 * `stripe listen --forward-to <emulator>/stripe-webhook`, which forwards live
 * events to the emulator AND prints a signing secret. We capture that secret and
 * inject it as STRIPE_EMULATOR_WEBHOOK_SECRET so the receiver can verify events —
 * no manual setup. Requires the Stripe CLI (https://stripe.com/docs/stripe-cli)
 * and a sandbox secret key (STRIPE_SANDBOX_SECRET_KEY) in functions/.env.local.
 * `--order` implies `--stripe` (a real end-to-end order needs payment first).
 *
 * Why --order: after Lulu accepts a job it reports progress (file validation,
 * IN_PRODUCTION, SHIPPED, REJECTED) by POSTing our `/print-webhook`, which it
 * can't reach on localhost. Instead of exposing the emulator, we PULL the same
 * status on a timer through `/internal/print/sync` (emulator-only) and run it
 * through the identical `applyOrderStatusUpdate` reducer the webhook uses. In
 * production the webhook stays the fast path, with the `syncPrintOrders`
 * scheduled function as the same-code-path safety net.
 */
import { spawn, execFile } from "node:child_process";
import {
  adcProblem,
  apiBaseUrl,
  readEnvLocal,
  repairCredentials,
  storageEmulatorEnabled,
  useRepoCredentials,
} from "./dev-env.mjs";

const ARGS = new Set(process.argv.slice(2));
const WANT_ALL = ARGS.has("--all");
// Accept --order and -order (and a bare "order") so the flag is forgiving.
const WANT_ORDER = ARGS.has("--order") || ARGS.has("-order") || ARGS.has("order");
// A real end-to-end order is payment-gated, so --order implies --stripe.
const WANT_STRIPE =
  ARGS.has("--stripe") || ARGS.has("-stripe") || ARGS.has("stripe") || WANT_ORDER;

const ENV_LOCAL = "functions/.env.local";

/** How often to pull print-order status under `--order`. */
const ORDER_POLL_SECONDS = 30;

/** The local Functions-emulator URL for our Stripe webhook receiver. */
function stripeWebhookUrl() {
  return `${apiBaseUrl()}/stripe-webhook`;
}

/** Pick the sandbox Stripe secret key (mirrors serverEnv selection in dev). */
function stripeKey(fileEnv) {
  const get = (k) => process.env[k] || fileEnv[k] || "";
  return get("STRIPE_SANDBOX_SECRET_KEY") || get("STRIPE_SECRET_KEY");
}

/**
 * Capture the Stripe CLI listener's signing secret (so the emulator can verify
 * forwarded events) and return the long-running `stripe listen` command to add
 * as a concurrently task. Best-effort: warns + returns null if the CLI is
 * missing or no key is set, so dev still starts (webhooks just won't verify).
 */
async function startStripeListener() {
  const fileEnv = readEnvLocal();
  const key = stripeKey(fileEnv);
  if (!key) {
    console.warn(
      `[stripe] No STRIPE_SANDBOX_SECRET_KEY in ${ENV_LOCAL} — skipping the webhook listener.`,
    );
    return null;
  }
  const url = stripeWebhookUrl();
  const secret = await new Promise((resolve) => {
    execFile(
      "stripe",
      ["listen", "--api-key", key, "--print-secret"],
      { timeout: 20_000 },
      (err, stdout) => {
        if (err) {
          console.warn(
            `[stripe] Couldn't get a webhook secret (${err.message}). ` +
              "Is the Stripe CLI installed? https://stripe.com/docs/stripe-cli",
          );
          resolve(null);
          return;
        }
        const match = String(stdout).match(/whsec_[A-Za-z0-9]+/);
        resolve(match ? match[0] : null);
      },
    );
  });
  if (!secret) return null;
  // Inject under the emulator-only override name so the functions emulator (which
  // inherits this process's env) verifies forwarded events against the SAME secret
  // the listener signs them with. This var is never set in .env.local, so it isn't
  // clobbered by a static value there — `selectStripe` prefers it when
  // FUNCTIONS_EMULATOR is set, leaving any .env.local sandbox secret as a fallback.
  process.env.STRIPE_EMULATOR_WEBHOOK_SECRET = secret;
  console.log(`[stripe] Webhook listener → ${url}`);
  console.log(`[stripe] Signing secret injected (${secret.slice(0, 12)}…).`);
  return `stripe listen --api-key ${key} --forward-to ${url}`;
}

/**
 * Poll the emulator-only reconcile endpoint so Lulu status changes show up
 * locally. Returns a stop function.
 *
 * Silent until something actually moves — an idle poll is the normal case and
 * shouldn't bury the other tasks' output. Connection errors are ignored: the
 * functions emulator takes a few seconds to come up and will be polled again.
 */
function startOrderStatusPolling() {
  const url = `${apiBaseUrl()}/internal/print/sync`;
  console.log(`[order] Polling print-order status every ${ORDER_POLL_SECONDS}s → ${url}`);
  console.log("[order] (Lulu can't reach localhost, so status is pulled instead of pushed.)");

  let stopped = false;
  const tick = async () => {
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) return;
      const { changed = [], errors = [] } = await res.json();
      for (const c of changed) {
        console.log(`[order] ${c.orderId}: ${c.from ?? "?"} → ${c.to}`);
      }
      for (const e of errors) {
        console.warn(`[order] ${e.orderId}: ${e.message}`);
      }
    } catch {
      // Emulator not up yet (or shutting down) — the next tick retries.
    }
  };
  const timer = setInterval(() => {
    if (!stopped) void tick();
  }, ORDER_POLL_SECONDS * 1000);
  // Don't hold the process open on its own.
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Resolve Storage credentials BEFORE starting anything.
 *
 * This has to happen here rather than in the emulator launcher: `concurrently`
 * gives its children piped stdio, so a launcher running under it has no TTY to
 * prompt on. It does pass `process.env` through, so the credential path set here
 * reaches the emulator and the functions runtime that actually authenticates.
 */
if (storageEmulatorEnabled(readEnvLocal())) {
  if (WANT_ORDER) {
    console.warn(
      "[order] USE_STORAGE_EMULATOR=true — print files will be localhost URLs that Lulu\n" +
        "[order] cannot fetch, so checkout will refuse the order before taking payment.\n" +
        "[order] Unset it to place real sandbox orders against the real bucket.",
    );
  }
} else {
  useRepoCredentials();
  const problem = await adcProblem();
  if (problem) await repairCredentials(problem);
}

let stripeCommand = null;
if (WANT_STRIPE) {
  stripeCommand = await startStripeListener();
}

const tasks = [
  { name: "bundle", color: "blue", command: "yarn workspace functions dev" },
  { name: "emulators", color: "magenta", command: "yarn emulators" },
];
if (stripeCommand) tasks.push({ name: "stripe", color: "yellow", command: stripeCommand });
if (WANT_ALL) tasks.unshift({ name: "web", color: "cyan", command: "yarn dev" });

const child = spawn(
  "concurrently",
  [
    "-n",
    tasks.map((t) => t.name).join(","),
    "-c",
    tasks.map((t) => t.color).join(","),
    ...tasks.map((t) => t.command),
  ],
  { stdio: "inherit", env: process.env, shell: false },
);

const stopPolling = WANT_ORDER ? startOrderStatusPolling() : null;

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopPolling?.();
  child.kill("SIGINT");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}

child.on("exit", (code) => {
  stopPolling?.();
  process.exit(code ?? 0);
});
child.on("error", (err) => {
  console.error("Failed to start dev processes:", err.message);
  process.exit(1);
});
