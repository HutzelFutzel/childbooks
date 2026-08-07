/**
 * The campaign engine's customer-facing HTTP surface.
 *
 * Two routes, and the second one is the interesting one:
 *
 *   - `GET /account/offers` is the wallet's offers panel. Reading it ENROLLS the
 *     caller in anything they now qualify for, which is deliberate: enrollment
 *     freezes the promise, and the promise should be frozen at the moment the
 *     customer reads it rather than at the moment they act on it.
 *
 *   - `POST /account/offers/preview` answers "what happens if I buy this?" before
 *     the buy. An offer a customer only discovers after checkout isn't marketing,
 *     it's a surprise — and the number here comes from the same evaluator that
 *     pays out, so it can't quietly disagree with the payout.
 *
 * Mounted under `/account`, which `app.ts` guards with `requireVerified`: nothing
 * here is guest-reachable, and an unverified account has nothing to be offered.
 */
import express, { type Express, type Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../auth";
import { CAMPAIGN_TRIGGERS } from "../../../books-frontend/src/core/config/campaigns";
import { offersOverview, previewOffers } from "./offers";

const previewSchema = z.object({
  trigger: z.enum(CAMPAIGN_TRIGGERS).default("purchase"),
  itemType: z.enum(["print", "ebook", "pack", "plan"]).optional(),
  amount: z.number().min(0).max(100_000).optional(),
  productId: z.string().max(120).optional(),
  projectId: z.string().max(120).optional(),
  /** For `survey_completed`: which question set, so a survey-scoped reward previews. */
  surveyId: z.string().max(64).optional(),
});

export function registerCampaignUserRoutes(app: Express): void {
  const json = express.json({ limit: "8kb" });

  app.get("/account/offers", async (req: AuthedRequest, res: Response) => {
    try {
      res.json(await offersOverview(req.uid!));
    } catch (err) {
      console.warn("[campaigns] offers failed", err);
      // Soft-fail: an offers panel that can't load must not break the wallet.
      res.json({ enabled: false, offers: [], redemptions: [] });
    }
  });

  app.post(
    "/account/offers/preview",
    json,
    async (req: AuthedRequest, res: Response) => {
      const parsed = previewSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: { message: "Tell us what you're about to do." } });
        return;
      }
      try {
        res.json({ previews: await previewOffers(req.uid!, parsed.data) });
      } catch (err) {
        console.warn("[campaigns] preview failed", err);
        res.json({ previews: [] });
      }
    },
  );
}
