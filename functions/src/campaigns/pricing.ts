/**
 * The one campaign effect that is read rather than delivered: a standing price
 * override on an AI action ("fast renders are free until March").
 *
 * This lives in its own module, importing nothing but config, because it sits on
 * the HOT PATH — `estimateForUser` runs on every studio price preview and
 * `settleActionCost` runs on every completed render. Anything that grants
 * Sparks (`effects.ts`) imports the wallet; the wallet imports this. Keeping the
 * two apart is what stops that from becoming an import cycle.
 *
 * Both callers must apply the SAME multiplier or the product lies to the user:
 * a promo that only reached settlement quotes 5 ✦ and charges 0, and one that
 * only reached the quote promises "free" and then bills for it. That symmetry is
 * the whole reason this is a single shared function.
 */
import {
  actionPriceMultiplier,
  audienceVerdict,
  campaignIsLive,
  type Campaign,
  type CampaignRule,
  type UserFacts,
} from "../../../books-frontend/src/core/config/campaigns";
import { IMAGE_TIERS, type ImageTier } from "../../../books-frontend/src/core/config/modelConfig";
import { getCampaignsConfig } from "../appConfig";
import { userFacts } from "./facts";

/**
 * Standing (`always`) rules from every campaign this account is eligible for.
 *
 * Price overrides deliberately do NOT require a stored enrollment: they're a
 * property of the price list while the campaign runs, not a benefit someone
 * earns. Requiring enrollment would mean the first render after a campaign goes
 * live is charged at the old price, which is exactly the kind of off-by-one an
 * operator would report as a billing bug.
 */
async function standingRulesFor(uid: string, facts?: UserFacts): Promise<CampaignRule[]> {
  const config = await getCampaignsConfig();
  if (!config.enabled) return [];
  const live = config.campaigns.filter(
    (c: Campaign) => campaignIsLive(c) && c.rules.some((r) => r.enabled && r.trigger === "always"),
  );
  if (live.length === 0) return [];

  // Only load the account once we know a standing campaign exists at all — the
  // common case is none, and this runs on every render quote.
  const user = facts ?? (await userFacts(uid));
  const out: CampaignRule[] = [];
  for (const campaign of live) {
    if (!audienceVerdict(campaign, user).eligible) continue;
    out.push(...campaign.rules.filter((r) => r.enabled && r.trigger === "always"));
  }
  return out;
}

/**
 * The campaign price multiplier for one action+tier (1 = untouched, 0 = free).
 * Multiplies the plan's own action multiplier at both quote and settle time.
 *
 * Fails OPEN at 1: if campaign config can't be read we charge the normal price
 * rather than accidentally giving the whole catalogue away.
 */
export async function campaignActionMultiplier(
  uid: string,
  action: string,
  tier: ImageTier | null,
): Promise<number> {
  try {
    const rules = await standingRulesFor(uid);
    return actionPriceMultiplier(rules, action, tier);
  } catch {
    return 1;
  }
}

/** What a standing campaign does to one action's price, across both tiers. */
export interface ActionPriceOverride {
  /** Campaign multiplier per tier (1 = untouched, 0 = free). */
  tiers: Record<ImageTier, number>;
  /**
   * The campaign responsible for the best discount, so the studio can say WHY
   * the number is small. An unexplained discount reads as a bug; a labelled one
   * reads as a gift.
   */
  note: { campaignId: string; label: string } | null;
}

/**
 * Every standing price override that applies to this account, for the given
 * actions, in one pass.
 *
 * The studio prices several action+tier combinations at once, and going through
 * {@link campaignActionMultiplier} for each would reload the account's facts
 * once per combination. Same config, same evaluator, same rules — just resolved
 * once, so the quote the client renders can't disagree with the one the server
 * reserves against.
 *
 * Fails OPEN (no overrides = full price) for the same reason as above.
 */
export async function standingPriceOverrides(
  uid: string,
  actions: readonly string[],
): Promise<Record<string, ActionPriceOverride>> {
  const untouched = (): ActionPriceOverride => ({
    tiers: { quick: 1, premium: 1 },
    note: null,
  });
  const out: Record<string, ActionPriceOverride> = {};
  for (const action of actions) out[action] = untouched();

  try {
    const config = await getCampaignsConfig();
    if (!config.enabled) return out;
    const live = config.campaigns.filter(
      (c: Campaign) => campaignIsLive(c) && c.rules.some((r) => r.enabled && r.trigger === "always"),
    );
    if (live.length === 0) return out;

    const user = await userFacts(uid);
    const eligible = live.filter((c) => audienceVerdict(c, user).eligible);
    if (eligible.length === 0) return out;

    for (const action of actions) {
      // Track the single most generous campaign per action so the label next to
      // the price names the promotion the customer is actually getting.
      let best: { campaignId: string; label: string; multiplier: number } | null = null;
      for (const campaign of eligible) {
        const rules = campaign.rules.filter((r) => r.enabled && r.trigger === "always");
        for (const tier of IMAGE_TIERS) {
          const multiplier = actionPriceMultiplier(rules, action, tier);
          out[action].tiers[tier] = Math.min(out[action].tiers[tier], multiplier);
          if (multiplier < 1 && (!best || multiplier < best.multiplier)) {
            best = {
              campaignId: campaign.id,
              label: campaign.presentation.headline.trim() || campaign.name,
              multiplier,
            };
          }
        }
      }
      out[action].note = best ? { campaignId: best.campaignId, label: best.label } : null;
    }
    return out;
  } catch {
    return out;
  }
}
