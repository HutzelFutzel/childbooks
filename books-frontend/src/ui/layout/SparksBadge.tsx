"use client";

import { useState } from "react";
import { Sparkles, Plus, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";
import { useSparksStore } from "../../state/sparksStore";
import { useSparksUiStore } from "../../state/sparksUiStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { buySparkPack } from "../../platform/payments";
import { estimateForAction, packTotalSparks } from "../../core/config/sparks";
import { fmtMoney } from "../admin/tabs/products/parts";

/**
 * The Spark balance pill in the top bar. Shows the live balance and opens a
 * lightweight wallet: buyable top-up packs + recent ledger activity. The wallet
 * open-state lives in a store so an out-of-Sparks AI call (HTTP 402) can pop it
 * automatically and pre-suggest a pack. Only rendered when the economy is on.
 */
export function SparksBadge() {
  const balance = useSparksStore((s) => s.balance);
  const ledger = useSparksStore((s) => s.ledger);
  const sparks = useAppConfigStore((s) => s.sparks);
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const walletOpen = useSparksUiStore((s) => s.walletOpen);
  const needed = useSparksUiStore((s) => s.needed);
  const openWallet = useSparksUiStore((s) => s.openWallet);
  const closeWallet = useSparksUiStore((s) => s.closeWallet);
  const openPlans = useBillingUiStore((s) => s.openPlans);
  const hasPaidPlans = useAppConfigStore((s) =>
    s.plans.plans.some((p) => p.status === "active" && !p.isFree && Object.keys(p.prices).length > 0),
  );
  const [busy, setBusy] = useState<string | null>(null);

  const packs = sparks.packs.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder);

  // "Running low" = can't afford one more page render; "out" = at/below zero.
  const pageEstimate = estimateForAction(sparks, "pageIllustration");
  const outOf = balance <= 0;
  const runningLow = !outOf && pageEstimate > 0 && balance < pageEstimate;
  const low = outOf || runningLow;

  // When opened due to a shortfall, suggest the smallest pack that covers it.
  const suggestedPackId =
    needed != null
      ? (packs.find((p) => packTotalSparks(p) >= needed) ?? packs[packs.length - 1])?.id ?? null
      : null;

  const buy = async (packId: string) => {
    setBusy(packId);
    try {
      const { url } = await buySparkPack(packId, baseCurrency);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
      setBusy(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => openWallet()}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
          low
            ? "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100"
            : "bg-brand-50 text-brand-700 ring-brand-100 hover:bg-brand-100"
        }`}
        title="Your Sparks"
      >
        <Sparkles className="size-4" />
        {balance.toLocaleString()}
      </button>

      <Modal open={walletOpen} onClose={closeWallet} title="Your Sparks" size="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl bg-brand-50 p-4 text-center ring-1 ring-inset ring-brand-100">
            <div className="flex items-center justify-center gap-2 text-3xl font-bold text-brand-700">
              <Sparkles className="size-6" />
              {balance.toLocaleString()}
            </div>
            <p className="mt-1 text-xs text-ink-500">
              Sparks pay for image generation. Text and story steps are always free.
            </p>
            {needed != null ? (
              <p className="mt-2 text-xs font-medium text-amber-700">
                You need about {needed.toLocaleString()} more Spark{needed === 1 ? "" : "s"} to finish that —
                top up below.
              </p>
            ) : outOf ? (
              <p className="mt-2 text-xs font-medium text-amber-700">
                You&apos;re out of Sparks — top up to keep illustrating.
              </p>
            ) : runningLow ? (
              <p className="mt-2 text-xs font-medium text-amber-700">
                Running low — not quite enough for another page.
              </p>
            ) : null}
          </div>

          {packs.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Top up</div>
              {packs.map((pack) => {
                const price = pack.prices[baseCurrency];
                const total = packTotalSparks(pack);
                const suggested = pack.id === suggestedPackId;
                return (
                  <div
                    key={pack.id}
                    className={`flex items-center justify-between rounded-lg bg-white p-2.5 ring-1 ring-inset transition ${
                      suggested ? "ring-2 ring-brand-400" : "ring-ink-100"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold text-ink-800">
                        {total.toLocaleString()} Sparks
                        {pack.bonusSparks > 0 && (
                          <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            +{pack.bonusSparks} bonus
                          </span>
                        )}
                        {suggested && (
                          <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                            suggested
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-400">{pack.label}</div>
                    </div>
                    <Button
                      size="sm"
                      variant={suggested ? "primary" : "secondary"}
                      leftIcon={<Plus className="size-3.5" />}
                      loading={busy === pack.id}
                      disabled={typeof price !== "number" || price <= 0}
                      onClick={() => buy(pack.id)}
                    >
                      {typeof price === "number" ? fmtMoney(price, baseCurrency) : "—"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {hasPaidPlans && (
            <button
              type="button"
              onClick={() => {
                closeWallet();
                openPlans();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-50 py-2 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
            >
              <Sparkles className="size-3.5" />
              Get monthly Sparks with a plan — usually cheaper
            </button>
          )}

          {ledger.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Recent activity</div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {ledger.slice(0, 20).map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-ink-500">
                      {e.amount >= 0 ? (
                        <ArrowDownRight className="size-3.5 text-emerald-500" />
                      ) : (
                        <ArrowUpRight className="size-3.5 text-ink-400" />
                      )}
                      {labelFor(e.type, e.reason)}
                    </span>
                    <span className={e.amount >= 0 ? "font-medium text-emerald-600" : "text-ink-500"}>
                      {e.amount >= 0 ? "+" : ""}
                      {e.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function labelFor(type: string, reason: string): string {
  switch (type) {
    case "grant":
      return reason.startsWith("subscription") ? "Subscription Sparks" : reason === "starter" ? "Welcome Sparks" : "Sparks granted";
    case "purchase":
      return "Top-up purchase";
    case "refund":
      return "Refund";
    case "spend":
      return spendLabel(reason);
    default:
      return reason || "Adjustment";
  }
}

function spendLabel(reason: string): string {
  if (reason.includes("anchor")) return "Character art";
  if (reason.toLowerCase().includes("cover")) return "Cover art";
  if (reason.toLowerCase().includes("page") || reason.toLowerCase().includes("illustration")) return "Page art";
  return "Generation";
}
