"use client";

import { Sparkles } from "lucide-react";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";
import { useSparksShortfallStore } from "../../state/sparksShortfallPrompt";
import { useSparksUiStore } from "../../state/sparksUiStore";
import type { ImageActionId } from "../../core/ai/actions";

/** What a batch of each action draws, in the words the studio already uses. */
const NOUN: Record<ImageActionId, { one: string; many: string }> = {
  anchorImage: { one: "reference", many: "references" },
  pageIllustration: { one: "page", many: "pages" },
  coverIllustration: { one: "cover", many: "covers" },
};

/**
 * Explains a batch that can't be paid for, instead of letting it fail silently.
 *
 * Generation is all-or-nothing (see `sparksShortfallPrompt`), so the honest
 * thing to show is the arithmetic: what the batch costs, what's in the wallet,
 * and how far that goes. "Top up" hands off to the wallet with the shortfall
 * pre-filled so the smallest sufficient pack is suggested; the batch itself is
 * not resumed — the user presses Generate again once they have the Sparks.
 */
export function SparksShortfallDialog() {
  const pending = useSparksShortfallStore((s) => s.pending);
  const dismiss = useSparksShortfallStore((s) => s.dismiss);
  const openWallet = useSparksUiStore((s) => s.openWallet);

  // Keep the last shortfall while the modal animates out, so the text doesn't
  // blank mid-transition.
  const noun = NOUN[pending?.action ?? "anchorImage"];
  const requested = pending?.requested ?? 0;
  const affordable = pending?.affordable ?? 0;

  return (
    <Modal
      open={Boolean(pending)}
      onClose={dismiss}
      title="Not enough Sparks for this batch"
      size="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            Cancel
          </Button>
          <Button
            leftIcon={<Sparkles className="size-4" />}
            onClick={() => {
              const needed = pending?.shortfall;
              dismiss();
              openWallet(needed);
            }}
          >
            Top up
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-700">
        <p>
          Drawing {requested === 1 ? "this" : `all ${requested.toLocaleString()}`}{" "}
          {requested === 1 ? noun.one : noun.many} costs about{" "}
          <strong className="font-semibold text-ink-900">
            {(pending?.estimate ?? 0).toLocaleString()} Sparks
          </strong>
          . You have {(pending?.balance ?? 0).toLocaleString()}
          {affordable > 0 ? (
            <> — enough for about {affordable.toLocaleString()} of them.</>
          ) : (
            <>, which doesn&apos;t cover even one.</>
          )}
        </p>
        <p>
          Nothing has been drawn and no Sparks were spent. Top up{" "}
          {(pending?.shortfall ?? 0).toLocaleString()} or more and press Generate again to draw the
          whole set at once.
        </p>
        <p className="text-xs text-ink-500">
          That&apos;s an estimate — the final charge is the measured cost of each image, so it can
          differ a little.
        </p>
      </div>
    </Modal>
  );
}
