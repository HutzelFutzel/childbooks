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
import { estimationRuleFor, type EstimationRule } from "../config/priceEstimation";
import type { SparksConfig } from "../config/sparks";
import { applyStatistic, OUTCOME_FIELDS, REFERENCE_GROUPS, selectSamples, unitPriceSparks } from "./priceEstimation";

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

/** A sample with the reference group it was drawn in. */
interface GroupedSample extends CostSample {
  group: string;
}

interface Setup {
  action: ImageActionId;
  tier: string;
  label: string;
  samples: GroupedSample[];
}

/**
 * Samples grouped the way a quote pools them: outcome fields ignored, each
 * sample keeping its reference group so a replay can price from it first.
 * With `byGroup`, every reference group is its own setup.
 */
function setups(stats: ImageCostStats, byGroup = false): Setup[] {
  const byKey = new Map<string, Setup>();
  const imageIds = new Set<string>(IMAGE_ACTIONS.map((a) => a.id));
  for (const [key, entry] of Object.entries(stats.stats)) {
    const parsed = parseCostStatsKey(key);
    if (!parsed || !imageIds.has(parsed.action)) continue;
    const group = parsed.fields.referenceCount ?? "unknown";
    const setupFields = COST_KEY_FIELDS.filter((f) => !OUTCOME_FIELDS.includes(f)).map((f) => parsed.fields[f]);
    const id = `${parsed.action}|${parsed.tier}|${setupFields.join("~")}${byGroup ? `|${group}` : ""}`;
    const setup =
      byKey.get(id) ??
      ({
        action: parsed.action as ImageActionId,
        tier: parsed.tier,
        label: [
          parsed.fields.modelKey,
          parsed.fields.quality,
          parsed.fields.renderKind,
          ...(byGroup ? [referenceGroupLabel(group)] : []),
        ].join(" · "),
        samples: [],
      } satisfies Setup);
    setup.samples.push(...entry.samples.map((sample) => ({ ...sample, group })));
    byKey.set(id, setup);
  }
  for (const s of byKey.values()) s.samples.sort((a, b) => a.at - b.at);
  return [...byKey.values()];
}

function referenceGroupLabel(group: string): string {
  if (group === "unknown") return "refs unknown";
  return `${group} ref${group === "1" ? "" : "s"}`;
}

/**
 * Price one render from the renders before it, the way a live quote would:
 * its own reference group, else the closest measured group (two equally close
 * averaged), else every group pooled; a few own samples blend with that prior.
 * Null when not even the pool has enough history.
 */
function priceFromHistory(
  before: GroupedSample[],
  group: string,
  rule: EstimationRule,
  at: number,
  valueOf: (sample: GroupedSample) => number,
): number | null {
  const within = (g: string) => selectSamples(g === "unknown" ? before : before.filter((s) => s.group === g), rule, at);
  const price = (samples: GroupedSample[]) => applyStatistic(samples.map(valueOf), rule);
  const own = within(group);
  if (own.length >= rule.minSamples) return price(own);

  let prior: number | null = null;
  const index = (REFERENCE_GROUPS as readonly string[]).indexOf(group);
  if (index >= 0) {
    for (let d = 1; d < REFERENCE_GROUPS.length && prior === null; d++) {
      const found = [REFERENCE_GROUPS[index - d], REFERENCE_GROUPS[index + d]]
        .filter((g): g is (typeof REFERENCE_GROUPS)[number] => g !== undefined)
        .map(within)
        .filter((samples) => samples.length >= rule.minSamples);
      if (found.length > 0) prior = found.reduce((sum, samples) => sum + price(samples), 0) / found.length;
    }
  }
  if (prior === null) {
    const pooled = within("unknown");
    if (pooled.length >= rule.minSamples) prior = price(pooled);
  }
  if (prior === null) return null;
  if (own.length > 0 && rule.blend) {
    const n = own.length;
    const k = rule.minSamples;
    return (n * price(own) + k * prior) / (n + k);
  }
  return prior;
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
      // Price each past render at today's model rate, as a live quote would.
      const usd = priceFromHistory(
        setup.samples.slice(0, i),
        sample.group,
        rule,
        sample.at || Date.now(),
        (h) => (sample.rate && h.rate ? h.usd * (sample.rate / h.rate) : h.usd),
      );
      if (usd === null) {
        a.unscored += 1;
        return;
      }
      const charged = unitPriceSparks(enabled, setup.action, usd);
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

/**
 * Every cost group, one row per reference group, and whether it has enough
 * usable samples under the draft settings (otherwise it prices from the
 * closest group).
 */
export function costGroupHealth(stats: ImageCostStats, sparks: SparksConfig, now = Date.now()): CostGroupHealth[] {
  return setups(stats, true)
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
