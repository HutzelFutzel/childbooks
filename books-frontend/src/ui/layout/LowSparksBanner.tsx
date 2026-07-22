"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import { useSparksStore } from "../../state/sparksStore";
import { useImageActionRange } from "./SparkCost";

/**
 * A slim nudge for guests whose Sparks are running out: the next Sparks for
 * them come from the signup bonus (not a purchase), so frame the account as
 * the way to keep going. Session-dismissible so it never nags.
 */
export function LowSparksBanner() {
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const balance = useSparksStore((s) => s.balance);
  const balanceLoading = useSparksStore((s) => s.loading);
  const sparks = useAppConfigStore((s) => s.sparks);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("lowSparksBannerDismissed") === "1";
    } catch {
      return false;
    }
  });

  // "Low" = can't afford one more page render (upper bound of the estimate).
  const pageRange = useImageActionRange("pageIllustration");
  const pageEstimate = pageRange?.maxSparks ?? 0;
  const low = pageEstimate > 0 && balance < pageEstimate;

  const bonus = sparks.grants.signupBonusSparks;
  if (accessLevel !== "guest" || !sparks.enabled || balanceLoading || !low || dismissed || bonus <= 0)
    return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem("lowSparksBannerDismissed", "1");
    } catch {
      /* session-only anyway */
    }
  };

  return (
    <div className="flex items-center justify-center gap-3 border-b border-magic-300/50 bg-magic-100 px-4 py-2 text-xs text-magic-700">
      <span className="flex min-w-0 items-center gap-1.5">
        <Sparkles className="size-4 shrink-0" />
        <span className="truncate">
          {balance <= 0 ? "You're out of Sparks" : "Your Sparks are running low"} — create a free
          account and get <span className="font-semibold">+{bonus} ✦</span> instantly
          {sparks.grants.verifyBonusSparks > 0 && (
            <> (plus +{sparks.grants.verifyBonusSparks} ✦ when you verify)</>
          )}
          .
        </span>
      </span>
      <button
        type="button"
        onClick={openAuthDialog}
        className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 font-semibold text-magic-700 ring-1 ring-inset ring-magic-300/60 transition hover:bg-white"
      >
        Create free account
      </button>
      <button
        type="button"
        onClick={dismiss}
        title="Dismiss"
        className="shrink-0 rounded-full p-1 text-magic-500 transition hover:bg-white/60"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
