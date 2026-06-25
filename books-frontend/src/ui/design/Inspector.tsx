import { useEffect, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Italic,
  Maximize2,
  MoveVertical,
  Strikethrough,
  Underline,
  WrapText,
} from "lucide-react";
import { textFromParagraphs, wordParagraphs } from "../../core/design";
import type { ElementEffects, HAlign, PatternConfig, TextBox, TextSpan, VAlign } from "../../core/types";
import { FontPicker } from "../typography/FontPicker";
import { ColorField } from "./ColorPicker";
import { EffectsControls } from "./EffectsControls";
import { PatternPicker } from "./PatternPicker";
import { TEXT_PRESETS, getPreset } from "./presets";
import { cn } from "../lib/cn";
import {
  ActionBar,
  AlignPad,
  IconButton,
  IconToggle,
  PillToggle,
  SegGroup,
  Section,
} from "./inspectorKit";
import type { SpanRef } from "./TextBoxView";

export function Inspector({
  box,
  selectedSpan,
  pageWidthIn,
  pageHeightIn,
  onChange,
  onChangeSpan,
  onDelete,
  onDuplicate,
  onAlign,
  onFitText,
  onFitBox,
  onToggleAutoFit,
  onToggleAutoFitGrow,
}: {
  box: TextBox | null;
  selectedSpan: SpanRef | null;
  /** Real single-page trim, so font size can be shown in physical points. */
  pageWidthIn?: number;
  pageHeightIn?: number;
  onChange: (patch: Partial<TextBox>) => void;
  onChangeSpan: (ref: SpanRef, patch: Partial<TextSpan>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAlign: (edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => void;
  onFitText: () => void;
  onFitBox: () => void;
  onToggleAutoFit: () => void;
  onToggleAutoFitGrow: () => void;
}) {
  // Font size is stored as a fraction of page height; convert to/from real
  // points using the physical trim so "20 pt" means 20 pt on the printed page,
  // regardless of book size. Fall back to a common trim if not provided.
  const trimHeightIn = pageHeightIn && pageHeightIn > 0 ? pageHeightIn : 8.27;
  const ptPerPct = trimHeightIn * 72;
  const fmtIn = (n?: number) => (n ? Math.round(n * 10) / 10 : undefined);
  // Local draft for the text editor so the caret never jumps: we only resync
  // from the box when the *content* genuinely changes elsewhere (box switch,
  // undo/redo, per-word styling) — not after our own normalized keystrokes.
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (!box) return;
    const external = textFromParagraphs(box.paragraphs);
    if (external !== textFromParagraphs(wordParagraphs(draft))) setDraft(external);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.id, box?.paragraphs]);

  if (!box) {
    return (
      <div className="p-4 text-sm text-ink-400">
        Select a text box to edit it, or add one from the toolbar.
      </div>
    );
  }

  const span =
    selectedSpan ? box.paragraphs[selectedSpan.p]?.spans[selectedSpan.i] : undefined;

  return (
    <div className="space-y-4 p-4">
      {/* Actions */}
      <ActionBar
        locked={box.locked}
        onDuplicate={onDuplicate}
        onToggleLock={() => onChange({ locked: !box.locked })}
        onDelete={onDelete}
      />

      {/* Content */}
      <Section title="Text">
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange({ paragraphs: wordParagraphs(e.target.value) });
          }}
          rows={3}
          className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm"
        />
        <p className="mt-1 text-[11px] text-ink-400">
          Tip: double-click on the page to edit, and select words to style them.
        </p>
      </Section>

      {/* Quick actions */}
      <Section title="Quick actions">
        <div className="flex flex-wrap items-center gap-1.5">
          <IconButton title="Shrink font to fit the box" onClick={onFitText}>
            <Maximize2 className="size-4" />
          </IconButton>
          <IconButton title="Resize box height to the text" onClick={onFitBox}>
            <WrapText className="size-4" />
          </IconButton>
          <PillToggle
            label="Auto-fit"
            active={!!box.autoFit}
            onClick={onToggleAutoFit}
            title="Shrink text so it never clips"
          />
          <PillToggle
            label="Grow to fill"
            active={!!box.autoFitGrow}
            onClick={onToggleAutoFitGrow}
            title="Also enlarge text to fill the box"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-ink-400">
          Auto-fit shrinks text to stay inside the box. “Grow to fill” also enlarges
          it to fill the box as you resize.
        </p>
      </Section>

      {/* Per-word styling */}
      {span && (
        <Section title={`Selected word: "${span.text.trim() || "·"}"`}>
          <div className="flex items-center gap-1">
            <IconToggle title="Bold" active={!!span.bold} onClick={() => onChangeSpan(selectedSpan!, { bold: !span.bold })}><Bold className="size-4" /></IconToggle>
            <IconToggle title="Italic" active={!!span.italic} onClick={() => onChangeSpan(selectedSpan!, { italic: !span.italic })}><Italic className="size-4" /></IconToggle>
            <IconToggle title="Underline" active={!!span.underline} onClick={() => onChangeSpan(selectedSpan!, { underline: !span.underline })}><Underline className="size-4" /></IconToggle>
            <IconToggle title="Strikethrough" active={!!span.strike} onClick={() => onChangeSpan(selectedSpan!, { strike: !span.strike })}><Strikethrough className="size-4" /></IconToggle>
            <div className="ml-1">
              <ColorField value={span.color ?? box.color} onChange={(color) => onChangeSpan(selectedSpan!, { color })} />
            </div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-500">
            <span className="w-12">Size</span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.05}
              value={span.sizeMul ?? 1}
              onChange={(e) => onChangeSpan(selectedSpan!, { sizeMul: Number(e.target.value) })}
              className="flex-1"
            />
          </label>
        </Section>
      )}

      {/* Typography */}
      <Section title="Font">
        {fmtIn(pageWidthIn) && fmtIn(pageHeightIn) && (
          <p className="mb-2 text-[11px] text-ink-400">
            Page {fmtIn(pageWidthIn)}″ × {fmtIn(pageHeightIn)}″ — font size shown in real points.
          </p>
        )}
        <FontPicker value={box.fontFamily} onChange={(family) => onChange({ fontFamily: family })} />
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-500">
          <span className="w-12">Size</span>
          <input
            type="range"
            min={6}
            max={120}
            step={1}
            value={Math.round(box.fontSizePct * ptPerPct)}
            onChange={(e) => onChange({ fontSizePct: Number(e.target.value) / ptPerPct })}
            className="flex-1"
          />
          <span className="w-10 text-right tabular-nums text-ink-500">
            {Math.round(box.fontSizePct * ptPerPct)}pt
          </span>
        </label>
        <label className="mt-1 flex items-center gap-2 text-xs text-ink-500">
          <span className="w-12">Line</span>
          <input
            type="range"
            min={0.9}
            max={2}
            step={0.05}
            value={box.lineHeight}
            onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
            className="flex-1"
          />
        </label>
        <div className="mt-2">
          <ColorField label="Text color" value={box.color} onChange={(color) => onChange({ color })} />
        </div>
      </Section>

      {/* Text alignment */}
      <Section title="Text alignment">
        <div className="flex flex-wrap items-center gap-1.5">
          <SegGroup<HAlign>
            value={box.align}
            onChange={(align) => onChange({ align })}
            options={[
              { id: "left", node: <AlignLeft className="size-4" />, title: "Left" },
              { id: "center", node: <AlignCenter className="size-4" />, title: "Centre" },
              { id: "right", node: <AlignRight className="size-4" />, title: "Right" },
            ]}
          />
          <SegGroup<VAlign>
            value={box.vAlign}
            onChange={(vAlign) => onChange({ vAlign })}
            options={[
              { id: "top", node: <ArrowUpToLine className="size-4" />, title: "Top" },
              { id: "center", node: <MoveVertical className="size-4" />, title: "Middle" },
              { id: "bottom", node: <ArrowDownToLine className="size-4" />, title: "Bottom" },
            ]}
          />
        </div>
      </Section>

      {/* Position on page */}
      <Section title="Position on page">
        <AlignPad onAlign={onAlign} />
      </Section>

      {/* Box style preset */}
      <Section title="Box style">
        <div className="grid grid-cols-3 gap-1.5">
          {TEXT_PRESETS.map((p) => (
            <PresetChip
              key={p.id}
              presetId={p.id}
              label={p.label}
              active={box.presetId === p.id}
              onClick={() => {
                const def = getPreset(p.id).defaults;
                onChange({ presetId: p.id, fill: def.fill, stroke: def.stroke, color: def.text });
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <ColorField label="Fill" value={box.fill ?? "rgba(255,255,255,0)"} onChange={(fill) => onChange({ fill })} />
          <ColorField label="Accent" value={box.stroke ?? "rgba(0,0,0,0)"} onChange={(stroke) => onChange({ stroke })} />
        </div>
      </Section>

      {/* Pattern */}
      <Section title="Pattern" collapsible defaultOpen={!!box.pattern}>
        <PatternPicker
          value={box.pattern}
          onChange={(pattern: PatternConfig | undefined) => onChange({ pattern })}
        />
      </Section>

      {/* Effects */}
      <Section title="Effects" collapsible defaultOpen={!!box.effects}>
        <EffectsControls
          effects={box.effects}
          showOpacity
          onChange={(effects: ElementEffects | undefined) => onChange({ effects })}
        />
      </Section>
    </div>
  );
}

/** A live mini-preview of a text preset, rendered with its real chrome. */
function PresetChip({
  presetId,
  label,
  active,
  onClick,
}: {
  presetId: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const preset = getPreset(presetId);
  const colors = preset.defaults;
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex flex-col items-stretch gap-1 rounded-lg border p-1 transition",
        active ? "border-brand-500 ring-1 ring-brand-200" : "border-ink-200 hover:border-brand-300",
      )}
    >
      <span
        className="relative flex h-9 items-center justify-center overflow-hidden rounded-md"
        style={{
          backgroundImage:
            "linear-gradient(135deg,#eef2ff 0%,#e0e7ff 100%)",
        }}
      >
        {preset.chrome?.(colors)}
        <span
          className="relative z-10 text-sm font-semibold leading-none"
          style={{ color: colors.text, ...(preset.textStyle?.(colors) ?? {}) }}
        >
          Aa
        </span>
      </span>
      <span className={cn("text-[10px]", active ? "text-brand-700" : "text-ink-500")}>{label}</span>
    </button>
  );
}

