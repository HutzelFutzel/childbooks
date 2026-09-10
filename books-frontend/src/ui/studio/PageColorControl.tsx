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
  compactSide = "single",
  active = false,
  label = "Page color",
  onActivate,
}: {
  pageId: string;
  compact?: boolean;
  compactSide?: "single" | "left" | "right";
  active?: boolean;
  label?: string;
  onActivate?: () => void;
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
      label={label}
      value={color}
      allowAlpha={false}
      compact={compact}
      compactSide={compactSide}
      compactActive={active}
      live
      look="swatch"
      onChange={(next) =>
        setPageBackground(pageId, { color: next }, { coalesce: `page-bg-${pageId}` })
      }
      onOpenChange={(open) => {
        if (open) onActivate?.();
        else endHistoryGesture();
      }}
      footer={footer}
    />
  );
}

/** Two independently editable facing-page colors in one split toolbar swatch. */
export function FacingPageColorControl({
  pages,
  activePageId,
  onSelectPage,
}: {
  pages: ReadonlyArray<{ id: string; label: string }>;
  activePageId?: string;
  onSelectPage: (pageId: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Facing page colors"
      className="inline-flex rounded-lg shadow-[0_0_0_1px_rgba(15,23,42,0.03)]"
    >
      {pages.map((page, index) => (
        <PageColorControl
          key={page.id}
          pageId={page.id}
          compact
          compactSide={index === 0 ? "left" : "right"}
          active={activePageId === page.id}
          label={`${page.label} color`}
          onActivate={() => onSelectPage(page.id)}
        />
      ))}
    </div>
  );
}
