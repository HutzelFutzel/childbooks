/**
 * System health diagnostics for the admin dashboard.
 *
 * Aggregates live probes against every external dependency the backend relies
 * on — the AI providers, the print provider (Lulu), Stripe, Firebase Storage —
 * plus a few config sanity checks (e.g. PUBLIC_APP_URL set for Stripe
 * redirects, sandbox/live consistency). Each check returns a precise
 * pass/warn/fail with a fix hint, mirroring the Stripe health card pattern.
 *
 * IMPORTANT: this never returns secret VALUES — only whether they work. The
 * actual keys live in Cloud Secret Manager and must stay there. The matching
 * admin UI (SystemHealthTab) is a read-only status view, not a place to enter
 * secrets.
 */
import { randomUUID } from "node:crypto";
import type { Express, Request, Response as ExpressResponse } from "express";
import { getStorage } from "firebase-admin/storage";
import { serverConfig } from "./config";
import { fulfillmentProvider } from "./lulu";
import { stripeHealth } from "./stripe";
import { ensureAdmin, storageBucketName } from "./storage";

export type CheckStatus = "pass" | "warn" | "fail";

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

export interface HealthGroup {
  id: string;
  label: string;
  ok: boolean;
  checks: HealthCheck[];
}

export interface SystemHealthReport {
  ok: boolean;
  generatedAt: number;
  environment: { lulu: "sandbox" | "live"; stripe: "sandbox" | "live" };
  groups: HealthGroup[];
}

/** A group is healthy when none of its checks fail (warnings are tolerated). */
function groupOk(checks: HealthCheck[]): boolean {
  return checks.every((c) => c.status !== "fail");
}

/** fetch with a hard timeout so a hung provider can't stall the whole report. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 12_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- AI providers ----------------------------------------------------------

async function checkOpenAI(key: string): Promise<HealthCheck> {
  const base = { id: "openai", label: "OpenAI API key" } as const;
  if (!key) {
    return {
      ...base,
      status: "warn",
      message: "No OpenAI key configured. OpenAI-backed models are unavailable.",
      fix: "Set OPENAI_API_KEY as a function secret (firebase functions:secrets:set OPENAI_API_KEY).",
    };
  }
  try {
    const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      return { ...base, status: "pass", message: "Key authenticates; OpenAI models are reachable." };
    }
    if (res.status === 401) {
      return {
        ...base,
        status: "fail",
        message: "OpenAI rejected the key (401 Unauthorized).",
        fix: "Rotate OPENAI_API_KEY and re-set the function secret.",
      };
    }
    return {
      ...base,
      status: "warn",
      message: `OpenAI returned an unexpected status (${res.status}).`,
      fix: "Check the key's permissions and that the OpenAI account is in good standing.",
    };
  } catch (err) {
    return {
      ...base,
      status: "warn",
      message: `Could not reach OpenAI: ${(err as Error)?.message ?? "network error"}.`,
    };
  }
}

async function checkGemini(key: string): Promise<HealthCheck> {
  const base = { id: "gemini", label: "Google (Gemini) API key" } as const;
  if (!key) {
    return {
      ...base,
      status: "warn",
      message: "No Gemini key configured. Gemini-backed models are unavailable.",
      fix: "Set GOOGLE_API_KEY as a function secret (firebase functions:secrets:set GOOGLE_API_KEY).",
    };
  }
  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );
    if (res.ok) {
      return { ...base, status: "pass", message: "Key authenticates; Gemini models are reachable." };
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return {
        ...base,
        status: "fail",
        message: `Gemini rejected the key (${res.status}).`,
        fix: "Rotate GOOGLE_API_KEY and re-set the function secret.",
      };
    }
    return {
      ...base,
      status: "warn",
      message: `Gemini returned an unexpected status (${res.status}).`,
    };
  } catch (err) {
    return {
      ...base,
      status: "warn",
      message: `Could not reach Gemini: ${(err as Error)?.message ?? "network error"}.`,
    };
  }
}

// ---- Print provider (Lulu) -------------------------------------------------

/**
 * Exercise Lulu end-to-end: listing webhooks performs the OAuth2
 * client-credentials exchange AND an authenticated request, so a single call
 * verifies the credentials work for the active environment. The webhook count
 * doubles as a "status callbacks are wired" signal.
 */
async function checkLulu(env: "sandbox" | "live"): Promise<HealthCheck[]> {
  const cfg = serverConfig().fulfillment.lulu;
  if (!cfg.clientKey || !cfg.clientSecret) {
    return [
      {
        id: "lulu-auth",
        label: "Lulu credentials",
        status: env === "live" ? "fail" : "warn",
        message: `No Lulu credentials configured for the ${env} environment.`,
        fix: `Set LULU_${env === "live" ? "LIVE" : "SANDBOX"}_CLIENT_KEY and LULU_${env === "live" ? "LIVE" : "SANDBOX"}_CLIENT_SECRET as function secrets.`,
      },
    ];
  }
  try {
    const hooks = await fulfillmentProvider().listStatusWebhooks!();
    const auth: HealthCheck = {
      id: "lulu-auth",
      label: "Lulu credentials",
      status: "pass",
      message: `Authenticated against the ${env} Lulu API.`,
    };
    const webhook: HealthCheck =
      hooks.length > 0
        ? {
            id: "lulu-webhook",
            label: "Lulu status webhook",
            status: "pass",
            message: `${hooks.length} status webhook(s) registered for ${env}.`,
          }
        : {
            id: "lulu-webhook",
            label: "Lulu status webhook",
            status: "warn",
            message: "No order-status webhook is registered, so order updates won't be received.",
            fix: "Register one via POST /admin/print/webhooks { url: 'https://<host>/api/print-webhook' }.",
          };
    return [auth, webhook];
  } catch (err) {
    return [
      {
        id: "lulu-auth",
        label: "Lulu credentials",
        status: "fail",
        message: `Lulu rejected the credentials or was unreachable: ${(err as Error)?.message ?? "error"}.`,
        fix: `Verify the LULU_${env === "live" ? "LIVE" : "SANDBOX"}_* credentials match the ${env} environment.`,
      },
    ];
  }
}

// ---- Storage ---------------------------------------------------------------

/** Round-trip a tiny object to confirm the runtime can write + delete in the bucket. */
async function checkStorage(): Promise<HealthCheck> {
  const base = { id: "storage", label: "Firebase Storage read/write" } as const;
  const bucketName = storageBucketName();
  if (!bucketName) {
    return {
      ...base,
      status: "fail",
      message: "Could not resolve a Storage bucket name.",
      fix: "Set STORAGE_BUCKET (or ensure the runtime project id resolves).",
    };
  }
  try {
    ensureAdmin();
    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(`health-checks/${Date.now()}-${randomUUID()}.txt`);
    await file.save(Buffer.from("ok"), { contentType: "text/plain", resumable: false });
    await file.delete().catch(() => {});
    return { ...base, status: "pass", message: `Wrote and deleted a probe object in ${bucketName}.` };
  } catch (err) {
    return {
      ...base,
      status: "fail",
      message: `Storage write failed on ${bucketName}: ${(err as Error)?.message ?? "error"}.`,
      fix: "Confirm the runtime service account has Storage access and the bucket exists.",
    };
  }
}

// ---- Configuration sanity --------------------------------------------------

function checkConfig(luluEnv: "sandbox" | "live", stripeEnv: "sandbox" | "live"): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const appUrl = serverConfig().stripe.appUrl;

  if (!appUrl) {
    checks.push({
      id: "public-app-url",
      label: "Public app URL",
      status: "fail",
      message: "PUBLIC_APP_URL is unset — Stripe Checkout/portal redirects can't be built, so every checkout will fail in production.",
      fix: "Set PUBLIC_APP_URL to your deployed storefront origin (e.g. functions/.env.<projectId>).",
    });
  } else if (!appUrl.startsWith("https://")) {
    checks.push({
      id: "public-app-url",
      label: "Public app URL",
      status: "warn",
      message: `PUBLIC_APP_URL is "${appUrl}" — not https. Fine for local dev, wrong for production.`,
      fix: "Use the https App Hosting origin in production.",
    });
  } else {
    checks.push({
      id: "public-app-url",
      label: "Public app URL",
      status: "pass",
      message: `Redirects target ${appUrl}.`,
    });
  }

  if (luluEnv !== stripeEnv) {
    checks.push({
      id: "env-consistency",
      label: "Sandbox/live consistency",
      status: "warn",
      message: `Print is "${luluEnv}" but payments are "${stripeEnv}". Real charges with sandbox fulfillment (or vice versa) is usually a mistake.`,
      fix: "Align LULU_ENV and STRIPE_ENV unless you intend the split.",
    });
  } else {
    checks.push({
      id: "env-consistency",
      label: "Sandbox/live consistency",
      status: "pass",
      message: `Print and payments are both "${luluEnv}".`,
    });
  }

  return checks;
}

// ---- Report ----------------------------------------------------------------

export async function systemHealth(): Promise<SystemHealthReport> {
  const cfg = serverConfig();
  const luluEnv = cfg.fulfillment.lulu.env;
  const stripeEnv = cfg.stripe.env;

  const [openai, gemini, lulu, storage, stripe] = await Promise.all([
    checkOpenAI(cfg.openaiApiKey),
    checkGemini(cfg.googleApiKey),
    checkLulu(luluEnv),
    checkStorage(),
    stripeHealth(),
  ]);

  const config = checkConfig(luluEnv, stripeEnv);

  const aiChecks = [openai, gemini];
  const storageChecks = [storage];

  const groups: HealthGroup[] = [
    { id: "ai", label: "AI providers", ok: groupOk(aiChecks), checks: aiChecks },
    { id: "lulu", label: "Print (Lulu)", ok: groupOk(lulu), checks: lulu },
    { id: "stripe", label: "Payments (Stripe)", ok: stripe.ok, checks: stripe.checks },
    { id: "storage", label: "Storage", ok: groupOk(storageChecks), checks: storageChecks },
    { id: "config", label: "Configuration", ok: groupOk(config), checks: config },
  ];

  return {
    ok: groups.every((g) => g.ok),
    generatedAt: Date.now(),
    environment: { lulu: luluEnv, stripe: stripeEnv },
    groups,
  };
}

export function registerHealthRoutes(app: Express): void {
  // Full system health — guarded by `/admin` (requireVerified + requireAdmin).
  app.get("/admin/health", async (_req: Request, res: ExpressResponse) => {
    try {
      res.json(await systemHealth());
    } catch (err) {
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Health check failed." } });
    }
  });
}
