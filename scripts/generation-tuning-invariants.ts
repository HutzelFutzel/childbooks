import assert from "node:assert/strict";
import {
  createDefaultGenerationTuningConfig,
  generationIntentFor,
  generationTuningConfigSchema,
  normalizeGenerationTuningConfig,
  clampTuningToModel,
  tuningChoicesFor,
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
import { cappedReferenceCount } from "../books-frontend/src/core/billing/referencePlan";

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
  outputFormat: "webp" as const,
  outputCompression: 75,
};
const resolved = resolveImageGenerationOptions(openAi, generationIntentFor(requested));
assert.equal(resolved.applied.quality, "low");
// Reference fidelity is not a setting: no model takes it from us, and a stored
// value from before is dropped rather than carried.
const legacy = normalizeGenerationTuningConfig({
  actions: { portrait: { inputFidelity: "high" } },
});
assert.equal("inputFidelity" in legacy.actions.portrait, false);
assert.equal("inputFidelity" in generationIntentFor(requested), false);
assert.equal(resolved.applied.format, "webp");
assert.equal(resolved.applied.outputCompression, 75);

const providerDefault = generationIntentFor(defaults.actions.pageIllustration);
assert.equal(providerDefault.quality, undefined);

// A setting the model cannot take goes back to the provider default.
const gemini = capabilitiesFor({ provider: "google", id: "gemini-3.1-flash-image" });
const clamped = clampTuningToModel({ ...requested, quality: "xhigh" as const }, gemini);
assert.equal(clamped.tuning.quality, "provider-default");
assert.equal(clamped.tuning.outputFormat, "provider-default");
assert.equal(clamped.tuning.outputCompression, null);
assert.ok(clamped.reset.length >= 2);
assert.deepEqual(clampTuningToModel(defaults.actions.portrait, openAi).reset, []);
assert.deepEqual(clampTuningToModel(requested, null).reset, []);
assert.equal(tuningChoicesFor(openAi).qualities.includes("max"), true);

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

// ---- Reference groups --------------------------------------------------------
// A quote that knows its reference count prices from renders that sent about
// as many: its own group, else the closest, with a tie averaged.

const withRefs = (n: number) =>
  completeGenerationEstimateProfile(quoteLow, { outputSize: "1536x1024", referenceCount: n, billableImages: 1 });
const quoteRefs = (n: number) =>
  estimateProfileForAction({ action: "pageIllustration", tier: "premium", model, tuning: requested, kind: "fresh", referenceCount: n });
const fill = (stats: ReturnType<typeof createDefaultImageCostStats>, n: number, usd: number, count: number, tag: string) => {
  let out = stats;
  for (let i = 0; i < count; i++) {
    out = appendCostSample(out, "pageIllustration", "premium", usd, withRefs(n), { at: now - i * 1000, project: `${tag}-${i}` });
  }
  return out;
};
const minSamples = sparks.estimation.defaults.minSamples;
const priceAt = (stats: ReturnType<typeof createDefaultImageCostStats>, n: number) =>
  estimateUnitCost({ stats, sparks, action: "pageIllustration", tier: "premium", profile: quoteRefs(n), rateUsd: 0.5, now });

let grouped = fill(createDefaultImageCostStats(), 1, 0.04, minSamples, "one");
const ownGroup = priceAt(grouped, 1);
assert.equal(ownGroup.level, "exact");
assert.ok(Math.abs(ownGroup.usd - 0.04) < 1e-9);

const nearest = priceAt(grouped, 2);
assert.equal(nearest.level, "nearest", "a missing group borrows the closest");
assert.ok(Math.abs(nearest.usd - 0.04) < 1e-9);

grouped = fill(grouped, 3, 0.08, minSamples, "three");
const tie = priceAt(grouped, 2);
assert.equal(tie.level, "nearest");
assert.ok(Math.abs(tie.usd - 0.06) < 1e-9, "two groups the same distance away are averaged");

// 5+ is two steps from 2 and one from 3-4: the closer group wins alone.
const farther = priceAt(grouped, 6);
assert.equal(farther.level, "nearest");
assert.ok(Math.abs(farther.usd - 0.08) < 1e-9);

// Without a count, the quote pools every group.
const unknownRefs = estimateUnitCost({ stats: grouped, sparks, action: "pageIllustration", tier: "premium", profile: quoteLow, rateUsd: 0.5, now });
assert.equal(unknownRefs.level, "exact");
assert.ok(Math.abs(unknownRefs.usd - 0.06) < 1e-9);

// A few renders of the group itself blend with the nearest estimate.
if (minSamples > 1 && sparks.estimation.defaults.blend) {
  const few = fill(grouped, 2, 0.1, 1, "two");
  const blended = priceAt(few, 2);
  assert.equal(blended.level, "exact");
  assert.equal(blended.exactSamples, 1);
  assert.ok(Math.abs(blended.usd - (0.1 + minSamples * 0.06) / (1 + minSamples)) < 1e-9);
}

// Reference limits: required images survive `maxImages = 0`; the model's
// ceiling always holds; no editing means no edit references.
const limits = { maxReferenceImages: 4, maxImages: 2, referenceEditing: true };
assert.equal(cappedReferenceCount(3, limits), 2);
assert.equal(cappedReferenceCount(3, { ...limits, maxImages: 0 }, { required: true }), 1);
assert.equal(cappedReferenceCount(6, { ...limits, maxImages: 9 }), 4);
assert.equal(cappedReferenceCount(2, { ...limits, referenceEditing: false }, { needsEditing: true }), 0);
assert.equal(cappedReferenceCount(0, limits, { required: true }), 0);

// Backtest per group: a group priced from its own history stays on target.
let perGroup = createDefaultImageCostStats();
for (let i = 0; i < 12; i++) {
  perGroup = appendCostSample(perGroup, "pageIllustration", "premium", 0.2, withRefs(1), { at: now + i, project: `g1-${i}` });
  perGroup = appendCostSample(perGroup, "pageIllustration", "premium", 0.6, withRefs(4), { at: now + i, project: `g4-${i}` });
}
for (const result of backtestEstimation(perGroup, sparks)) {
  assert.ok(Math.abs(result.bias) <= BACKTEST_ON_TARGET, "each reference group is priced from its own renders");
}
const groupHealth = costGroupHealth(perGroup, sparks, now + 12);
assert.ok(groupHealth.length >= 2, "health lists each reference group");

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
