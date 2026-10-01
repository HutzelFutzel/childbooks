/**
 * The browser's view of how many reference images an action may send, from the
 * same live config the server caps with (`sparks.referenceLimitsForAction`),
 * so a planned count prices in the group the server will charge.
 */
import type { ImageActionId } from "../core/ai/actions";
import { capabilitiesFor } from "../core/config/modelCapabilities";
import { CUSTOMER_IMAGE_TIER, type ImageTier } from "../core/config/modelConfig";
import { generationTuningFor } from "../core/config/generationTuning";
import { referenceLimitsFor, type ReferenceLimits } from "../core/billing/referencePlan";
import { resolveImageModelClient } from "../platform/aiResolve";
import { useAppConfigStore } from "./appConfigStore";

export function clientReferenceLimits(action: ImageActionId, tier: ImageTier = CUSTOMER_IMAGE_TIER): ReferenceLimits {
  const app = useAppConfigStore.getState();
  const overrides = { ...(app.layouts.capabilities ?? {}), ...(app.modelConfig.capabilities ?? {}) };
  return referenceLimitsFor(
    capabilitiesFor(resolveImageModelClient(action, tier), overrides),
    generationTuningFor(app.generationTuning, action),
  );
}
