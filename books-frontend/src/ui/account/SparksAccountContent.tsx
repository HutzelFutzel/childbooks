"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { packTotalSparks } from "../../core/config/sparks";
import { buySparkPack } from "../../platform/payments";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import { useSparksStore } from "../../state/sparksStore";
import { Button } from "../components/Button";
import { OffersBlock } from "../layout/OffersBlock";
import { fmtMoney } from "../admin/tabs/products/parts";

export function SparksAccountContent() {
  const balance = useSparksStore((s) => s.balance);
  const loading = useSparksStore((s) => s.loading);
  const ledger = useSparksStore((s) => s.ledger);
  const sparks = useAppConfigStore((s) => s.sparks);
  const currency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const [busy, setBusy] = useState<string | null>(null);

  const packs = sparks.packs
    .filter((pack) => pack.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const buy = async (packId: string) => {
    setBusy(packId);
    try {
      const { url } = await buySparkPack(packId, currency);
      window.location.href = url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start checkout.");
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-100 pb-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Available balance</p>
          <p className="mt-1 flex items-center gap-2 font-display text-4xl font-bold tracking-tight text-ink-900">
            <Sparkles className="size-7 text-magic-500" />
            {loading ? "—" : balance.toLocaleString()}
          </p>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-500">
            Sparks power image generation. Writing, editing and story steps remain free.
          </p>
        </div>
        <Link
          href="/account/membership"
          className="text-sm font-semibold text-brand-700 transition hover:text-brand-800"
        >
          Compare memberships →
        </Link>
      </section>

      <OffersBlock open />

      <section>
        <h2 className="text-sm font-semibold text-ink-900">Top up</h2>
        <p className="mt-1 text-sm text-ink-500">One-time packs never expire.</p>

        {accessLevel !== "full" ? (
          <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            Verify your account to purchase Sparks.
          </p>
        ) : packs.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">No top-up packs are available right now.</p>
        ) : (
          <div className="mt-4 divide-y divide-ink-100 border-y border-ink-100">
            {packs.map((pack) => {
              const price = pack.prices[currency];
              return (
                <div key={pack.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <p className="font-semibold text-ink-900">
                      {packTotalSparks(pack).toLocaleString()} Sparks
                      {pack.bonusSparks > 0 && (
                        <span className="ml-2 text-xs font-medium text-emerald-700">
                          +{pack.bonusSparks.toLocaleString()} bonus
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">{pack.label}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={busy === pack.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    disabled={busy !== null || typeof price !== "number" || price <= 0}
                    onClick={() => void buy(pack.id)}
                  >
                    {typeof price === "number" ? fmtMoney(price, currency) : "Unavailable"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-900">Activity</h2>
        {ledger.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Your Spark activity will appear here.</p>
        ) : (
          <div className="mt-3 divide-y divide-ink-100">
            {ledger.slice(0, 50).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-ink-600">
                  {entry.amount >= 0 ? (
                    <ArrowDownRight className="size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <ArrowUpRight className="size-4 shrink-0 text-ink-400" />
                  )}
                  <span className="truncate">{sparkActivityLabel(entry.type, entry.reason)}</span>
                </span>
                <span className={entry.amount >= 0 ? "font-semibold text-emerald-700" : "font-medium text-ink-600"}>
                  {entry.amount >= 0 ? "+" : ""}
                  {entry.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function sparkActivityLabel(type: string, reason: string): string {
  if (type === "grant") {
    if (reason.startsWith("subscription")) return "Membership Sparks";
    if (reason === "starter") return "Welcome Sparks";
    if (reason === "signup bonus") return "Signup bonus";
    if (reason === "verify bonus") return "Verification bonus";
    if (reason.startsWith("referral")) return "Referral reward";
    return "Sparks granted";
  }
  if (type === "purchase") return reason === "gift" ? "Gift redeemed" : "Top-up purchase";
  if (type === "refund") return "Refund";
  if (reason.includes("anchor")) return "Character art";
  if (reason.toLowerCase().includes("cover")) return "Cover art";
  if (reason.toLowerCase().includes("page") || reason.toLowerCase().includes("illustration")) return "Page art";
  return reason || "Generation";
}
