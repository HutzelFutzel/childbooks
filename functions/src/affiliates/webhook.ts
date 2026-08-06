/**
 * Rewardful's event webhook.
 *
 * TWO THINGS MAKE THIS DIFFERENT from the Stripe and Lulu receivers next door:
 *
 *   1. **Rewardful does not sign its webhooks.** There is no signature header to
 *      verify — so the endpoint is authenticated by an unguessable token in the
 *      URL we register with them (`?token=…`, compared in constant time). That's
 *      the strongest thing available when the sender offers no signature.
 *
 *   2. **The payload is therefore never trusted.** We read only two fields from
 *      it — the event type and the object id — and then RE-FETCH that object
 *      through the authenticated REST API before anything is stored. A leaked
 *      token buys an attacker the ability to make us re-read our own account, not
 *      to invent an affiliate, a commission or a cost. It also means the mirror
 *      always holds what Rewardful actually says, keeping exactly one source of
 *      truth.
 *
 * A 404 on the re-fetch is meaningful rather than an error: it's Rewardful
 * confirming the object is gone, which is the only trustworthy way to act on a
 * `*.deleted` event.
 *
 * Failures return 500 on purpose — Rewardful retries with backoff for three days,
 * which is exactly what a transient API or Firestore error wants. Payloads we
 * can't act on return 200, because retrying them would never help.
 */
import express, { type Express, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { serverConfig } from "../config";
import { ensureAdmin } from "../storage";
import { getFirestore } from "firebase-admin/firestore";
import {
  getAffiliate,
  getCommission,
  getPayout,
  rewardfulConfigured,
  RewardfulApiError,
} from "./api";
import {
  EVENTS_COLLECTION,
  markCommissionDeleted,
  markMirrorDeleted,
  mirrorCommission,
  mirrorPartner,
  mirrorPayout,
  PARTNERS_COLLECTION,
  PAYOUTS_COLLECTION,
} from "./mirror";

/** Constant-time compare that also tolerates length differences. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface WebhookBody {
  object?: { id?: unknown };
  event?: { id?: unknown; type?: unknown };
}

/**
 * Remember an event id so a redelivery is a no-op. Deliberately recorded AFTER
 * successful processing: a marker written first would make a transient failure
 * permanent by suppressing the retry that would have fixed it. Double-processing
 * in the meantime is harmless — every mirror write and every ledger entry is
 * idempotent.
 */
async function alreadyHandled(eventId: string): Promise<boolean> {
  ensureAdmin();
  const snap = await getFirestore().collection(EVENTS_COLLECTION).doc(eventId).get();
  return snap.exists;
}

async function markHandled(eventId: string, type: string, objectId: string): Promise<void> {
  await getFirestore()
    .collection(EVENTS_COLLECTION)
    .doc(eventId)
    .set({ at: Date.now(), type, objectId }, { merge: true });
}

/**
 * Re-read the object the event refers to and write it to the mirror. Returns
 * false for event families we don't mirror, so the caller can 200 them without
 * pretending work happened.
 */
async function handleEvent(type: string, objectId: string): Promise<boolean> {
  const [family, action] = type.split(".");
  const deleted = action === "deleted";

  switch (family) {
    case "commission":
      if (deleted) await markCommissionDeleted(objectId);
      else await mirrorCommission(await getCommission(objectId));
      return true;

    case "affiliate":
      if (deleted) await markMirrorDeleted(PARTNERS_COLLECTION, objectId);
      else await mirrorPartner(await getAffiliate(objectId));
      return true;

    case "payout":
      if (deleted) await markMirrorDeleted(PAYOUTS_COLLECTION, objectId);
      else await mirrorPayout(await getPayout(objectId));
      return true;

    // Sales and referrals are Rewardful's internal view of money we already
    // track ourselves; anything that matters about them reaches us as the
    // resulting commission event. Affiliate links and coupons aren't mirrored.
    default:
      return false;
  }
}

export function registerAffiliateWebhookRoute(app: Express): void {
  const json = express.json({ limit: "512kb" });

  app.post("/rewardful-webhook", json, async (req: Request, res: Response) => {
    const expected = serverConfig().rewardful.webhookToken.trim();
    if (!expected || !rewardfulConfigured()) {
      // Nothing is configured, so there is nothing this endpoint could do with
      // the event. 503 (not 200) so a misconfiguration is visible in Rewardful's
      // delivery log instead of looking like a success.
      res.status(503).json({ error: { message: "Affiliate program is not configured." } });
      return;
    }

    const provided = typeof req.query.token === "string" ? req.query.token : "";
    if (!tokenMatches(provided, expected)) {
      res.status(401).json({ error: { message: "Invalid token." } });
      return;
    }

    const body = (req.body ?? {}) as WebhookBody;
    const type = typeof body.event?.type === "string" ? body.event.type : "";
    const objectId = typeof body.object?.id === "string" ? body.object.id : "";
    const eventId = typeof body.event?.id === "string" ? body.event.id : "";
    if (!type || !objectId) {
      // Malformed or a shape we don't recognise — a retry can't fix it.
      res.json({ ok: true, ignored: "unparseable" });
      return;
    }

    try {
      if (eventId && (await alreadyHandled(eventId))) {
        res.json({ ok: true, duplicate: true });
        return;
      }

      const handled = await handleEvent(type, objectId);
      if (eventId) await markHandled(eventId, type, objectId);
      res.json({ ok: true, handled });
    } catch (err) {
      // 404 means Rewardful is telling us the object no longer exists, which is
      // a legitimate outcome (an event about something since deleted), not a
      // failure to retry.
      if (err instanceof RewardfulApiError && err.status === 404) {
        try {
          const [family] = type.split(".");
          if (family === "commission") await markCommissionDeleted(objectId);
          else if (family === "affiliate") await markMirrorDeleted(PARTNERS_COLLECTION, objectId);
          else if (family === "payout") await markMirrorDeleted(PAYOUTS_COLLECTION, objectId);
          if (eventId) await markHandled(eventId, type, objectId);
        } catch (inner) {
          console.warn("[affiliates] tombstone after 404 failed", inner);
        }
        res.json({ ok: true, gone: true });
        return;
      }
      console.error("[affiliates] webhook processing failed", type, err);
      // Retryable: Rewardful backs off over three days, by which time the
      // nightly reconcile has usually fixed it anyway.
      res.status(500).json({ error: { message: "Could not process event." } });
    }
  });
}
