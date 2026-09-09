/**
 * Paper color for the current page. Compact swatch for the Pages toolbar;
 * labeled field for Book setup. Apply-to-all lives in the picker footer.
 */
import { Check } from "lucide-react";
import { ColorField } from "../design/ColorPicker";
import { cn } from "../lib/cn";
import { useStudio } from "./StudioContext";
import {
  interiorPageIds,
  pageColorAppliedToAll,
  pageColorNeedsApplyToAll,
  pageColorOf,
} from "./pageBackground";

export function PageColorControl({
  pageId,
  compact = false,
}: {
  pageId: string;
  compact?: boolean;
}) {
  const { design, setPageBackground, applyPageBackgroundToAll, endHistoryGesture } = useStudio();
  const page = design.pages[pageId];
  const color = pageColorOf(page);
  const interiors = interiorPageIds(design);
  const applied = pageColorAppliedToAll(design, color);
  const canApply = pageColorNeedsApplyToAll(design, color);

  const footer = (
    <button
      type="button"
      disabled={!canApply}
      title={
        interiors.length === 0
          ? "No story pages to update"
          : canApply
            ? "Use this paper color on every story page. Covers stay as they are."
            : "Every story page already uses this color"
      }
      onClick={() => applyPageBackgroundToAll(pageId)}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition",
        canApply
          ? "text-ink-700 hover:bg-ink-50"
          : "cursor-default text-ink-400",
      )}
    >
      <span className="flex items-center gap-1.5">
        {!canApply && applied ? <Check className="size-3.5" /> : null}
        {!canApply && applied ? "On all pages" : "Apply to all pages"}
      </span>
      {interiors.length > 0 && (
        <span className="tabular-nums text-ink-400">{interiors.length}</span>
      )}
    </button>
  );

  return (
    <ColorField
      label="Page color"
      value={color}
      allowAlpha={false}
      compact={compact}
      live
      look="swatch"
      onChange={(next) =>
        setPageBackground(pageId, { color: next }, { coalesce: `page-bg-${pageId}` })
      }
      onOpenChange={(open) => {
        if (!open) endHistoryGesture();
      }}
      footer={footer}
    />
  );
}
