"use client";

import { Sparkles } from "lucide-react";
import { Modal } from "../components/Modal";
import { useImageTierPromptStore } from "../../state/imageTierPrompt";
import { usePreferredImageTier, setPreferredImageTier } from "../../state/imageTier";
import { useAppConfigStore } from "../../state/appConfigStore";
import { ImageTierPicker } from "./ImageTierPicker";

/**
 * The blocking, one-time image-quality chooser. Generation is gated behind a
 * tier selection (see `requireImageTier`): the first time the user hits any
 * generate action without a chosen tier, this opens so they pick "Fast" or
 * "High-Quality" first. Once chosen it closes and the choice sticks for every
 * future generation (changeable anytime from the top bar or Settings).
 */
export function ImageTierPromptDialog() {
  const open = useImageTierPromptStore((s) => s.open);
  const close = useImageTierPromptStore((s) => s.close);
  const select = useImageTierPromptStore((s) => s.select);
  const tier = usePreferredImageTier();
  const labels = useAppConfigStore((s) => s.modelConfig.imageTierLabels);

  return (
    <Modal open={open} onClose={close} title="Choose image quality" size="max-w-lg">
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-xs text-brand-800 ring-1 ring-inset ring-brand-100">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-500" />
          <span>
            {`Before you generate, pick the quality you want. A common flow: draft the whole book on ${labels.quick}, then re-render your favorite pages on ${labels.premium}. You can change this anytime from the top bar or Settings. Your generation will start as soon as you choose.`}
          </span>
        </div>
        <ImageTierPicker
          value={tier}
          onChange={(t) => {
            void setPreferredImageTier(t).then(() => select(t));
          }}
        />
      </div>
    </Modal>
  );
}
