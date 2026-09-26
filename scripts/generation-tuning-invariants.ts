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
  costStatsKey,
  createDefaultImageCostStats,
  normalizeImageCostStats,
  recentCostSamples,
} from "../books-frontend/src/core/config/imageCostStats";
import { withRetry } from "../books-frontend/src/core/pipeline/retry";
import { createDefaultSparksConfig, type SparksConfig } from "../books-frontend/src/core/config/sparks";
import { estimateUnitCost, unitPriceSparks } from "../books-frontend/src/core/billing/priceEstimation";
import { BACKTEST_ON_TARGET, backtestEstimation, costGroupHealth } from "../books-frontend/src/core/billing/priceBacktest";

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
  recentCostSamples(lowOnlyCosts, "pageIllustration", "premium", lowProfile).map((s) => s.usd),
  [0.04],
);
assert.deepEqual(
  recentCostSamples(lowOnlyCosts, "pageIllustration", "premium", highProfile),
  [],
);

// ---- Price estimation --------------------------------------------------------

const sparks: SparksConfig = { ...createDefaultSparksConfig(), enabled: true };
const quoteLow = estimateProfileForAction({
  action: "pageIllustration",
  tier: "premium",
  model,
  tuning: requested,
  kind: "fresh",
});
const quoteHigh = estimateProfileForAction({
  action: "pageIllustration",
  tier: "premium",
  model,
  tuning: { ...requested, quality: "high" },
  kind: "fresh",
});
const now = Date.UTC(2026, 8, 1);
let window = createDefaultImageCostStats();
[0.02, 0.04, 0.06, 0.04, 0.04].forEach((usd, i) => {
  window = appendCostSample(window, "pageIllustration", "premium", usd, lowProfile, {
    at: now - (5 - i) * 60_000,
    project: `book-${i}`,
  });
});

// A quote can't know the render's size or reference count; it must still find
// the samples that were recorded with them (regression: every quote fell
// through to the rate table).
const pooled = estimateUnitCost({
  stats: window,
  sparks,
  action: "pageIllustration",
  tier: "premium",
  profile: quoteLow,
  rateUsd: 0.5,
  now,
});
assert.equal(pooled.level, "exact");
assert.equal(pooled.samples, 5);
assert.ok(Math.abs(pooled.usd - 0.04) < 1e-9, "mean of the window");

const median = estimateUnitCost({
  stats: window,
  sparks: {
    ...sparks,
    estimation: { ...sparks.estimation, defaults: { ...sparks.estimation.defaults, statistic: "percentile", percentile: 100 } },
  },
  action: "pageIllustration",
  tier: "premium",
  profile: quoteLow,
  rateUsd: null,
  now,
});
assert.ok(Math.abs(median.usd - 0.06) < 1e-9, "p100 is the max");

// One book may only fill `perProjectCap` slots of a window.
let oneBook = createDefaultImageCostStats();
for (let i = 0; i < 8; i++) {
  oneBook = appendCostSample(oneBook, "pageIllustration", "premium", 0.1, lowProfile, { at: now - i, project: "same" });
}
const capped = estimateUnitCost({ stats: oneBook, sparks, action: "pageIllustration", tier: "premium", profile: quoteLow, rateUsd: null, now });
assert.equal(capped.exactSamples, sparks.estimation.defaults.perProjectCap);

// Samples past the age limit are ignored.
const stale = estimateUnitCost({
  stats: window,
  sparks,
  action: "pageIllustration",
  tier: "premium",
  profile: quoteLow,
  rateUsd: 0.5,
  now: now + 90 * 86_400_000,
});
assert.equal(stale.level, "rate");

// A quality with no samples borrows from a measured one, scaled.
const scaled = estimateUnitCost({ stats: window, sparks, action: "pageIllustration", tier: "premium", profile: quoteHigh, rateUsd: 0.5, now });
assert.equal(scaled.level, "scaled");
const factors = sparks.estimation.qualityFactors;
const lowQuality = String(lowProfile.quality);
assert.ok(Math.abs(scaled.usd - 0.04 * (factors.high / (factors[lowQuality] ?? factors["provider-default"]))) < 1e-9);

// A rate-table change reprices old samples.
let rated = createDefaultImageCostStats();
for (let i = 0; i < 5; i++) {
  rated = appendCostSample(rated, "pageIllustration", "premium", 0.04, lowProfile, { at: now - i, project: `b${i}`, rate: 0.04 });
}
const repriced = estimateUnitCost({ stats: rated, sparks, action: "pageIllustration", tier: "premium", profile: quoteLow, rateUsd: 0.08, now });
assert.ok(Math.abs(repriced.usd - 0.08) < 1e-9);

// Old-format windows (bare numbers) still load.
const migrated = estimateUnitCost({
  stats: normalizeImageCostStats({
    version: 2,
    updatedAt: now,
    stats: { [costStatsKey("pageIllustration", "premium", lowProfile)]: { samples: [0.04, 0.04, 0.04, 0.04, 0.04] } },
  }),
  sparks,
  action: "pageIllustration",
  tier: "premium",
  profile: quoteLow,
  rateUsd: null,
  now,
});
assert.equal(migrated.level, "exact");

// The unit price honors the floor and the ceiling.
assert.equal(unitPriceSparks(sparks, "pageIllustration", 0.0001), 1);
assert.equal(
  unitPriceSparks(
    { ...sparks, estimation: { ...sparks.estimation, byAction: { pageIllustration: { maxSparks: 3 } } } },
    "pageIllustration",
    1,
  ),
  3,
);
assert.equal(unitPriceSparks({ ...sparks, enabled: false }, "pageIllustration", 1), 0);

// Backtest: rising costs priced from older renders read as undercharging;
// the first `minSamples` renders have no history and aren't scored.
let rising = createDefaultImageCostStats();
for (let i = 0; i < 12; i++) {
  rising = appendCostSample(rising, "pageIllustration", "premium", 0.5 + i * 0.1, lowProfile, { at: now + i, project: `r${i}` });
}
const [risingResult] = backtestEstimation(rising, sparks);
assert.equal(risingResult.action, "pageIllustration");
assert.equal(risingResult.unscored, sparks.estimation.defaults.minSamples);
assert.equal(risingResult.scored, 12 - sparks.estimation.defaults.minSamples);
assert.ok(risingResult.bias < -BACKTEST_ON_TARGET, "rising costs undercharge");
assert.ok(risingResult.moneyUsd < 0);

let steady = createDefaultImageCostStats();
for (let i = 0; i < 12; i++) {
  steady = appendCostSample(steady, "pageIllustration", "premium", 0.5, lowProfile, { at: now + i, project: `s${i}` });
}
const [steadyResult] = backtestEstimation(steady, sparks);
assert.ok(Math.abs(steadyResult.bias) <= BACKTEST_ON_TARGET, "steady costs are on target");
const [steadyHealth] = costGroupHealth(steady, sparks, now + 12);
assert.equal(steadyHealth.stored, 12);
assert.ok(steadyHealth.enough);

console.log("Generation tuning invariants passed.");
