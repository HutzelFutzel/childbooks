import { ImageIcon } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * A labeled stand-in for an illustration/asset that will be dropped in later.
 * Renders a dashed, brand-tinted box at the target aspect ratio so the layout
 * is final now and real art can be swapped in without touching structure.
 *
 * See `ui/marketing/GRAPHICS.md` for the full list of assets to produce.
 */
export function GraphicPlaceholder({
  label,
  ratio = "16/9",
  className,
  hint,
}: {
  /** What art belongs here (e.g. "Hero storybook spread"). */
  label: string;
  /** CSS aspect-ratio value, e.g. "16/9", "1200/630", "4/5". */
  ratio?: string;
  className?: string;
  /** Optional dimension hint, e.g. "1200×900". */
  hint?: string;
}) {
  return (
    <div
      role="img"
      aria-label={`Placeholder: ${label}`}
      style={{ aspectRatio: ratio }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-200",
        "bg-brand-50/60 bg-grid p-6 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-white/80 text-brand-500 shadow-soft">
        <ImageIcon className="size-5" />
      </span>
      <span className="text-sm font-semibold text-brand-700">{label}</span>
      {hint && <span className="text-xs text-brand-400">{hint}</span>}
    </div>
  );
}
