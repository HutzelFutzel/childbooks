"use client";

/**
 * The two answers an admin needs before shipping a campaign, side by side.
 *
 * **Impact** is arithmetic: what does one account cost me at worst, what's the
 * total exposure, how many accounts fit in a day's budget. It's instant, pure and
 * offline, so it updates as the rules are edited.
 *
 * **Projection** is measurement: run the draft against a sample of real accounts
 * and see who would qualify, what it would pay, and which accounts cost the most.
 * It costs a round trip and writes nothing, so it's on a button rather than
 * automatic.
 *
 * They answer different questions and disagreeing is informative. Impact says
 * what the config permits; projection says what your actual customers would take.
 * A campaign that looks affordable per account and terrifying in projection has a
 * targeting problem, not a pricing one.
 */
import { useState } from "react";
import { AlertTriangle, Play, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/Button";
import { Field } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  TRIGGERS,
  TRIGGER_META,
  type Campaign,
  type CampaignTrigger,
  type SimulationResult,
} from "../../../../core/config/campaigns";
import { DISCOUNT_ITEM_LABELS, type DiscountItemType } from "../../../../core/config/discountImpact";
import type { CampaignImpact } from "../../../../core/config/campaignImpact";
import { Grid, NumberField, Section, fmtMoney } from "../products/parts";
import { StatCard } from "./parts";

export function CampaignImpactPanel({
  impact,
  currency,
}: {
  impact: CampaignImpact;
  currency: string;
}) {
  return (
    <Section
      title="Business impact"
      hint="Worst case if one account takes everything this campaign offers, using the same economics engines as plans, referrals and the discount planner."
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Per account (worst case)" value={fmtMoney(impact.perAccountCost, currency)} />
        <StatCard
          label="Total exposure"
          value={impact.totalExposure === null ? "Unbounded" : fmtMoney(impact.totalExposure, currency)}
          note={impact.totalExposure === null ? "No redemption cap, or a payout with no ceiling." : undefined}
        />
        <StatCard
          label="Accounts per day"
          value={impact.accountsPerDailyBudget > 0 ? String(impact.accountsPerDailyBudget) : "—"}
          note={impact.accountsPerDailyBudget > 0 ? "before the daily budget holds payouts" : "no daily budget set"}
        />
        <StatCard
          label="Budget lasts"
          value={impact.daysOfLifetimeBudget === null ? "—" : `${impact.daysOfLifetimeBudget} days`}
          note={impact.daysOfLifetimeBudget === null ? "no lifetime budget set" : "at the full daily budget"}
        />
      </div>

      {impact.payback && (
        <p className="text-[11px] text-ink-500">
          Payback: an account has to buy ~{impact.payback.salesPerAccount}× of your best sale (
          {impact.payback.itemLabel}, {fmtMoney(impact.payback.netProfit, currency)} net) before this campaign pays
          for itself.
        </p>
      )}

      {impact.rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-2.5 py-1.5 font-semibold">When</th>
                <th className="px-2.5 py-1.5 font-semibold">They get</th>
                <th className="px-2.5 py-1.5 font-semibold">Once</th>
                <th className="px-2.5 py-1.5 font-semibold">Per account</th>
                <th className="px-2.5 py-1.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {impact.rows.map((row) => (
                <tr key={row.ruleId} className="border-t border-ink-100">
                  <td className="px-2.5 py-1.5 text-ink-700">{row.triggerLabel}</td>
                  <td className="px-2.5 py-1.5 text-ink-700">{row.description}</td>
                  <td className="px-2.5 py-1.5 font-medium text-ink-800">{fmtMoney(row.cost, currency)}</td>
                  <td className="px-2.5 py-1.5 font-medium text-ink-800">
                    {row.unbounded ? "Unbounded" : fmtMoney(row.lifetimeCost, currency)}
                  </td>
                  <td className="px-2.5 py-1.5 text-ink-400">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {impact.warnings.map((w, i) => (
        <div
          key={`${w.severity}-${w.ruleId ?? "campaign"}-${i}`}
          className={
            w.severity === "block"
              ? "flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] leading-relaxed text-rose-800"
              : "flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800"
          }
        >
          {w.severity === "block" ? (
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span>{w.message}</span>
        </div>
      ))}
    </Section>
  );
}

// ---- Projection -------------------------------------------------------------

const ITEM_OPTIONS = (["print", "ebook", "pack", "plan"] as DiscountItemType[]).map((value) => ({
  value,
  label: DISCOUNT_ITEM_LABELS[value],
}));

export function CampaignSimulatorPanel({
  campaign,
  currency,
}: {
  campaign: Campaign;
  currency: string;
}) {
  const simulate = useAppConfigStore((s) => s.simulateCampaign);
  const [trigger, setTrigger] = useState<CampaignTrigger>(() => firstDeliveredTrigger(campaign));
  const [itemType, setItemType] = useState<DiscountItemType>("print");
  const [amount, setAmount] = useState(40);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      setResult(await simulate(campaign, { trigger, itemType, amount }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run the projection.");
    } finally {
      setRunning(false);
    }
  };

  const purchaseLike =
    trigger === "purchase" || trigger === "subscription_started" || trigger === "subscription_renewed";

  return (
    <Section
      title="Projection"
      hint="Runs this campaign against a sample of real accounts, assuming each one performs the event below. Writes nothing — no enrollments, no payouts."
      action={
        <Button type="button" size="sm" variant="secondary" loading={running} onClick={() => void run()}>
          <Play className="size-3.5" /> Run projection
        </Button>
      }
    >
      <Grid cols={3}>
        <Field label="Assume they">
          <Select
            value={trigger}
            options={TRIGGERS.filter((t) => !t.standing).map((t) => ({ value: t.id, label: t.label }))}
            onChange={(e) => setTrigger(e.target.value as CampaignTrigger)}
          />
        </Field>
        {purchaseLike && (
          <>
            <Field label="Buying">
              <Select
                value={itemType}
                options={ITEM_OPTIONS}
                onChange={(e) => setItemType(e.target.value as DiscountItemType)}
              />
            </Field>
            <NumberField
              label={`Order value (${currency})`}
              value={amount}
              step="5"
              onChange={setAmount}
            />
          </>
        )}
      </Grid>

      {!result && (
        <p className="text-[11px] text-ink-400">
          Nothing has been projected yet. The numbers are a WORST CASE by construction: every eligible account is
          assumed to perform the event and trigger every rule.
        </p>
      )}

      {result && (
        <div className="space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Accounts sampled"
              value={String(result.sampled)}
              note={result.truncated ? "capped — totals are a lower bound" : undefined}
            />
            <StatCard label="Would qualify" value={`${result.eligible} of ${result.sampled}`} />
            <StatCard
              label="Would be paid"
              value={String(result.wouldPay)}
              note={result.totalSparks > 0 ? `${result.totalSparks} ✦ in total` : undefined}
            />
            <StatCard
              label="Worst-case cost"
              value={fmtMoney(result.totalCostUsd, currency)}
              note={result.wouldPay > 0 ? `${fmtMoney(result.avgCostUsd, currency)} each` : undefined}
            />
          </div>

          <div className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-inset ring-ink-100">
            <div className="text-[11px] uppercase tracking-wide text-ink-400">What the customer will read</div>
            <p className="text-sm text-ink-800">{result.summary || "— nothing, this campaign promises nothing."}</p>
            {result.notes.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-[11px] text-ink-500">
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>

          {result.worst.length > 0 && (
            <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
              <table className="w-full text-left text-xs">
                <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-2.5 py-1.5 font-semibold">Account</th>
                    <th className="px-2.5 py-1.5 font-semibold">Rules fired</th>
                    <th className="px-2.5 py-1.5 font-semibold">Sparks</th>
                    <th className="px-2.5 py-1.5 font-semibold">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {result.worst.map((row) => (
                    <tr key={row.uid} className="border-t border-ink-100">
                      <td className="px-2.5 py-1.5 font-mono text-[11px] text-ink-600">{row.uid.slice(0, 10)}</td>
                      <td className="px-2.5 py-1.5 text-ink-700">{row.matchedRuleIds.join(", ") || "—"}</td>
                      <td className="px-2.5 py-1.5 text-ink-700">{row.sparks || "—"}</td>
                      <td className="px-2.5 py-1.5 font-medium text-ink-800">{fmtMoney(row.costUsd, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-ink-400">
            The most expensive accounts are listed because that&apos;s where a misconfiguration shows up first — a
            single account far above the rest usually means a rule is matching something you didn&apos;t intend.
          </p>
        </div>
      )}
    </Section>
  );
}

/** Default the projection to a trigger this campaign actually uses. */
function firstDeliveredTrigger(campaign: Campaign): CampaignTrigger {
  const rule = campaign.rules.find((r) => r.enabled && !TRIGGER_META[r.trigger].standing);
  return rule?.trigger ?? "purchase";
}
