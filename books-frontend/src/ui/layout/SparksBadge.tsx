"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Plus, ArrowDownRight, ArrowUpRight, Gift, Copy, Users } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { useSparksStore } from "../../state/sparksStore";
import { useSparksUiStore } from "../../state/sparksUiStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import {
  buySparkGift,
  buySparkPack,
  claimSparkGift,
  getReferralInfo,
  listMyGifts,
  type ReferralInfo,
  type SparkGiftSummary,
} from "../../platform/payments";
import { packTotalSparks } from "../../core/config/sparks";
import { fmtMoney } from "../admin/tabs/products/parts";
import { useImageActionRange } from "./SparkCost";

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
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const [busy, setBusy] = useState<string | null>(null);

  // Glint the ✦ whenever the balance changes (grant or spend) — the little
  // "fairy dust" moment. Keyed remount restarts the one-shot CSS animation.
  const prevBalance = useRef<number | null>(null);
  const [glintKey, setGlintKey] = useState(0);
  useEffect(() => {
    if (prevBalance.current !== null && prevBalance.current !== balance) {
      setGlintKey((k) => k + 1);
    }
    prevBalance.current = balance;
  }, [balance]);

  // Welcome moment: the first time a guest's starter grant lands, pop the
  // wallet once so they learn they have Sparks to spend (and what's next on
  // the ladder). Waiting for balance > 0 means the modal always shows the
  // granted amount, never an empty zero.
  useEffect(() => {
    if (accessLevel !== "guest" || balance <= 0) return;
    try {
      if (localStorage.getItem("sparksWelcomeShown")) return;
      localStorage.setItem("sparksWelcomeShown", "1");
    } catch {
      return; // storage unavailable — skip rather than nag on every visit
    }
    openWallet();
  }, [accessLevel, balance, openWallet]);

  const packs = sparks.packs.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder);

  // "Running low" = can't afford one more page render at the chosen tier; "out"
  // = at/below zero. Uses the upper bound of the tier estimate to be safe.
  const pageRange = useImageActionRange("pageIllustration");
  const pageEstimate = pageRange?.maxSparks ?? 0;
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

  const buyGift = async (packId: string) => {
    setBusy(`gift-${packId}`);
    try {
      const { url } = await buySparkGift({ packId, currency: baseCurrency });
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
            : "bg-magic-100 text-magic-700 ring-magic-300/50 hover:bg-magic-300/40"
        }`}
        title="Your Sparks"
      >
        <Sparkles key={glintKey} className={glintKey > 0 ? "size-4 animate-glint" : "size-4"} />
        {balance.toLocaleString()}
      </button>

      <Modal open={walletOpen} onClose={closeWallet} title="Your Sparks" size="max-w-md">
        <div className="space-y-4">
          <div className="bg-magic rounded-xl p-4 text-center ring-1 ring-inset ring-magic-300/50">
            <div className="flex items-center justify-center gap-2 text-3xl font-bold text-magic-700">
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

          {/* Guests / unverified users can't buy — their next Sparks come from
              the remaining ladder rungs, so pitch those instead of packs. */}
          {accessLevel === "guest" && (
            <div className="space-y-2 rounded-xl bg-brand-50 p-3 text-center">
              <p className="text-xs text-ink-600">
                Create a free account to keep your book safe
                {sparks.grants.signupBonusSparks > 0 && (
                  <>
                    {" "}
                    and get <span className="font-semibold text-brand-700">+{sparks.grants.signupBonusSparks} ✦</span> instantly
                  </>
                )}
                {sparks.grants.verifyBonusSparks > 0 && (
                  <> — plus +{sparks.grants.verifyBonusSparks} ✦ when you verify your email</>
                )}
                .
              </p>
              <Button
                size="sm"
                onClick={() => {
                  closeWallet();
                  openAuthDialog();
                }}
              >
                Create free account
              </Button>
            </div>
          )}
          {accessLevel === "unverified" && sparks.grants.verifyBonusSparks > 0 && (
            <div className="rounded-xl bg-brand-50 p-3 text-center">
              <p className="text-xs text-ink-600">
                Verify your email to unlock{" "}
                <span className="font-semibold text-brand-700">+{sparks.grants.verifyBonusSparks} ✦</span> and the full studio.
              </p>
            </div>
          )}

          {accessLevel === "full" && packs.length > 0 && (
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
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Buy this pack as a gift — you'll get a claim code to share."
                        leftIcon={<Gift className="size-3.5" />}
                        loading={busy === `gift-${pack.id}`}
                        disabled={typeof price !== "number" || price <= 0}
                        onClick={() => buyGift(pack.id)}
                      />
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
                  </div>
                );
              })}
            </div>
          )}

          {accessLevel === "full" && <GiftsAndInvites open={walletOpen} />}

          {accessLevel === "full" && hasPaidPlans && (
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

/**
 * The wallet's "gifts & invites" block: redeem a gift code, share your referral
 * link (when the program is on), and see the claim codes of gifts you bought.
 * Loaded lazily when the wallet opens; failures degrade to just the redeemer.
 */
function GiftsAndInvites({ open }: { open: boolean }) {
  const [code, setCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [gifts, setGifts] = useState<SparkGiftSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    getReferralInfo().then(setReferral).catch(() => setReferral(null));
    listMyGifts().then(setGifts).catch(() => setGifts([]));
  }, [open]);

  const claim = async () => {
    if (!code.trim()) return;
    setClaiming(true);
    try {
      const sparks = await claimSparkGift(code);
      toast.success(`Gift redeemed — ${sparks.toLocaleString()} Sparks added!`);
      setCode("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not claim this gift.");
    } finally {
      setClaiming(false);
    }
  };

  const copyReferralLink = () => {
    if (!referral) return;
    // Point at the studio, where the ref param is captured and later claimed.
    const link = `${window.location.origin}/studio?ref=${referral.code}`;
    void navigator.clipboard.writeText(link).then(
      () => toast.success("Invite link copied!"),
      () => toast.error("Could not copy the link."),
    );
  };

  return (
    <div className="space-y-3">
      {/* Redeem a gift code */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Have a gift code?
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void claim();
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            className="font-mono"
          />
          <Button type="submit" size="sm" variant="secondary" loading={claiming} disabled={!code.trim()}>
            Redeem
          </Button>
        </form>
      </div>

      {/* Referral program */}
      {referral?.enabled && (
        <button
          type="button"
          onClick={copyReferralLink}
          className="flex w-full items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-800 transition hover:bg-emerald-100"
        >
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5 shrink-0" />
            Invite a friend — you get {referral.referrerSparks} ✦, they get {referral.referredSparks} ✦
            on their first purchase.
          </span>
          <span className="flex shrink-0 items-center gap-1 font-mono font-semibold">
            {referral.code} <Copy className="size-3" />
          </span>
        </button>
      )}

      {/* Gifts this user bought */}
      {gifts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Gifts you bought
          </div>
          {gifts.map((g) => (
            <div
              key={g.code}
              className="flex items-center justify-between gap-2 rounded-lg bg-ink-50/60 px-3 py-1.5 text-xs"
            >
              <span className="text-ink-600">
                {g.sparks.toLocaleString()} ✦ · {g.status === "claimed" ? "redeemed" : "not redeemed yet"}
              </span>
              <button
                type="button"
                className="flex items-center gap-1 font-mono font-semibold text-ink-700 hover:text-brand-700"
                title="Copy the claim code"
                onClick={() =>
                  void navigator.clipboard.writeText(g.code).then(
                    () => toast.success("Gift code copied!"),
                    () => toast.error("Could not copy."),
                  )
                }
              >
                {g.code} <Copy className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelFor(type: string, reason: string): string {
  switch (type) {
    case "grant":
      return reason.startsWith("subscription")
        ? "Subscription Sparks"
        : reason === "starter"
          ? "Welcome Sparks"
          : reason === "signup bonus"
            ? "Signup bonus"
            : reason === "verify bonus"
              ? "Verification bonus"
              : reason.startsWith("referral")
                ? "Referral reward"
                : "Sparks granted";
    case "purchase":
      return reason === "gift" ? "Gift redeemed" : "Top-up purchase";
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
