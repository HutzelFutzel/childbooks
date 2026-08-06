/**
 * Admin endpoints for the affiliate program.
 *
 * Read-only over Rewardful's data by design: rates, caps, payouts and affiliate
 * accounts are edited in Rewardful, and duplicating those controls here would
 * create a second place where the truth lives. What this exposes instead is the
 * mirror (fast, joined to our own payments) plus the two things that genuinely
 * belong to us — the scope map and the setup readiness of the integration.
 *
 * The dashboard reads the MIRROR, never the Rewardful API, so opening the tab
 * costs nothing against a 45-request-per-30-seconds budget. The one exception is
 * the optional connectivity ping used by the readiness panel.
 */
import { type Express, type Request, type Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import { serverConfig } from "../config";
import { getAffiliateConfig } from "../appConfig";
import {
  emptySyncStatus,
  type AffiliateCampaignMirror,
  type AffiliateCommissionMirror,
  type AffiliateOverview,
  type AffiliatePartnerMirror,
  type AffiliatePayoutMirror,
  type AffiliateStateTotals,
  type AffiliateTotals,
} from "../../../books-frontend/src/core/config/affiliates";
import { pingRewardful, rewardfulConfigured } from "./api";
import {
  CAMPAIGNS_COLLECTION,
  COMMISSIONS_COLLECTION,
  PARTNERS_COLLECTION,
  PAYOUTS_COLLECTION,
  readSyncStatus,
} from "./mirror";
import { reconcileAffiliates } from "./sync";

/**
 * Safety cap on the commission scan. Well past what this program will produce;
 * the dashboard says so when it's hit rather than showing a quiet under-count.
 */
const MAX_COMMISSIONS = 5_000;
const RECENT_LIMIT = 50;

function db() {
  ensureAdmin();
  return getFirestore();
}

function emptyTotals(): AffiliateTotals {
  return { commissions: 0, pendingUsd: 0, dueUsd: 0, paidUsd: 0, voidedUsd: 0, salesUsd: 0 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundTotals(t: AffiliateTotals): AffiliateTotals {
  return {
    commissions: t.commissions,
    pendingUsd: round2(t.pendingUsd),
    dueUsd: round2(t.dueUsd),
    paidUsd: round2(t.paidUsd),
    voidedUsd: round2(t.voidedUsd),
    salesUsd: round2(t.salesUsd),
  };
}

async function loadOverview(ping: boolean): Promise<Omit<AffiliateOverview, "webhook">> {
  const [config, campaignsSnap, partnersSnap, commissionsSnap, payoutsSnap, syncRaw] = await Promise.all([
    getAffiliateConfig(),
    db().collection(CAMPAIGNS_COLLECTION).get(),
    db().collection(PARTNERS_COLLECTION).get(),
    db().collection(COMMISSIONS_COLLECTION).limit(MAX_COMMISSIONS).get(),
    db().collection(PAYOUTS_COLLECTION).orderBy("createdAt", "desc").limit(25).get(),
    readSyncStatus(),
  ]);

  const campaigns = campaignsSnap.docs
    .map((d) => d.data() as AffiliateCampaignMirror)
    .sort((a, b) => a.name.localeCompare(b.name));

  const commissions = commissionsSnap.docs.map((d) => d.data() as AffiliateCommissionMirror);

  const byState: Record<string, AffiliateStateTotals> = {};
  const totalsByAffiliate = new Map<string, AffiliateTotals>();
  const outOfScope: AffiliateCommissionMirror[] = [];

  for (const c of commissions) {
    // Tombstoned rows are history, not liability — they're excluded from every
    // total but stay readable through the commission itself.
    if (c.deletedAt) continue;

    const state = c.state || "pending";
    const bucket = (byState[state] ??= { count: 0, usd: 0 });
    bucket.count++;
    bucket.usd += c.amountUsd || 0;

    if (c.affiliateId) {
      const totals = totalsByAffiliate.get(c.affiliateId) ?? emptyTotals();
      totals.commissions++;
      if (state === "pending") totals.pendingUsd += c.amountUsd || 0;
      else if (state === "due") totals.dueUsd += c.amountUsd || 0;
      else if (state === "paid") totals.paidUsd += c.amountUsd || 0;
      else if (state === "voided") totals.voidedUsd += c.amountUsd || 0;
      // Gross sale behind the commission, for the cost-of-sale ratio. Uses the
      // sale's own currency-agnostic cents; close enough for a ratio.
      if (typeof c.saleAmountCents === "number") totals.salesUsd += c.saleAmountCents / 100;
      totalsByAffiliate.set(c.affiliateId, totals);
    }

    if (c.inScope === false && state !== "voided") outOfScope.push(c);
  }

  for (const state of Object.keys(byState)) byState[state].usd = round2(byState[state].usd);

  const partners = partnersSnap.docs
    .map((d) => d.data() as AffiliatePartnerMirror)
    .map((p) => ({ ...p, totals: roundTotals(totalsByAffiliate.get(p.id) ?? emptyTotals()) }))
    .sort((a, b) => b.totals.paidUsd + b.totals.dueUsd - (a.totals.paidUsd + a.totals.dueUsd));

  const recentCommissions = [...commissions]
    .filter((c) => !c.deletedAt)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, RECENT_LIMIT);

  const pingResult = ping && rewardfulConfigured() ? await pingRewardful() : null;

  return {
    config,
    readiness: {
      apiConfigured: rewardfulConfigured(),
      webhookConfigured: Boolean(serverConfig().rewardful.webhookToken.trim()),
      liveEnv: serverConfig().stripe.env === "live",
      enabled: config.enabled,
      apiReachable: pingResult ? pingResult.ok : null,
      apiError: pingResult?.error ?? null,
    },
    campaigns,
    partners,
    byState,
    recentCommissions,
    payouts: payoutsSnap.docs.map((d) => d.data() as AffiliatePayoutMirror),
    outOfScope: outOfScope.slice(0, RECENT_LIMIT),
    sync: { ...emptySyncStatus(), ...syncRaw },
  };
}

/**
 * The exact URL to paste into Rewardful → Webhooks, with the token masked (the
 * admin generated it, so masking costs them nothing and keeps the secret out of
 * an HTTP response).
 *
 * The host comes from the request — the admin is already talking to the Functions
 * origin, which is NOT the storefront's. The `/api` segment has to be added back
 * by hand: Express inside the function never sees the mount prefix, and that
 * prefix is the deployed function's name (`export const api` in index.ts).
 */
function webhookInfo(req: Request): { url: string; configured: boolean } {
  const token = serverConfig().rewardful.webhookToken.trim();
  const host = req.get("host") ?? "";
  const emulated = process.env.FUNCTIONS_EMULATOR === "true";
  const prefix = emulated
    ? `/${process.env.GCLOUD_PROJECT ?? "demo"}/us-central1/api`
    : "/api";
  const masked = token ? `${token.slice(0, 4)}…${token.slice(-4)}` : "<REWARDFUL_WEBHOOK_TOKEN>";
  return {
    url: `${req.protocol}://${host}${prefix}/rewardful-webhook?token=${masked}`,
    configured: Boolean(token),
  };
}

export function registerAffiliateAdminRoutes(app: Express): void {
  app.get("/admin/affiliates/overview", async (req: Request, res: Response) => {
    try {
      const overview = await loadOverview(req.query.ping === "1");
      res.json({ ...overview, webhook: webhookInfo(req) });
    } catch (err) {
      console.error("[affiliates] overview failed", err);
      res.status(500).json({ error: { message: "Could not load the affiliate overview." } });
    }
  });

  /**
   * Pull everything from Rewardful now. Tombstoning is OFF unless explicitly
   * asked for (`?prune=1`): the usual reason to press this is "the webhook missed
   * something", and a half-finished fetch must not be able to mass-tombstone the
   * mirror on a button press.
   */
  app.post("/admin/affiliates/sync", async (req: Request, res: Response) => {
    try {
      if (!rewardfulConfigured()) {
        res.status(503).json({ error: { message: "Rewardful is not configured (no API secret)." } });
        return;
      }
      const status = await reconcileAffiliates({ skipTombstones: req.query.prune !== "1" });
      res.json(status);
    } catch (err) {
      console.error("[affiliates] manual sync failed", err);
      res.status(502).json({
        error: { message: err instanceof Error ? err.message : "Sync failed." },
      });
    }
  });
}
