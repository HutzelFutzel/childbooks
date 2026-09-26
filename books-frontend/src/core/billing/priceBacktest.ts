/**
 * How a pricing configuration would have done on the renders we already paid
 * for: every sample in the cost window is priced from the samples before it,
 * with the settings being edited, and compared with what it actually cost.
 *
 * Because the estimate is the price, this is the admin's only view of whether
 * a statistic charges readers too much or loses money, before saving it.
 */
import { IMAGE_ACTIONS, type ImageActionId } from "../ai/actions";
import {
  COST_KEY_FIELDS,
  parseCostStatsKey,
  type CostSample,
  type ImageCostStats,
} from "../config/imageCostStats";
import { estimationRuleFor } from "../config/priceEstimation";
import type { SparksConfig } from "../config/sparks";
import { applyStatistic, OUTCOME_FIELDS, selectSamples, unitPriceSparks } from "./priceEstimation";

/** Relative bias under which a configuration counts as on target. */
export const BACKTEST_ON_TARGET = 0.05;

export interface ActionBacktest {
  action: ImageActionId;
  /** Renders that had enough history before them to be priced. */
  scored: number;
  /** Renders without enough history (priced by a fallback in real life). */
  unscored: number;
  /** Sparks the configuration would have charged for the scored renders. */
  chargedSparks: number;
  /** Sparks the scored renders were worth at cost × markup (the target). */
  targetSparks: number;
  /** (charged − target) / target. Positive overcharges readers, negative loses margin. */
  bias: number;
  /** Mean absolute error per render, relative to its target. */
  spread: number;
  /** Share of renders charged above their target. */
  overShare: number;
  /** Charged − target, in the base currency, over the scored renders. */
  moneyUsd: number;
}

export interface CostGroupHealth {
  action: ImageActionId;
  tier: string;
  /** Model, quality and render kind: what the estimator groups by. */
  label: string;
  /** Samples stored for this setup. */
  stored: number;
  /** Samples left after the age limit, per-book cap and window. */
  usable: number;
  /** Whether `usable` reaches `minSamples` (otherwise it borrows). */
  enough: boolean;
  /** Newest sample time. */
  latestAt: number;
}

interface Setup {
  action: ImageActionId;
  tier: string;
  label: string;
  samples: CostSample[];
}

/** Samples grouped the way a quote pools them: outcome fields ignored. */
function setups(stats: ImageCostStats): Setup[] {
  const byKey = new Map<string, Setup>();
  const imageIds = new Set<string>(IMAGE_ACTIONS.map((a) => a.id));
  for (const [key, entry] of Object.entries(stats.stats)) {
    const parsed = parseCostStatsKey(key);
    if (!parsed || !imageIds.has(parsed.action)) continue;
    const setupFields = COST_KEY_FIELDS.filter((f) => !OUTCOME_FIELDS.includes(f)).map((f) => parsed.fields[f]);
    const id = `${parsed.action}|${parsed.tier}|${setupFields.join("~")}`;
    const setup =
      byKey.get(id) ??
      ({
        action: parsed.action as ImageActionId,
        tier: parsed.tier,
        label: [parsed.fields.modelKey, parsed.fields.quality, parsed.fields.renderKind].join(" · "),
        samples: [],
      } satisfies Setup);
    setup.samples.push(...entry.samples);
    byKey.set(id, setup);
  }
  for (const s of byKey.values()) s.samples.sort((a, b) => a.at - b.at);
  return [...byKey.values()];
}

/** Replay the cost window under `sparks.estimation` and report bias per action. */
export function backtestEstimation(stats: ImageCostStats, sparks: SparksConfig): ActionBacktest[] {
  const perUnitTarget = sparks.sparkValueUsd > 0 ? sparks.markupMultiplier / sparks.sparkValueUsd : 0;
  const acc = new Map<ImageActionId, { scored: number; unscored: number; charged: number; target: number; absErr: number; over: number }>();
  const enabled = { ...sparks, enabled: true };
  for (const setup of setups(stats)) {
    const rule = estimationRuleFor(sparks.estimation, setup.action);
    const a = acc.get(setup.action) ?? { scored: 0, unscored: 0, charged: 0, target: 0, absErr: 0, over: 0 };
    setup.samples.forEach((sample, i) => {
      const history = selectSamples(setup.samples.slice(0, i), rule, sample.at || Date.now());
      if (history.length < rule.minSamples) {
        a.unscored += 1;
        return;
      }
      // Price each past render at today's model rate, as a live quote would.
      const values = history.map((h) => (sample.rate && h.rate ? h.usd * (sample.rate / h.rate) : h.usd));
      const charged = unitPriceSparks(enabled, setup.action, applyStatistic(values, rule));
      const target = sample.usd * perUnitTarget;
      a.scored += 1;
      a.charged += charged;
      a.target += target;
      if (target > 0) a.absErr += Math.abs(charged - target) / target;
      if (charged > target) a.over += 1;
    });
    acc.set(setup.action, a);
  }
  return [...acc.entries()].map(([action, a]) => ({
    action,
    scored: a.scored,
    unscored: a.unscored,
    chargedSparks: a.charged,
    targetSparks: a.target,
    bias: a.target > 0 ? (a.charged - a.target) / a.target : 0,
    spread: a.scored > 0 ? a.absErr / a.scored : 0,
    overShare: a.scored > 0 ? a.over / a.scored : 0,
    moneyUsd: (a.charged - a.target) * sparks.sparkValueUsd,
  }));
}

/** Every cost group and whether it has enough usable samples under the draft settings. */
export function costGroupHealth(stats: ImageCostStats, sparks: SparksConfig, now = Date.now()): CostGroupHealth[] {
  return setups(stats)
    .map((setup) => {
      const rule = estimationRuleFor(sparks.estimation, setup.action);
      const usable = selectSamples(setup.samples, rule, now).length;
      return {
        action: setup.action,
        tier: setup.tier,
        label: setup.label,
        stored: setup.samples.length,
        usable,
        enough: usable >= rule.minSamples,
        latestAt: setup.samples[setup.samples.length - 1]?.at ?? 0,
      };
    })
    .sort((a, b) => a.action.localeCompare(b.action) || b.latestAt - a.latestAt);
}
