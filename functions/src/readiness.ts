/**
 * Go-live readiness + the sandbox↔live runtime toggle.
 *
 * The admin dashboard can flip the whole backend (Stripe + Lulu) between
 * sandbox and live WITHOUT a redeploy (see runtimeConfig.ts). Flipping to "live"
 * is dangerous if the live side isn't actually set up, so before allowing it we
 * run a readiness probe that checks — against the LIVE credentials specifically,
 * regardless of the currently active env — that:
 *   - the live secrets are bound (deployed with LIVE_ENABLED=true),
 *   - the live Stripe key authenticates and the account can take charges,
 *   - a live webhook endpoint + signing secret are configured,
 *   - every active paid plan has a LIVE Stripe price that exists and is active,
 *   - the live Lulu credentials authenticate and a status webhook is registered.
 *
 * Routes (mounted under /admin, so already admin-gated):
 *   GET  /admin/runtime              → { env, override, default }
 *   PUT  /admin/runtime { env, force }→ flip the active env (gated by readiness)
 *   GET  /admin/readiness?env=live   → the readiness report for an env
 */
import Stripe from "stripe";
import express, { type Express, type Request, type Response as ExpressResponse } from "express";
import { loadServerConfig } from "../../books-frontend/src/core/config/serverEnv";
import {
  BILLING_INTERVALS,
  priceIdForEnv,
  type BillingEnv,
  type PlanDefinition,
} from "../../books-frontend/src/core/config/plans";
import { createLuluProvider } from "../../books-frontend/src/core/fulfillment/lulu/provider";
import { createAdminAssetHost } from "./assets";
import { serverConfig } from "./config";
import { getPlansConfig, reprojectPublicPlans } from "./plans";
import { keyMode, maskKey } from "./stripeClient";
import { liveSecretsBound } from "./secrets";
import { getRuntimeEnv, setRuntimeEnv } from "./runtimeConfig";
import type { AuthedRequest } from "./auth";
import type { CheckStatus, HealthCheck, HealthGroup } from "./health";

export interface ReadinessReport {
  /** The environment that was probed (typically "live"). */
  env: BillingEnv;
  ok: boolean;
  generatedAt: number;
  /** Whether the live secrets are injected into this deployment (LIVE_ENABLED). */
  secretsBound: boolean;
  groups: HealthGroup[];
}

function groupOk(checks: HealthCheck[]): boolean {
  return checks.every((c) => c.status !== "fail");
}

function check(id: string, label: string, status: CheckStatus, message: string, fix?: string): HealthCheck {
  return fix ? { id, label, status, message, fix } : { id, label, status, message };
}

/** The env-specific config (secret key, webhook secret, Lulu creds) for a target env. */
function configFor(env: BillingEnv) {
  return loadServerConfig(process.env as Record<string, string | undefined>, { envOverride: env });
}

// ---- Stripe readiness ------------------------------------------------------

async function stripeReadiness(env: BillingEnv, stripe: Stripe, secretKey: string, webhookSecret: string): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const expectedMode = env === "live" ? "live" : "test";

  const mode = keyMode(secretKey);
  if (mode !== expectedMode && mode !== "unknown") {
    checks.push(
      check(
        "stripe-key-mode",
        "Stripe key mode",
        "fail",
        `Configured key is a ${mode} key (${maskKey(secretKey)}) but ${env} needs an ${expectedMode} key.`,
        `Set STRIPE_${env === "live" ? "LIVE" : "SANDBOX"}_SECRET_KEY to an sk_${expectedMode}_… key.`,
      ),
    );
  }

  try {
    const account = await stripe.accounts.retrieve(null);
    checks.push(
      account.charges_enabled
        ? check("stripe-account", "Stripe account", "pass", `Account ${account.id} can accept charges.`)
        : check(
            "stripe-account",
            "Stripe account",
            "fail",
            "The live Stripe account can't accept charges yet (charges_enabled is false).",
            "Complete account activation / verification in the Stripe dashboard.",
          ),
    );
  } catch (err) {
    checks.push(
      check(
        "stripe-account",
        "Stripe account",
        "fail",
        `Stripe rejected the ${env} key: ${(err as Error)?.message ?? "unknown error"}.`,
        "Check the live secret key value and that it belongs to the right account.",
      ),
    );
    return checks; // can't go further without a working client
  }

  checks.push(
    webhookSecret
      ? check("stripe-webhook-secret", "Stripe webhook secret", "pass", "A live webhook signing secret is configured.")
      : check(
          "stripe-webhook-secret",
          "Stripe webhook secret",
          "fail",
          "No live webhook signing secret, so incoming events can't be verified.",
          "Set STRIPE_LIVE_WEBHOOK_SECRET to the signing secret of your live webhook endpoint.",
        ),
  );

  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const enabled = endpoints.data.filter((e) => e.status === "enabled");
    checks.push(
      enabled.length > 0
        ? check("stripe-webhook-endpoint", "Stripe webhook endpoint", "pass", `${enabled.length} enabled webhook endpoint(s).`)
        : check(
            "stripe-webhook-endpoint",
            "Stripe webhook endpoint",
            "fail",
            "No enabled webhook endpoints on the live account.",
            "Add a webhook → https://<host>/api/stripe-webhook for checkout.session.completed, payment_intent.*, charge.refunded, customer.subscription.*, invoice.paid.",
          ),
    );
  } catch {
    checks.push(check("stripe-webhook-endpoint", "Stripe webhook endpoint", "warn", "Couldn't list webhook endpoints."));
  }

  return checks;
}

// ---- Plan price coverage ---------------------------------------------------

async function plansReadiness(env: BillingEnv, stripe: Stripe, plans: PlanDefinition[]): Promise<HealthCheck[]> {
  const paid = plans.filter((p) => !p.isFree && p.status === "active");
  if (paid.length === 0) {
    return [check("plans-coverage", "Plan prices", "warn", "No active paid plans to sell.")];
  }

  const missing: string[] = [];
  const broken: string[] = [];
  let verified = 0;

  for (const plan of paid) {
    for (const [currency, byInterval] of Object.entries(plan.billing.prices)) {
      for (const interval of BILLING_INTERVALS) {
        const pp = byInterval?.[interval];
        if (!pp || pp.amount <= 0) continue;
        const id = priceIdForEnv(pp, env);
        if (!id) {
          missing.push(`${plan.presentation.name} ${currency}/${interval}`);
          continue;
        }
        try {
          const price = await stripe.prices.retrieve(id);
          if (!price.active) broken.push(`${plan.presentation.name} ${currency}/${interval} (archived)`);
          else verified += 1;
        } catch {
          broken.push(`${plan.presentation.name} ${currency}/${interval} (not found in ${env})`);
        }
      }
    }
  }

  if (missing.length > 0 || broken.length > 0) {
    const parts = [
      missing.length ? `missing ${env} price for: ${missing.join(", ")}` : "",
      broken.length ? `invalid ${env} price for: ${broken.join(", ")}` : "",
    ].filter(Boolean);
    return [
      check(
        "plans-coverage",
        "Plan prices",
        "fail",
        `Subscription checkout would fail in ${env}: ${parts.join("; ")}.`,
        `Switch to ${env} first (or run a sync) and re-save each plan so its prices are created in ${env} Stripe.`,
      ),
    ];
  }

  return [check("plans-coverage", "Plan prices", "pass", `All ${verified} active plan price(s) exist in ${env} Stripe.`)];
}

// ---- Lulu readiness --------------------------------------------------------

async function luluReadiness(env: BillingEnv, clientKey: string, clientSecret: string): Promise<HealthCheck[]> {
  if (!clientKey || !clientSecret) {
    return [
      check(
        "lulu-creds",
        "Lulu credentials",
        "fail",
        `No Lulu credentials for ${env}.`,
        `Set LULU_${env === "live" ? "LIVE" : "SANDBOX"}_CLIENT_KEY and …_CLIENT_SECRET as function secrets.`,
      ),
    ];
  }
  try {
    const provider = createLuluProvider({
      httpFetch: (url, init) => fetch(url, init as RequestInit),
      assetHost: createAdminAssetHost(),
      clientKey: () => clientKey,
      clientSecret: () => clientSecret,
      env,
    });
    const hooks = provider.listStatusWebhooks ? await provider.listStatusWebhooks() : [];
    const auth = check("lulu-creds", "Lulu credentials", "pass", `Authenticated against the ${env} Lulu API.`);
    const webhook =
      hooks.length > 0
        ? check("lulu-webhook", "Lulu status webhook", "pass", `${hooks.length} status webhook(s) registered.`)
        : check(
            "lulu-webhook",
            "Lulu status webhook",
            "warn",
            "No order-status webhook registered, so order updates won't arrive.",
            "Register one via POST /admin/print/webhooks once live.",
          );
    return [auth, webhook];
  } catch (err) {
    return [
      check(
        "lulu-creds",
        "Lulu credentials",
        "fail",
        `Lulu rejected the ${env} credentials or was unreachable: ${(err as Error)?.message ?? "error"}.`,
        `Verify the LULU_${env === "live" ? "LIVE" : "SANDBOX"}_* credentials.`,
      ),
    ];
  }
}

// ---- Aggregate -------------------------------------------------------------

export async function goLiveReadiness(env: BillingEnv = "live"): Promise<ReadinessReport> {
  const secretsBound = env === "live" ? liveSecretsBound() : true;
  const cfg = configFor(env);

  // If the (live) secrets aren't even bound / present there's nothing to probe —
  // fail fast with the precise remediation (`new Stripe("")` would throw anyway).
  if (!cfg.stripe.secretKey) {
    const liveHint = env === "live" && !secretsBound;
    const checks = [
      check(
        "secrets",
        `${env === "live" ? "Live" : "Sandbox"} secrets bound`,
        "fail",
        liveHint
          ? "The live secrets aren't injected into this deployment, so live mode can't work."
          : `No Stripe secret key is configured for ${env}.`,
        liveHint
          ? "Add the live keys (firebase functions:secrets:set STRIPE_LIVE_SECRET_KEY …), set LIVE_ENABLED=true in functions/.env.<projectId>, then `yarn deploy`."
          : `Set STRIPE_${env === "live" ? "LIVE" : "SANDBOX"}_SECRET_KEY as a function secret.`,
      ),
    ];
    return {
      env,
      ok: false,
      generatedAt: Date.now(),
      secretsBound,
      groups: [{ id: "secrets", label: "Secrets", ok: false, checks }],
    };
  }

  const stripe = new Stripe(cfg.stripe.secretKey, { appInfo: { name: "childbooks" } });
  const plansConfig = await getPlansConfig();

  const [stripeChecks, planChecks, luluChecks] = await Promise.all([
    stripeReadiness(env, stripe, cfg.stripe.secretKey, cfg.stripe.webhookSecret),
    plansReadiness(env, stripe, plansConfig.plans),
    luluReadiness(env, cfg.fulfillment.lulu.clientKey, cfg.fulfillment.lulu.clientSecret),
  ]);

  const appUrl = cfg.stripe.appUrl;
  const urlCheck: HealthCheck = !appUrl
    ? check("public-app-url", "Public app URL", "fail", "PUBLIC_APP_URL is unset; Checkout redirects will be wrong.", "Set PUBLIC_APP_URL to the production https origin.")
    : !appUrl.startsWith("https://")
      ? check("public-app-url", "Public app URL", "fail", `PUBLIC_APP_URL is "${appUrl}" — must be https in production.`, "Use the https App Hosting origin.")
      : check("public-app-url", "Public app URL", "pass", `Redirects target ${appUrl}.`);

  const groups: HealthGroup[] = [
    { id: "stripe", label: "Payments (Stripe live)", ok: groupOk(stripeChecks), checks: stripeChecks },
    { id: "plans", label: "Subscription plans", ok: groupOk(planChecks), checks: planChecks },
    { id: "lulu", label: "Print (Lulu live)", ok: groupOk(luluChecks), checks: luluChecks },
    { id: "config", label: "Configuration", ok: groupOk([urlCheck]), checks: [urlCheck] },
  ];

  return {
    env,
    ok: groups.every((g) => g.ok),
    generatedAt: Date.now(),
    secretsBound,
    groups,
  };
}

// ---- Routes ----------------------------------------------------------------

function parseEnv(value: unknown): BillingEnv | null {
  return value === "live" ? "live" : value === "sandbox" ? "sandbox" : null;
}

export function registerRuntimeRoutes(app: Express): void {
  const json = express.json();

  // Current + default environment.
  app.get("/admin/runtime", async (_req: Request, res: ExpressResponse) => {
    try {
      const override = await getRuntimeEnv();
      const deployDefault = loadServerConfig(process.env as Record<string, string | undefined>).stripe.env;
      res.json({
        env: serverConfig().stripe.env, // resolved active env (override ?? default)
        override, // explicit Firestore override (null when none)
        default: deployDefault, // deploy-time default (LULU_ENV/STRIPE_ENV)
        liveSecretsBound: liveSecretsBound(),
      });
    } catch (err) {
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Failed to read runtime env." } });
    }
  });

  // Flip the active environment. Flipping to live is gated by readiness unless
  // `force: true` is passed (admin override for known-good setups).
  app.put("/admin/runtime", json, async (req: AuthedRequest, res: ExpressResponse) => {
    try {
      const body = (req.body ?? {}) as { env?: string; force?: boolean };
      const target = parseEnv(body.env);
      if (!target) {
        res.status(400).json({ error: { message: 'env must be "sandbox" or "live".' } });
        return;
      }
      let readiness: ReadinessReport | undefined;
      if (target === "live") {
        readiness = await goLiveReadiness("live");
        if (!readiness.ok && !body.force) {
          res.status(409).json({
            error: { message: "Live environment is not ready. Resolve the failing checks or pass force: true." },
            readiness,
          });
          return;
        }
      }
      await setRuntimeEnv(target, req.uid);
      // Re-derive the public plans doc so the storefront uses the new env's price ids.
      await reprojectPublicPlans().catch(() => {});
      res.json({ env: target, readiness });
    } catch (err) {
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Failed to set runtime env." } });
    }
  });

  // Readiness report for an environment (defaults to live).
  app.get("/admin/readiness", async (req: Request, res: ExpressResponse) => {
    try {
      const env = parseEnv(req.query.env) ?? "live";
      res.json(await goLiveReadiness(env));
    } catch (err) {
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Readiness check failed." } });
    }
  });
}
