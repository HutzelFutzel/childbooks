"use client";

/**
 * Admin editor for how image prices are estimated from measured costs. The
 * estimate is the price readers pay, so every change is shown against the
 * renders we already paid for before it's saved: the current price per
 * action, how the draft would have charged past renders, and which cost
 * groups have too few samples to stand on their own.
 */
import { useMemo, useState } from "react";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { IMAGE_ACTIONS, type ImageActionId } from "../../../../core/ai/actions";
import type { SparksConfig } from "../../../../core/config/sparks";
import {
  ESTIMATE_LEVEL_INFO,
  ESTIMATION_STATISTICS,
  STATISTIC_INFO,
  estimationRuleFor,
  type EstimationRule,
  type EstimationStatistic,
} from "../../../../core/config/priceEstimation";
import { derivedUnitPrice } from "../../../../core/billing/priceEstimation";
import { BACKTEST_ON_TARGET, backtestEstimation, costGroupHealth } from "../../../../core/billing/priceBacktest";
import { CUSTOMER_IMAGE_TIER, resolveImageModel } from "../../../../core/config/modelConfig";
import { costForUsage, costKey, PUBLIC_IMAGE_ESTIMATE_USAGE } from "../../../../core/config/modelCosts";
import { estimateProfileForAction } from "../../../../core/config/generationEstimateProfile";
import { generationTuningFor } from "../../../../core/config/generationTuning";
import { Grid, NumberField, Section, fmtMoney } from "../products/parts";

type Scope = "defaults" | ImageActionId;

export function PriceEstimationSection({
  draft,
  onChange,
  baseCurrency,
}: {
  draft: SparksConfig;
  onChange: (patch: Partial<SparksConfig>) => void;
  baseCurrency: string;
}) {
  const [scope, setScope] = useState<Scope>("defaults");
  const stats = useAppConfigStore((s) => s.imageCostStats);
  const modelCosts = useAppConfigStore((s) => s.adminModelCosts);
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  const generationTuning = useAppConfigStore((s) => s.generationTuning);
  const est = draft.estimation;

  const rule: EstimationRule = scope === "defaults" ? est.defaults : estimationRuleFor(est, scope);
  const override = scope === "defaults" ? null : est.byAction[scope] ?? {};
  const setRule = (patch: Partial<EstimationRule>) => {
    if (scope === "defaults") {
      onChange({ estimation: { ...est, defaults: { ...est.defaults, ...patch } } });
    } else {
      onChange({ estimation: { ...est, byAction: { ...est.byAction, [scope]: { ...override, ...patch } } } });
    }
  };
  const resetOverride = () => {
    if (scope === "defaults") return;
    const byAction = { ...est.byAction };
    delete byAction[scope];
    onChange({ estimation: { ...est, byAction } });
  };
  const overridden = (key: keyof EstimationRule) => Boolean(override && key in override);

  const backtest = useMemo(() => backtestEstimation(stats, draft), [stats, draft]);
  const health = useMemo(() => costGroupHealth(stats, draft), [stats, draft]);

  /** Today's price for one fresh unit of each action, with where it came from. */
  const current = useMemo(
    () =>
      IMAGE_ACTIONS.map((a) => {
        const sel = resolveImageModel(modelConfig, a.id, CUSTOMER_IMAGE_TIER);
        if (!sel || draft.actions[a.id]?.mode !== "derived") return { action: a, price: null };
        const rateUsd = costForUsage(modelCosts.models[costKey(sel.provider, sel.id)], PUBLIC_IMAGE_ESTIMATE_USAGE);
        const profile = estimateProfileForAction({
          action: a.id,
          tier: CUSTOMER_IMAGE_TIER,
          model: sel,
          tuning: generationTuningFor(generationTuning, a.id),
          kind: "fresh",
        });
        const price = derivedUnitPrice({
          stats,
          sparks: { ...draft, enabled: true },
          action: a.id,
          tier: CUSTOMER_IMAGE_TIER,
          profile,
          rateUsd,
        });
        return { action: a, price };
      }),
    [draft, stats, modelConfig, modelCosts, generationTuning],
  );

  const info = STATISTIC_INFO[rule.statistic];
  const scopes: { value: Scope; label: string }[] = [
    { value: "defaults", label: "All image actions (default)" },
    ...IMAGE_ACTIONS.map((a) => ({ value: a.id as Scope, label: `${a.label}${est.byAction[a.id] ? " · custom" : ""}` })),
  ];

  return (
    <Section
      title="Price estimation"
      hint="Image prices come from what recent renders actually cost. The number the reader sees is exactly what they pay; failed renders are free."
    >
      <div className="grid gap-3 rounded-lg bg-ink-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
        {current.map(({ action, price }) => (
          <div key={action.id} className="space-y-0.5">
            <div className="text-xs text-ink-500">{action.label}</div>
            {price ? (
              <>
                <div className="text-lg font-semibold text-ink-900 tabular-nums">{price.sparks} ✦</div>
                <div className="text-[11px] text-ink-400" title={ESTIMATE_LEVEL_INFO[price.estimate.level]}>
                  {fmtMoney(price.estimate.usd, baseCurrency)} cost · {levelLabel(price.estimate.level)}
                  {price.estimate.samples > 0 ? ` · ${price.estimate.samples} renders` : ""}
                </div>
              </>
            ) : (
              <div className="text-sm text-ink-400">Not cost-derived</div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <Select value={scope} options={scopes} onChange={(e) => setScope(e.target.value as Scope)} />
        </div>
        {scope !== "defaults" && est.byAction[scope] && (
          <button type="button" onClick={resetOverride} className="pb-2 text-xs text-ink-500 underline underline-offset-2 hover:text-ink-800">
            Use the defaults for this action
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-ink-600">Statistic{overridden("statistic") ? " (custom)" : ""}</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ESTIMATION_STATISTICS.map((id: EstimationStatistic) => {
            const s = STATISTIC_INFO[id];
            const active = rule.statistic === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setRule({ statistic: id })}
                aria-pressed={active}
                className={`rounded-lg border p-2.5 text-left transition ${
                  active ? "border-ink-800 bg-white shadow-soft" : "border-ink-200 bg-white/60 hover:border-ink-400"
                }`}
              >
                <div className="text-sm font-medium text-ink-900">{s.label}</div>
                <div className="mt-1 text-[11px] leading-snug text-emerald-700">+ {s.pro}</div>
                <div className="text-[11px] leading-snug text-amber-700">− {s.con}</div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-ink-400">
          {info.label}: {info.pro} {info.con}
        </p>
      </div>

      <Grid cols={4}>
        {rule.statistic === "percentile" && (
          <NumberField label="Percentile" value={rule.percentile} step="5" suffix="p" hint="50 = median. 75 charges above most renders." onChange={(n) => setRule({ percentile: n })} />
        )}
        {rule.statistic === "trimmedMean" && (
          <NumberField label="Trim each end" value={rule.trimPercent} step="5" suffix="%" onChange={(n) => setRule({ trimPercent: n })} />
        )}
        {rule.statistic === "ema" && (
          <NumberField label="Newest weight" value={rule.emaAlpha} step="0.05" hint="Higher reacts faster, swings more." onChange={(n) => setRule({ emaAlpha: n })} />
        )}
        <NumberField label="Last renders used" value={rule.window} step="5" hint="How many of the newest renders count." onChange={(n) => setRule({ window: n })} />
        <NumberField label="Minimum renders" value={rule.minSamples} step="1" hint="Fewer than this borrows from a broader group." onChange={(n) => setRule({ minSamples: n })} />
        <NumberField label="Max age" value={rule.maxAgeDays} step="5" suffix="days" hint="0 = no limit." onChange={(n) => setRule({ maxAgeDays: n })} />
        <NumberField label="Per book" value={rule.perProjectCap} step="1" hint="Most renders one book may contribute. 0 = no limit." onChange={(n) => setRule({ perProjectCap: n })} />
        <NumberField label="Minimum price" value={rule.minSparks} step="1" suffix="✦" onChange={(n) => setRule({ minSparks: n })} />
        <NumberField label="Maximum price" value={rule.maxSparks} step="1" suffix="✦" hint="0 = no ceiling." onChange={(n) => setRule({ maxSparks: n })} />
      </Grid>
      <Toggle
        checked={rule.blend}
        onChange={(v) => setRule({ blend: v })}
        label="Blend a sparse group with the broader estimate (no jump when the minimum is reached)"
      />

      <div className="space-y-1.5">
        <div className="text-xs font-medium text-ink-600">Would this have charged right?</div>
        <p className="text-[11px] text-ink-400">
          Each past render priced from the renders before it with these settings, against its cost × markup.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-400">
              <th className="pb-1 font-medium">Action</th>
              <th className="pb-1 font-medium">Verdict</th>
              <th className="pb-1 font-medium">Bias</th>
              <th className="pb-1 font-medium">Per render</th>
              <th className="pb-1 font-medium">Money</th>
              <th className="pb-1 font-medium">Renders</th>
            </tr>
          </thead>
          <tbody>
            {IMAGE_ACTIONS.map((a) => {
              const b = backtest.find((r) => r.action === a.id);
              if (!b || b.scored === 0) {
                return (
                  <tr key={a.id} className="border-t border-ink-100">
                    <td className="py-1.5 pr-3 text-ink-800">{a.label}</td>
                    <td className="py-1.5 text-xs text-ink-400" colSpan={5}>
                      Not enough renders yet{b?.unscored ? ` (${b.unscored} too early to score)` : ""}.
                    </td>
                  </tr>
                );
              }
              const verdict =
                Math.abs(b.bias) <= BACKTEST_ON_TARGET
                  ? { text: "On target", tone: "bg-emerald-50 text-emerald-700" }
                  : b.bias > 0
                    ? { text: "Overcharges", tone: "bg-amber-50 text-amber-700" }
                    : { text: "Undercharges", tone: "bg-rose-50 text-rose-700" };
              return (
                <tr key={a.id} className="border-t border-ink-100">
                  <td className="py-1.5 pr-3 text-ink-800">{a.label}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${verdict.tone}`}>{verdict.text}</span>
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{signedPct(b.bias)}</td>
                  <td className="py-1.5 pr-3 text-xs text-ink-500 tabular-nums" title="Average miss per render, and how often it was charged above cost × markup.">
                    ±{Math.round(b.spread * 100)}% · {Math.round(b.overShare * 100)}% above
                  </td>
                  <td className="py-1.5 pr-3 text-xs tabular-nums text-ink-600">
                    {b.moneyUsd >= 0 ? "+" : "−"}
                    {fmtMoney(Math.abs(b.moneyUsd), baseCurrency)}
                  </td>
                  <td className="py-1.5 text-xs text-ink-500 tabular-nums">{b.scored}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="rounded-lg ring-1 ring-inset ring-ink-100">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Cost groups ({health.length})
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-400">
                <th className="py-1 font-medium">Action</th>
                <th className="py-1 font-medium">Setup</th>
                <th className="py-1 font-medium">Usable / stored</th>
                <th className="py-1 font-medium">Latest</th>
              </tr>
            </thead>
            <tbody>
              {health.map((g) => (
                <tr key={`${g.action}|${g.tier}|${g.label}`} className="border-t border-ink-100">
                  <td className="py-1 pr-3 text-ink-700">{IMAGE_ACTIONS.find((a) => a.id === g.action)?.label ?? g.action}</td>
                  <td className="py-1 pr-3 font-mono text-[11px] text-ink-600">{g.label}</td>
                  <td className="py-1 pr-3 tabular-nums">
                    <span className={g.enough ? "text-emerald-700" : "text-amber-700"}>{g.usable}</span>
                    <span className="text-ink-400"> / {g.stored}</span>
                    {!g.enough && <span className="text-ink-400"> · borrows</span>}
                  </td>
                  <td className="py-1 text-ink-500">{g.latestAt ? new Date(g.latestAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="rounded-lg ring-1 ring-inset ring-ink-100">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Quality factors
        </summary>
        <div className="space-y-2 px-3 pb-3">
          <p className="text-[11px] text-ink-400">
            Relative cost of each quality. Only used to price a quality that has no renders yet (for
            example right after switching pages from low to high); real renders replace it.
          </p>
          <Grid cols={4}>
            {Object.entries(est.qualityFactors).map(([quality, factor]) => (
              <NumberField
                key={quality}
                label={quality}
                value={factor}
                step="0.5"
                suffix="×"
                onChange={(n) =>
                  onChange({ estimation: { ...est, qualityFactors: { ...est.qualityFactors, [quality]: n > 0 ? n : factor } } })
                }
              />
            ))}
          </Grid>
        </div>
      </details>
    </Section>
  );
}

function levelLabel(level: keyof typeof ESTIMATE_LEVEL_INFO): string {
  switch (level) {
    case "exact":
      return "measured";
    case "model":
      return "same model";
    case "scaled":
      return "scaled from other quality";
    case "rate":
      return "cost table";
    default:
      return "fallback price";
  }
}

function signedPct(v: number): string {
  const pct = Math.round(v * 1000) / 10;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}
