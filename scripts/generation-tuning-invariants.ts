import assert from "node:assert/strict";
import {
  createDefaultGenerationTuningConfig,
  generationIntentFor,
  generationTuningConfigSchema,
  normalizeGenerationTuningConfig,
} from "../books-frontend/src/core/config/generationTuning";
import {
  capabilitiesFor,
} from "../books-frontend/src/core/config/modelCapabilities";
import { resolveImageGenerationOptions } from "../books-frontend/src/core/config/imageGeneration";
import { latencyKey } from "../books-frontend/src/core/config/latencyStats";
import {
  completeGenerationEstimateProfile,
  estimateProfileForAction,
} from "../books-frontend/src/core/config/generationEstimateProfile";
import {
  appendCostSample,
  createDefaultImageCostStats,
  recentCostSamples,
} from "../books-frontend/src/core/config/imageCostStats";
import { withRetry } from "../books-frontend/src/core/pipeline/retry";

const defaults = createDefaultGenerationTuningConfig();
assert.equal(generationTuningConfigSchema.safeParse(defaults).success, true);
assert.equal(defaults.actions.pageIllustration.qualityControl.maxImageCalls, 2);
assert.equal(defaults.actions.pageIllustration.qualityControl.embeddedRepairLimit, 1);
assert.equal(defaults.actions.anchorImage.qualityControl.gridCheck, true);

const partial = normalizeGenerationTuningConfig({
  actions: {
    pageIllustration: {
      quality: "low",
      references: { maxDimension: 768 },
    },
  },
});
assert.equal(partial.actions.pageIllustration.quality, "low");
assert.equal(partial.actions.pageIllustration.references.maxDimension, 768);
assert.equal(
  partial.actions.pageIllustration.references.encodingQuality,
  defaults.actions.pageIllustration.references.encodingQuality,
);
assert.equal(partial.actions.anchorImage.quality, defaults.actions.anchorImage.quality);

const invalid = normalizeGenerationTuningConfig({
  ...defaults,
  execution: { surgicalConcurrency: 99 },
});
assert.deepEqual(invalid, defaults);

const openAi = capabilitiesFor({
  provider: "openai",
  id: "gpt-image-2.5-flare",
});
const requested = {
  ...defaults.actions.pageIllustration,
  quality: "low" as const,
  inputFidelity: "high" as const,
  outputFormat: "webp" as const,
  outputCompression: 75,
};
const resolved = resolveImageGenerationOptions(openAi, generationIntentFor(requested));
assert.equal(resolved.applied.quality, "low");
assert.equal(resolved.applied.inputFidelity, "high");
assert.equal(resolved.applied.format, "webp");
assert.equal(resolved.applied.outputCompression, 75);

const providerDefault = generationIntentFor(defaults.actions.pageIllustration);
assert.equal(providerDefault.quality, undefined);
assert.equal(providerDefault.inputFidelity, undefined);

const invalidCompression = structuredClone(defaults);
invalidCompression.actions.pageIllustration.outputFormat = "png";
invalidCompression.actions.pageIllustration.outputCompression = 75;
assert.equal(generationTuningConfigSchema.safeParse(invalidCompression).success, false);
const skippedCompression = resolveImageGenerationOptions(openAi, {
  outputCompression: 75,
});
assert.equal(skippedCompression.applied.outputCompression, undefined);
assert.ok(skippedCompression.skipped.includes("output-compression"));

const invalidCleanupDependency = structuredClone(defaults);
invalidCleanupDependency.actions.pageIllustration.qualityControl.bindingPass = false;
invalidCleanupDependency.actions.pageIllustration.qualityControl.duplicateRepairLimit = 1;
assert.equal(
  generationTuningConfigSchema.safeParse(invalidCleanupDependency).success,
  false,
);

let providerAttempts = 0;
let budgetRemaining = 2;
await assert.rejects(() =>
  withRetry(
    async () => {
      providerAttempts += 1;
      throw new Error("transient");
    },
    {
      retries: 5,
      minTimeoutMs: 0,
      maxTimeoutMs: 0,
      beforeAttempt: () => {
        if (budgetRemaining <= 0) return false;
        budgetRemaining -= 1;
        return true;
      },
    },
  ),
);
assert.equal(providerAttempts, 2);

const model = { provider: "openai" as const, id: "gpt-image-2.5-flare" };
const lowProfile = completeGenerationEstimateProfile(
  estimateProfileForAction({
    action: "pageIllustration",
    tier: "premium",
    model,
    tuning: requested,
    kind: "fresh",
  }),
  { outputSize: "1536x1024", referenceCount: 2, billableImages: 1 },
);
const highProfile = completeGenerationEstimateProfile(
  estimateProfileForAction({
    action: "pageIllustration",
    tier: "premium",
    model,
    tuning: { ...requested, quality: "high" },
    kind: "fresh",
  }),
  { outputSize: "1536x1024", referenceCount: 2, billableImages: 1 },
);
assert.notEqual(
  latencyKey("pageIllustration", "premium", lowProfile, 2),
  latencyKey("pageIllustration", "premium", highProfile, 2),
);
assert.match(
  latencyKey("pageIllustration", "premium", lowProfile, 2),
  /^v3:/,
);
const lowOnlyCosts = appendCostSample(
  createDefaultImageCostStats(),
  "pageIllustration",
  "premium",
  0.04,
  lowProfile,
);
assert.deepEqual(
  recentCostSamples(lowOnlyCosts, "pageIllustration", "premium", lowProfile),
  [0.04],
);
assert.deepEqual(
  recentCostSamples(lowOnlyCosts, "pageIllustration", "premium", highProfile),
  [],
);

console.log("Generation tuning invariants passed.");
