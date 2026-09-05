/**
 * The coupon engine's HTTP surface: admin, customer, and one public route.
 *
 * ## Three tiers, three trust levels
 *
 *   - `/admin/coupons/*` and `/admin/config/coupons` — the operator's surface,
 *     gated by `permissionGate` in `app.ts` against the rules in
 *     `permissions.ts`. Minting, revoking and granting are separate routes from
 *     reading, because they're separately grantable.
 *
 *   - `/account/coupons/*` — the signed-in customer. Mounted under `/account`,
 *     which `app.ts` guards with `requireVerified`.
 *
 *   - `GET /q/:id` — public, unauthenticated, and the only route here that a
 *     scanner hits. It has to work for someone who has never visited the site,
 *     on a phone, from a printed poster, so it can't require anything.
 *
 * ## Why code validation is rate-limited but not authenticated harder
 *
 * `POST /account/coupons/preview` is an oracle: it says whether a string is a
 * real code. It already requires a verified account, which makes enumeration
 * expensive, and unknown/revoked codes deliberately return the SAME message so
 * the response can't be used to map the code space. The per-account throttle
 * below is the third layer — a verified account that tries two hundred codes is
 * not shopping.
 */
import express, { type Express, type Request, type Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import type { AuthedRequest } from "../auth";
import {
  getCouponsConfig,
  saveCouponsConfig,
} from "../appConfig";
import {
  createCoupon,
  formatCouponCode,
  maskCouponCode,
  type Coupon,
  type CouponGrantRecord,
} from "../../../books-frontend/src/core/config/coupons";
import { sendCouponGrantedEmail } from "../email/triggers";
import {
  autoGrantCoupons,
  couponHistory,
  couponWallet,
  grantCouponManually,
  previewCoupon,
  refreshGrantTerms,
  simulateCoupon,
  voidRedemption,
} from "./redemption";
import { couponReport, readCounters } from "./stats";
import {
  generateCodes,
  listCodes,
  listGrantsFor,
  listGrantsForCoupon,
  recentRedemptions,
  revokeCodes,
  revokeGrant,
} from "./store";
import { recordArrival, resolveQrArrival } from "../acquisition";

// ---- Customer routes --------------------------------------------------------

const previewSchema = z.object({
  code: z.string().min(1).max(64),
  itemType: z.enum(["print", "ebook", "pack", "plan"]),
  subtotal: z.number().min(0).max(1_000_000),
  currency: z.string().min(3).max(3),
  productId: z.string().max(120).optional(),
  country: z.string().max(2).optional(),
});

const arrivalSchema = z.object({
  kind: z.string().max(20),
  id: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  medium: z.string().max(64).optional(),
  campaign: z.string().max(64).optional(),
  landingPath: z.string().max(200).optional(),
  referrer: z.string().max(300).optional(),
});

/**
 * Attempts per account per window. Generous enough that nobody legitimately
 * retyping a code off a crumpled receipt ever sees it, tight enough that
 * enumeration isn't worth starting.
 */
const PREVIEW_LIMIT = 20;
const PREVIEW_WINDOW_MS = 10 * 60_000;
const previewAttempts = new Map<string, { count: number; resetAt: number }>();

function throttled(uid: string): boolean {
  const now = Date.now();
  const entry = previewAttempts.get(uid);
  if (!entry || now > entry.resetAt) {
    previewAttempts.set(uid, { count: 1, resetAt: now + PREVIEW_WINDOW_MS });
    return false;
  }
  entry.count++;
  // In-memory, so it resets when the instance recycles. That's an acceptable
  // ceiling for a throttle whose job is to make enumeration tedious rather than
  // impossible — a Firestore counter on this path would cost a write per
  // keystroke-triggered validation.
  if (previewAttempts.size > 10_000) previewAttempts.clear();
  return entry.count > PREVIEW_LIMIT;
}

export function registerCouponUserRoutes(app: Express): void {
  const json = express.json({ limit: "8kb" });

  /**
   * Would this code work on what I'm about to buy?
   *
   * Answers with the money, not just a yes — the customer needs to see what
   * they'd save before committing, and quoting a percentage against a subtotal
   * they can't see is how "20% off" turns into a complaint.
   */
  app.post("/account/coupons/preview", json, async (req: AuthedRequest, res: Response) => {
    const parsed = previewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { message: "Tell us the code and what you're buying." } });
      return;
    }
    if (throttled(req.uid!)) {
      res.status(429).json({
        ok: false,
        reason: "throttled",
        message: "Too many attempts. Wait a few minutes and try again.",
      });
      return;
    }
    try {
      const verdict = await previewCoupon({
        uid: req.uid!,
        code: parsed.data.code,
        purchase: {
          itemType: parsed.data.itemType,
          subtotal: parsed.data.subtotal,
          currency: parsed.data.currency.toUpperCase(),
          productId: parsed.data.productId ?? null,
          country: parsed.data.country ?? null,
        },
      });
      res.json(verdict);
    } catch (err) {
      console.warn("[coupons] preview failed", err);
      // Soft-fail as a refusal rather than a 500: the customer needs an answer,
      // and "couldn't check" is honest where a stack trace isn't.
      res.json({
        ok: false,
        reason: "unknown_code",
        message: "We couldn't check that code just now. Please try again.",
      });
    }
  });

  /**
   * What discounts do I currently hold?
   *
   * The route that makes an auto-applied coupon real to the customer. Without
   * it, a discount granted by a QR scan is invisible until checkout — and the
   * whole point of the poster was to make somebody feel they got something.
   */
  app.get("/account/coupons", async (req: AuthedRequest, res: Response) => {
    try {
      const [held, used] = await Promise.all([
        couponWallet(req.uid!),
        couponHistory(req.uid!, 10),
      ]);
      res.json({
        coupons: held,
        history: used.map((r) => ({
          couponName: r.couponName,
          summary: r.terms?.summary ?? r.couponName,
          code: r.code ? formatCouponCode(r.code) : null,
          discountAmount: r.discountAmount,
          currency: r.currency,
          at: r.settledAt ?? r.createdAt,
        })),
      });
    } catch (err) {
      console.warn("[coupons] wallet failed", err);
      // Soft-fail: a coupon panel that can't load must not break the wallet.
      res.json({ coupons: [], history: [] });
    }
  });

  /**
   * Record how this session arrived.
   *
   * Fire-and-forget from the client's perspective, and deliberately so: it runs
   * on a landing where the customer is trying to do something else, and a
   * failure here must never be visible. Auto-granting is triggered from the same
   * request rather than a background job, because the customer may be one click
   * from checkout and a discount that lands a minute late is a discount they
   * didn't get.
   */
  app.post("/account/arrival", json, async (req: AuthedRequest, res: Response) => {
    const parsed = arrivalSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.json({ recorded: false });
      return;
    }
    try {
      const result = await recordArrival(req.uid!, parsed.data);
      if (!result) {
        res.json({ recorded: false });
        return;
      }
      const granted = await grantAndAnnounce(req.uid!, result.arrival.token);
      res.json({ recorded: true, granted });
    } catch (err) {
      console.warn("[acquisition] arrival failed", err);
      res.json({ recorded: false });
    }
  });
}

/**
 * Auto-grant, then tell the customer.
 *
 * Exported so the signup path and the arrival path share one implementation:
 * whether the QR scan happened before or after the account existed must not
 * change what they end up with.
 */
export async function grantAndAnnounce(
  uid: string,
  source?: string,
): Promise<{ couponId: string; summary: string }[]> {
  const granted = await autoGrantCoupons({ uid, source });
  const announced: { couponId: string; summary: string }[] = [];
  for (const { coupon, grant } of granted) {
    announced.push({ couponId: coupon.id, summary: grant.terms.summary });
    // Only ever reached for a NEWLY created grant (`createGrant` returns null
    // otherwise), so a repeated arrival can't re-announce the same discount.
    await sendCouponGrantedEmail({
      uid,
      couponId: coupon.id,
      summary: grant.terms.summary,
      notes: grant.terms.notes,
      endsAt: grant.terms.restrictions.endsAt,
    }).catch(() => {});
  }
  return announced;
}

// ---- Public QR redirect -----------------------------------------------------

/**
 * The scan hop: `/q/{qrId}` → wherever that code currently points, with the
 * arrival token attached.
 *
 * Registered before the auth middleware because a poster on a wall has no
 * session. A code that can't be resolved is sent to the homepage rather than
 * 404'd: a dead QR that lands somewhere sensible is a bad scan, while a dead QR
 * that shows an error page is a bad brand — and the code may be printed inside a
 * book that will outlive several site redesigns.
 */
export function registerQrRedirectRoute(app: Express): void {
  app.get("/q/:id", async (req: Request, res: Response) => {
    let destination = "/";
    try {
      const resolved = await resolveQrArrival(req.params.id ?? "");
      if (resolved) destination = resolved.destination;
    } catch {
      /* fall through to the homepage */
    }
    // 302, not 301: the whole point of the indirection is that the destination
    // can change after the code is printed, and a permanent redirect would be
    // cached by the scanner forever.
    res.redirect(302, destination);
  });
}

// ---- Admin routes -----------------------------------------------------------

const generateSchema = z.object({
  count: z.number().min(1).max(5_000),
  length: z.number().min(6).max(24).optional(),
  prefix: z.string().max(8).optional(),
});

/**
 * Which account a grant action applies to — by uid, or by email.
 *
 * Email is here because it's what an operator actually has. A make-good starts
 * as a support conversation, and sending someone off to find a uid first is how
 * a discount gets granted to the wrong person.
 */
const accountSchema = z.object({
  uid: z.string().min(1).max(128).optional(),
  email: z.string().min(3).max(320).optional(),
});

async function resolveAccount(input: z.infer<typeof accountSchema>): Promise<string> {
  if (input.uid) return input.uid;
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Which account? Give a uid or an email address.");
  try {
    return (await getAuth().getUserByEmail(email)).uid;
  } catch {
    // Deliberately says the address rather than "not found": the operator
    // typed it, and the usual cause is a typo they can only spot if we quote it.
    throw new Error(`Nobody has signed up with ${email}.`);
  }
}

const simulateSchema = z.object({
  coupon: z.unknown(),
  subtotal: z.number().min(0).max(1_000_000),
});

function handleError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : "Something went wrong.";
  const status = /doesn't exist|not found/i.test(message) ? 404 : 400;
  res.status(status).json({ error: { message } });
}

export function registerCouponAdminRoutes(app: Express): void {
  const json = express.json({ limit: "1mb" });

  app.get("/admin/config/coupons", async (_req: Request, res: Response) => {
    try {
      res.json(await getCouponsConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/coupons", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveCouponsConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * The list the Coupons tab renders: every coupon with its live counters.
   *
   * Counters come from the coupon's own counter document rather than a scan of
   * redemptions, so an operator with a code that's been used ten thousand times
   * still gets an instant page.
   */
  app.get("/admin/coupons", async (_req: Request, res: Response) => {
    try {
      const config = await getCouponsConfig();
      const rows = await Promise.all(
        config.coupons.map(async (coupon) => {
          const counters = await readCounters(coupon.id);
          const codes = await codeSummary(coupon);
          return {
            coupon,
            redeemed: counters.redeemed,
            discount: counters.discount,
            revenue: counters.revenue,
            ...codes,
          };
        }),
      );
      res.json({ enabled: config.enabled, coupons: rows });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** The daily series, rejection breakdown and remaining caps for one coupon. */
  app.get("/admin/coupons/:id/report", async (req: Request, res: Response) => {
    try {
      const config = await getCouponsConfig();
      const coupon = config.coupons.find((c) => c.id === req.params.id);
      if (!coupon) {
        res.status(404).json({ error: { message: "That coupon doesn't exist." } });
        return;
      }
      const to = Number(req.query.to) || Date.now();
      const from = Number(req.query.from) || to - 30 * 86_400_000;
      res.json(await couponReport(coupon, from, to));
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Mint a batch of single-use codes.
   *
   * The generated strings are returned ONCE, in this response, because that's
   * the only moment they're needed — they go straight into a print run or a
   * mail merge. Afterwards the admin list shows them masked: an operator has no
   * routine reason to read an unredeemed code back out, and a screen that
   * displays ten thousand live codes is a screenshot away from being a leak.
   */
  app.post("/admin/coupons/:id/codes", json, async (req: Request, res: Response) => {
    try {
      const parsed = generateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "How many codes, and how long?" } });
        return;
      }
      const config = await getCouponsConfig();
      const coupon = config.coupons.find((c) => c.id === req.params.id);
      if (!coupon) {
        res.status(404).json({ error: { message: "That coupon doesn't exist." } });
        return;
      }
      if (coupon.issuance !== "generatedCodes") {
        res.status(400).json({
          error: {
            message:
              `"${coupon.name}" isn't set to use generated codes. Change its issuance to ` +
              `"Generated single-use codes" first, so the caps that apply to a batch actually apply.`,
          },
        });
        return;
      }
      const batchId = `batch_${Date.now().toString(36)}`;
      const codes = await generateCodes({
        couponId: coupon.id,
        count: parsed.data.count,
        length: parsed.data.length,
        prefix: parsed.data.prefix,
        batchId,
      });
      res.json({ batchId, created: codes.length, codes });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Every code for a coupon, masked, with its usage. The leak-hunting view. */
  app.get("/admin/coupons/:id/codes", async (req: Request, res: Response) => {
    try {
      const codes = await listCodes(req.params.id, Number(req.query.limit) || 200);
      res.json({
        codes: codes.map((c) => ({
          code: maskCouponCode(c.code),
          redeemedCount: c.redeemedCount,
          reservedCount: c.reservedCount,
          revoked: c.revoked,
          batchId: c.batchId,
          boundUid: c.boundUid,
          createdAt: c.createdAt,
        })),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Kill a leaked batch (or every code for a coupon) in one action. */
  app.post("/admin/coupons/:id/codes/revoke", json, async (req: Request, res: Response) => {
    try {
      const batchId = String((req.body as { batchId?: unknown })?.batchId ?? "") || null;
      res.json({ revoked: await revokeCodes(req.params.id, batchId) });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Hand a no-code coupon to one named account — the make-good path. */
  app.post("/admin/coupons/:id/grant", json, async (req: Request, res: Response) => {
    try {
      const parsed = accountSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Which account?" } });
        return;
      }
      const uid = await resolveAccount(parsed.data);
      const granted = await grantCouponManually({
        uid,
        couponId: req.params.id,
        by: (req as AuthedRequest).uid ?? "admin",
      });
      if (!granted) {
        res.json({ granted: false, uid, message: "That account already has this coupon." });
        return;
      }
      await sendCouponGrantedEmail({
        uid,
        couponId: granted.coupon.id,
        summary: granted.grant.terms.summary,
        notes: granted.grant.terms.notes,
        endsAt: granted.grant.terms.restrictions.endsAt,
      }).catch(() => {});
      res.json({ granted: true, uid, summary: granted.grant.terms.summary });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/coupons/:id/revoke-grant", json, async (req: Request, res: Response) => {
    try {
      const parsed = accountSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Which account?" } });
        return;
      }
      await revokeGrant(await resolveAccount(parsed.data), req.params.id);
      res.json({ revoked: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Re-freeze one account's grant against the coupon's current terms.
   *
   * Exists because frozen terms are otherwise permanent, and an operator who
   * fixed a typo in a coupon's copy has no other way to correct what an existing
   * holder sees. Deliberately per-account and explicit — a bulk "refresh
   * everyone" would silently rewrite promises, which is exactly what freezing
   * was for.
   */
  app.post("/admin/coupons/:id/refresh-grant", json, async (req: Request, res: Response) => {
    try {
      const parsed = accountSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Which account?" } });
        return;
      }
      const uid = await resolveAccount(parsed.data);
      res.json({ refreshed: await refreshGrantTerms(uid, req.params.id) });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Who holds this coupon.
   *
   * Scoped to one account when asked, otherwise the whole list newest-first —
   * "who did we give this to" is the question an operator has after a campaign,
   * and answering it only per-account means they can't audit what they sent out.
   * Emails are resolved here rather than shipped from Firestore, because the
   * grant document deliberately stores nothing but a uid.
   */
  app.get("/admin/coupons/:id/grants", async (req: Request, res: Response) => {
    try {
      const uid = String(req.query.uid ?? "");
      const email = String(req.query.email ?? "");
      const grants = uid || email
        ? (await listGrantsFor(await resolveAccount({ uid: uid || undefined, email: email || undefined }))).filter(
            (g) => g.couponId === req.params.id,
          )
        : await listGrantsForCoupon(req.params.id, Number(req.query.limit) || 100);
      res.json({ grants: await withAccountEmails(grants) });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Recent redemptions, for the report's activity list and for support. */
  app.get("/admin/coupons/redemptions", async (req: Request, res: Response) => {
    try {
      const couponId = String(req.query.couponId ?? "") || null;
      const rows = await recentRedemptions(couponId, Number(req.query.limit) || 100);
      res.json({
        redemptions: rows.map((r) => ({
          id: r.id,
          couponId: r.couponId,
          couponName: r.couponName,
          // Masked even for an owner: a support conversation matches on the last
          // four, and nothing here needs the whole string.
          code: r.code ? maskCouponCode(r.code) : null,
          uid: r.uid,
          status: r.status,
          itemType: r.itemType,
          percentOff: r.percentOff,
          discountAmount: r.discountAmount,
          originalSubtotal: r.originalSubtotal,
          currency: r.currency,
          createdAt: r.createdAt,
          settledAt: r.settledAt,
          note: r.note,
        })),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/admin/coupons/redemptions/:id/void",
    json,
    async (req: Request, res: Response) => {
      try {
        const by = (req as AuthedRequest).uid ?? "admin";
        res.json({ voided: await voidRedemption(req.params.id, by) });
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  /**
   * What would this coupon take off an order of this size?
   *
   * Takes the coupon in the body rather than by id, so a DRAFT the operator is
   * still editing can be costed — which is the only moment the number is any
   * use.
   */
  app.post("/admin/coupons/simulate", json, async (req: Request, res: Response) => {
    try {
      const parsed = simulateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "A coupon and a subtotal are required." } });
        return;
      }
      const coupon = createCoupon(parsed.data.coupon as Partial<Coupon>);
      res.json(simulateCoupon(coupon, parsed.data.subtotal));
    } catch (err) {
      handleError(res, err);
    }
  });
}

/**
 * Attach a recognisable email to each grant.
 *
 * A grant document stores a uid and nothing else, deliberately — the coupon
 * collections aren't a second copy of the user directory, and a stale email
 * cached there would be worse than none. The admin list still has to show
 * something a human can match against a support ticket, so it's resolved at
 * read time and thrown away again.
 */
async function withAccountEmails(
  grants: CouponGrantRecord[],
): Promise<(CouponGrantRecord & { email: string | null })[]> {
  // `getUsers` takes at most 100 identifiers per call, which is also more rows
  // than the panel shows.
  const uids = [...new Set(grants.map((g) => g.uid).filter(Boolean))].slice(0, 100);
  const emails = new Map<string, string>();
  if (uids.length > 0) {
    try {
      const found = await getAuth().getUsers(uids.map((uid) => ({ uid })));
      for (const user of found.users) if (user.email) emails.set(user.uid, user.email);
    } catch {
      // A directory hiccup leaves the list showing uids, which is still usable.
    }
  }
  return grants.map((g) => ({ ...g, email: emails.get(g.uid) ?? null }));
}

/** Code counts for the admin list, without shipping the codes themselves. */
async function codeSummary(
  coupon: Coupon,
): Promise<{ codeCount: number; liveCodeCount: number; sharedCode: string | null }> {
  if (coupon.issuance === "sharedCode") {
    return {
      codeCount: coupon.sharedCode ? 1 : 0,
      liveCodeCount: coupon.sharedCode ? 1 : 0,
      // The shared code IS the offer's public identity — it's printed on things.
      // Masking it would only hide it from the person who chose it.
      sharedCode: coupon.sharedCode ? formatCouponCode(coupon.sharedCode) : null,
    };
  }
  if (coupon.issuance !== "generatedCodes") {
    return { codeCount: 0, liveCodeCount: 0, sharedCode: null };
  }
  const codes = await listCodes(coupon.id, 2_000);
  return {
    codeCount: codes.length,
    liveCodeCount: codes.filter((c) => !c.revoked && c.redeemedCount === 0).length,
    sharedCode: null,
  };
}
