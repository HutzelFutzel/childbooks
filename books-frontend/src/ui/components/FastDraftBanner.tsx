"use client";

import { AlertTriangle } from "lucide-react";
import { setPreferredImageTier, usePreferredImageTier } from "../../state/imageTier";
import { Button } from "./Button";
import { InfoHint } from "./InfoHint";

/**
 * Soft nudge when the active image version was generated on the Fast tier.
 * Switching preferred tier means the next generate / update uses High-Quality;
 * this does not regenerate on its own.
 */
export function FastDraftBanner() {
  const preferred = usePreferredImageTier();
  const alreadyPremium = preferred === "premium";
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600" />
            Fast draft
            <InfoHint topic="fastTierConsistency" icon={AlertTriangle} className="text-amber-500" />
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
            Fine for layout and ideas — Fast often adds unexpected artifacts. Use
            High-Quality for real designing and keepers.
          </p>
        </div>
        {!alreadyPremium && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void setPreferredImageTier("premium")}
          >
            Use High-Quality
          </Button>
        )}
      </div>
    </div>
  );
}
