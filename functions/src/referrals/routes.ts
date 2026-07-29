/**
 * The referral program's HTTP surface.
 *
 * Three access tiers, which is why they live under three path prefixes:
 *
 *   - `/invite/*` is TOKENLESS. An invited person has no account yet, so the
 *     landing preview and — crucially — the decline link have to work without
 *     one. An opt-out that requires signing up is not an opt-out.
 *   - `POST /referrals/accept` needs only *some* identity (`requireAuth`), guests
 *     included: attribution happens the moment the link is followed, long before
 *     the account is verified. Waiting for verification loses everyone who takes
 *     two sessions to sign up.
 *   - the rest of `/referrals/*` is for a real account. Sending is additionally
 *     gated by the config's eligibility rules (see `checkEligibility`).
 *
 * The tokenless routes carry their own coarse per-IP limit, and sending is capped
 * per user per day/month by the program config.
 */
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { isAnonymousToken, type AuthedRequest } from "../auth";
import {
  acceptInvitation,
  declineInvitation,
  previewInvitation,
  referralOverview,
  sendInvitations,
} from "./index";

/** Coarse in-memory per-IP limit for the tokenless routes (per instance). */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

const codeSchema = z.object({ code: z.string().trim().min(4).max(64) });

const inviteSchema = z.object({
  emails: z.array(z.string().trim().max(320)).min(1).max(10),
  message: z.string().trim().max(500).optional(),
});

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: { message } });
}

export function registerReferralPublicRoutes(app: Express): void {
  const json = express.json({ limit: "8kb" });

  // What the invitation promises, for the landing + decline screens. Returns
  // `valid: false` rather than 404 for a spent or expired code, so the page can
  // say something better than "not found".
  app.get("/invite/preview", async (req: Request, res: Response) => {
    if (rateLimited(`preview_${req.ip ?? "unknown"}`)) {
      fail(res, "Too many requests. Please try again later.", 429);
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      fail(res, "Missing invitation code.");
      return;
    }
    try {
      const preview = await previewInvitation(code);
      if (!preview) {
        res.json({ valid: false, inviterName: null, benefit: "" });
        return;
      }
      res.json(preview);
    } catch {
      fail(res, "Could not load this invitation.", 500);
    }
  });

  // The decline link. POST (not GET) so a mail client prefetching the link can't
  // opt someone out by accident — the frontend page turns the click into this
  // call. Always answers `ok` so an unknown code reveals nothing.
  app.post("/invite/decline", json, async (req: Request, res: Response) => {
    if (rateLimited(`decline_${req.ip ?? "unknown"}`)) {
      fail(res, "Too many requests. Please try again later.", 429);
      return;
    }
    const parsed = codeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, "Missing invitation code.");
      return;
    }
    try {
      await declineInvitation(parsed.data.code);
    } catch (err) {
      console.warn("[referrals] decline failed", err);
    }
    res.json({ ok: true });
  });
}

export function registerReferralUserRoutes(app: Express): void {
  const json = express.json({ limit: "8kb" });

  // Attach the caller to the invitation that brought them here. Idempotent and
  // soft-failing: the client fires this once per remembered code and shows a
  // toast only for a fresh attribution.
  app.post("/referrals/accept", json, async (req: AuthedRequest, res: Response) => {
    const parsed = codeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, "Missing invitation code.");
      return;
    }
    try {
      const outcome = await acceptInvitation(req.uid!, parsed.data.code, {
        isAnonymous: isAnonymousToken(req.authToken),
      });
      res.json({ ok: outcome === "attributed", outcome });
    } catch (err) {
      console.warn("[referrals] accept failed", err);
      res.json({ ok: false, outcome: "ineligible" });
    }
  });

  // The whole invite screen in one round trip.
  app.get("/referrals/overview", async (req: AuthedRequest, res: Response) => {
    if (isAnonymousToken(req.authToken)) {
      fail(res, "Create an account to invite friends.", 403);
      return;
    }
    try {
      res.json(await referralOverview(req.uid!));
    } catch (err) {
      console.error("[referrals] overview failed", err);
      fail(res, "Could not load your invitations.", 500);
    }
  });

  app.post("/referrals/invite", json, async (req: AuthedRequest, res: Response) => {
    if (isAnonymousToken(req.authToken)) {
      fail(res, "Create an account to invite friends.", 403);
      return;
    }
    const parsed = inviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, "Please enter at least one email address.");
      return;
    }
    try {
      const result = await sendInvitations(req.uid!, parsed.data.emails, parsed.data.message ?? null);
      res.json(result);
    } catch (err) {
      console.error("[referrals] invite failed", err);
      fail(res, "Could not send your invitations. Please try again.", 500);
    }
  });
}
