/**
 * Dev orchestrator — starts the backend (and optionally the web app), with an
 * opt-in public tunnel for end-to-end print-order testing.
 *
 * Usage (args are forwarded by yarn, e.g. `yarn dev:backend --order`):
 *   node scripts/dev.mjs              # functions build + emulators
 *   node scripts/dev.mjs --all       # + the Next web app
 *   node scripts/dev.mjs --order     # + an ngrok tunnel to the Storage emulator
 *   node scripts/dev.mjs --stripe     # + the Stripe CLI webhook listener
 *   node scripts/dev.mjs --all --order --stripe
 *
 * Why --stripe: Stripe delivers payment events (checkout completed, refunds, …)
 * to our `/stripe-webhook` receiver, which is the SOURCE OF TRUTH for marking an
 * order paid and triggering fulfillment. Locally there's no public URL, so we run
 * `stripe listen --forward-to <emulator>/stripe-webhook`, which forwards live
 * events to the emulator AND prints a signing secret. We capture that secret and
 * inject it as STRIPE_SANDBOX_WEBHOOK_SECRET so the receiver can verify events —
 * no manual setup. Requires the Stripe CLI (https://stripe.com/docs/stripe-cli)
 * and a sandbox secret key (STRIPE_SANDBOX_SECRET_KEY) in functions/.env.local.
 * `--order` implies `--stripe` (a real end-to-end order needs payment first).
 *
 * Why --order: placing a print order hands the provider (Lulu) URLs to the
 * interior/cover files in Storage; the provider then DOWNLOADS them, and later
 * POSTs status updates to our webhook. Under the emulators those hosts are
 * 127.0.0.1 — unreachable by Lulu. With --order we open ngrok tunnels to BOTH:
 *   - Storage (9199) → exported as STORAGE_PUBLIC_BASE_URL (asset download URLs)
 *   - Functions (5001) → our /print-webhook receiver, auto-registered with Lulu
 * so the full order → file-validation → status-callback loop works locally.
 * Everyday dev doesn't need it — quoting and cover-dimensions never call back.
 *
 * Requires an ngrok authtoken (free): set NGROK_AUTHTOKEN in functions/.env.local.
 * Optionally pin a reserved domain with NGROK_DOMAIN (applied to the Storage
 * tunnel so download URLs stay stable; the webhook tunnel is ephemeral and the
 * webhook is re-registered each run).
 */
import { spawn, execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ARGS = new Set(process.argv.slice(2));
const WANT_ALL = ARGS.has("--all");
// Accept --order and -order (and a bare "order") so the flag is forgiving.
const WANT_ORDER = ARGS.has("--order") || ARGS.has("-order") || ARGS.has("order");
// A real end-to-end order is payment-gated, so --order implies --stripe.
const WANT_STRIPE =
  ARGS.has("--stripe") || ARGS.has("-stripe") || ARGS.has("stripe") || WANT_ORDER;

const STORAGE_EMULATOR_PORT = 9199;
const FUNCTIONS_EMULATOR_PORT = 5001;
const ENV_LOCAL = "functions/.env.local";
const FIREBASERC = ".firebaserc";

/** Minimal dotenv reader (only what we need: NGROK_* lookups). */
function readEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return {};
  const out = {};
  for (const raw of readFileSync(ENV_LOCAL, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Read the default Firebase project id (for the emulator function URL path). */
function projectId() {
  try {
    const rc = JSON.parse(readFileSync(FIREBASERC, "utf8"));
    return rc?.projects?.default || "childbook-60f89";
  } catch {
    return "childbook-60f89";
  }
}

/** Pick the Lulu OAuth creds + base URL matching LULU_ENV (mirrors serverEnv). */
function luluCreds(fileEnv) {
  const get = (k) => process.env[k] || fileEnv[k] || "";
  const env = (get("LULU_ENV") || "sandbox") === "live" ? "live" : "sandbox";
  const base = env === "live" ? "https://api.lulu.com" : "https://api.sandbox.lulu.com";
  const legacyKey = get("LULU_CLIENT_KEY");
  const legacySecret = get("LULU_CLIENT_SECRET");
  const key =
    (env === "live" ? get("LULU_LIVE_CLIENT_KEY") : get("LULU_SANDBOX_CLIENT_KEY")) || legacyKey;
  const secret =
    (env === "live" ? get("LULU_LIVE_CLIENT_SECRET") : get("LULU_SANDBOX_CLIENT_SECRET")) ||
    legacySecret;
  return { env, base, key, secret };
}

const TOKEN_PATH = "/auth/realms/glasstree/protocol/openid-connect/token";

async function luluToken({ base, key, secret }) {
  const res = await fetch(`${base}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Lulu auth failed (${res.status})`);
  const json = await res.json();
  if (!json.access_token) throw new Error("Lulu auth returned no token");
  return json.access_token;
}

/**
 * Register the webhook with Lulu, clearing any stale `/print-webhook` hooks from
 * previous runs first (their ngrok URLs are dead). Best-effort: warns + returns
 * null on any failure so dev still starts.
 */
async function registerLuluWebhook(webhookUrl, fileEnv) {
  const creds = luluCreds(fileEnv);
  if (!creds.key || !creds.secret) {
    console.warn("[order] Lulu credentials not set — skipping webhook auto-registration.");
    return null;
  }
  try {
    const token = await luluToken(creds);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    // Remove dead webhooks pointing at our receiver (prior ngrok URLs).
    try {
      const listRes = await fetch(`${creds.base}/webhooks/`, { headers });
      if (listRes.ok) {
        const { results = [] } = await listRes.json();
        for (const w of results) {
          if (typeof w?.url === "string" && w.url.includes("/print-webhook") && w.id) {
            await fetch(`${creds.base}/webhooks/${w.id}/`, { method: "DELETE", headers });
          }
        }
      }
    } catch {
      /* listing/cleanup is best-effort */
    }
    const createRes = await fetch(`${creds.base}/webhooks/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ topics: ["PRINT_JOB_STATUS_CHANGED"], url: webhookUrl }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => "");
      console.warn(`[order] Webhook registration failed (${createRes.status}): ${detail}`);
      return null;
    }
    const created = await createRes.json();
    console.log(`[order] Registered Lulu webhook ${created.id} (${creds.env}).`);
    return { id: String(created.id), creds };
  } catch (err) {
    console.warn(`[order] Webhook auto-registration skipped: ${err?.message ?? err}`);
    return null;
  }
}

/** Delete the webhook we registered (re-auths in case the token expired). */
async function deleteLuluWebhook(webhook) {
  if (!webhook?.id) return;
  try {
    const token = await luluToken(webhook.creds);
    await fetch(`${webhook.creds.base}/webhooks/${webhook.id}/`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    console.log(`[order] Removed Lulu webhook ${webhook.id}.`);
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Open the Storage + Functions tunnels, export STORAGE_PUBLIC_BASE_URL, and
 * auto-register the webhook. Returns the ngrok module + the registered webhook
 * (for cleanup). The Functions tunnel + webhook are best-effort so a free-plan
 * tunnel limit or missing Lulu creds doesn't block placing orders.
 */
async function startOrderTunnels() {
  const fileEnv = readEnvLocal();
  const authtoken = process.env.NGROK_AUTHTOKEN || fileEnv.NGROK_AUTHTOKEN;
  if (!authtoken) {
    console.error(
      `[order] NGROK_AUTHTOKEN is not set. Add it to ${ENV_LOCAL} to enable --order.\n` +
        "[order] Get a free token at https://dashboard.ngrok.com/get-started/your-authtoken",
    );
    process.exit(1);
  }
  const domain = process.env.NGROK_DOMAIN || fileEnv.NGROK_DOMAIN || undefined;

  const ngrok = (await import("@ngrok/ngrok")).default;

  // Storage tunnel (gets the reserved domain, if any, so URLs stay stable).
  const storage = await ngrok.forward({
    addr: STORAGE_EMULATOR_PORT,
    authtoken,
    ...(domain ? { domain } : {}),
  });
  const storageUrl = storage.url();
  if (!storageUrl) {
    console.error("[order] ngrok did not return a Storage URL.");
    process.exit(1);
  }
  process.env.STORAGE_PUBLIC_BASE_URL = storageUrl;
  console.log(`[order] Storage tunnel: ${storageUrl} -> 127.0.0.1:${STORAGE_EMULATOR_PORT}`);

  // Functions tunnel + webhook (best-effort).
  let webhook = null;
  try {
    const fns = await ngrok.forward({ addr: FUNCTIONS_EMULATOR_PORT, authtoken });
    const fnsUrl = fns.url();
    if (fnsUrl) {
      const webhookUrl = `${fnsUrl}/${projectId()}/us-central1/api/print-webhook`;
      console.log(`[order] Functions tunnel: ${fnsUrl} -> 127.0.0.1:${FUNCTIONS_EMULATOR_PORT}`);
      console.log(`[order] Webhook URL: ${webhookUrl}`);
      webhook = await registerLuluWebhook(webhookUrl, fileEnv);
    }
  } catch (err) {
    console.warn(
      `[order] Could not open the Functions tunnel (${err?.message ?? err}). ` +
        "Order placement still works; status webhooks won't be delivered locally.",
    );
  }

  return { ngrok, webhook };
}

/** The local Functions-emulator URL for our Stripe webhook receiver. */
function stripeWebhookUrl() {
  return `http://127.0.0.1:${FUNCTIONS_EMULATOR_PORT}/${projectId()}/us-central1/api/stripe-webhook`;
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

let ngrokModule = null;
let registeredWebhook = null;
if (WANT_ORDER) {
  const started = await startOrderTunnels();
  ngrokModule = started.ngrok;
  registeredWebhook = started.webhook;
}

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

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await deleteLuluWebhook(registeredWebhook);
  try {
    await ngrokModule?.kill();
  } catch {
    /* ignore */
  }
  child.kill("SIGINT");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}

child.on("exit", async (code) => {
  await deleteLuluWebhook(registeredWebhook);
  try {
    await ngrokModule?.kill();
  } catch {
    /* ignore */
  }
  process.exit(code ?? 0);
});
child.on("error", (err) => {
  console.error("Failed to start dev processes:", err.message);
  process.exit(1);
});
