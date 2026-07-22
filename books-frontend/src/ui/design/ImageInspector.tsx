import { RotateCcw } from "lucide-react";
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
  const isFill = image.fit !== "contain";
  const zoom = Math.max(1, image.zoom ?? 1);
  const focus = image.focus ?? { x: 0.5, y: 0.5 };
  const framed = zoom > 1 || focus.x !== 0.5 || focus.y !== 0.5;

  const fitOptions: { id: ImageElement["fit"]; label: string; hint: string }[] = [
    { id: "cover", label: "Fill", hint: "Fills the frame — edges may be cropped" },
    { id: "contain", label: "Fit", hint: "Shows the whole picture — may leave a soft border" },
  ];

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
          {fitOptions.map((opt, i) => (
            <button
              key={opt.id}
              title={opt.hint}
              onClick={() => onChange({ fit: opt.id })}
              className={cn(
                "px-3 py-1.5 text-xs transition first:rounded-l-lg last:rounded-r-lg",
                i > 0 && "border-l border-ink-200",
                (image.fit === opt.id || (opt.id === "cover" && isFill))
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-600 hover:bg-ink-50",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
          {isFill ? fitOptions[0].hint : fitOptions[1].hint}
        </p>
        <Slider
          label="Corners"
          min={0}
          max={0.5}
          step={0.02}
          value={image.corner ?? 0}
          onChange={(corner) => onChange({ corner: corner || undefined })}
        />
      </Section>

      {isFill && (
        <Section
          title="Framing"
          right={
            framed ? (
              <button
                title="Reset framing"
                onClick={() => onChange({ zoom: undefined, focus: undefined })}
                className="inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-brand-600"
              >
                <RotateCcw className="size-3" /> Reset
              </button>
            ) : undefined
          }
        >
          <p className="mb-2 text-[11px] leading-snug text-ink-400">
            Tip: double-click the picture on the page to drag it around and see
            what's hidden outside the frame.
          </p>
          <Slider
            label="Zoom"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(z) => onChange({ zoom: z <= 1.001 ? undefined : z })}
            format={(z) => `${z.toFixed(1)}×`}
          />
          <Slider
            label="Left ↔ Right"
            min={0}
            max={1}
            step={0.02}
            value={focus.x}
            onChange={(x) => onChange({ focus: { x, y: focus.y } })}
            format={(v) => `${Math.round(v * 100)}`}
          />
          <Slider
            label="Up ↕ Down"
            min={0}
            max={1}
            step={0.02}
            value={focus.y}
            onChange={(y) => onChange({ focus: { x: focus.x, y } })}
            format={(v) => `${Math.round(v * 100)}`}
          />
        </Section>
      )}

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
