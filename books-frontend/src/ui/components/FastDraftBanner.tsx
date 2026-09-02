"use client";

import { AlertTriangle } from "lucide-react";
import { setPreferredImageTier, usePreferredImageTier } from "../../state/imageTier";
import { useAuthStore } from "../../state/authStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { Button } from "./Button";

/**
 * Soft nudge when the active image version was generated on the Fast tier.
 * Switching preferred tier means the next generate / update uses High-Quality;
 * this does not regenerate on its own.
 */
export function FastDraftBanner({
  onUpgrade,
  upgrading = false,
}: {
  onUpgrade?: () => void;
  upgrading?: boolean;
} = {}) {
  const preferred = usePreferredImageTier();
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const labels = useAppConfigStore((s) => s.modelConfig.imageTierLabels);
  const tierUi = useAppConfigStore((s) => s.modelConfig.imageTierUi);
  const alreadyPremium = preferred === "premium";
  const premiumLocked = accessLevel === "guest";
  const quickLabel = labels.quick;
  const premiumLabel = labels.premium;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600" />
            {quickLabel} image
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
            {tierUi.quick.generatedImageNotice}
          </p>
        </div>
        {(onUpgrade || !alreadyPremium) && (
          <Button
            className="w-full whitespace-normal"
            size="sm"
            variant="secondary"
            loading={upgrading}
            onClick={() =>
              premiumLocked
                ? openAuthDialog(`Create a free account to use ${premiumLabel} images.`)
                : onUpgrade
                  ? void setPreferredImageTier("premium").then(onUpgrade)
                  : void setPreferredImageTier("premium")
            }
          >
            {premiumLocked
              ? `Sign in for ${premiumLabel}`
              : onUpgrade
                ? `Recreate in ${premiumLabel}`
                : `Use ${premiumLabel} next time`}
          </Button>
        )}
      </div>
    </div>
  );
}
