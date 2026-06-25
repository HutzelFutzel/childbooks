import type { ElementEffects, ImageElement } from "../../core/types";
import { cn } from "../lib/cn";
import { EffectsControls } from "./EffectsControls";
import { ActionBar, AlignPad, type AlignEdge, Section, Slider } from "./inspectorKit";

/** Contextual editor for a placed image (asset or repositioned illustration). */
export function ImageInspector({
  image,
  onChange,
  onDelete,
  onDuplicate,
  onAlign,
}: {
  image: ImageElement;
  onChange: (patch: Partial<ImageElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAlign: (edge: AlignEdge) => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <ActionBar
        locked={image.locked}
        onDuplicate={onDuplicate}
        onToggleLock={() => onChange({ locked: !image.locked })}
        onDelete={onDelete}
      />

      <Section title={image.kind === "illustration" ? "Illustration" : "Image"}>
        <div className="inline-flex rounded-lg border border-ink-200">
          {(["cover", "contain"] as const).map((fit, i) => (
            <button
              key={fit}
              onClick={() => onChange({ fit })}
              className={cn(
                "px-3 py-1.5 text-xs capitalize transition first:rounded-l-lg last:rounded-r-lg",
                i > 0 && "border-l border-ink-200",
                image.fit === fit ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50",
              )}
            >
              {fit}
            </button>
          ))}
        </div>
        <Slider
          label="Corners"
          min={0}
          max={0.5}
          step={0.02}
          value={image.corner ?? 0}
          onChange={(corner) => onChange({ corner: corner || undefined })}
        />
      </Section>

      <Section title="Position on page">
        <AlignPad onAlign={onAlign} />
      </Section>

      <Section title="Effects" collapsible defaultOpen={!!image.effects}>
        <EffectsControls
          effects={image.effects}
          showOpacity
          onChange={(effects: ElementEffects | undefined) => onChange({ effects })}
        />
      </Section>
    </div>
  );
}
