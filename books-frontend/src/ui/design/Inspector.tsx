import { useEffect, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  MoveVertical,
} from "lucide-react";
import { textFromParagraphs, wordParagraphs } from "../../core/design";
import type { ElementEffects, HAlign, TextBox, VAlign } from "../../core/types";
import type { ReadingModeId } from "../../core/config/ageWritingCatalog";
import { recommendFontSize } from "../../core/config/typography";
import { useAppConfigStore } from "../../state/appConfigStore";
import { CATEGORY_LABEL, FONTS, fontStack, getFont, loadFont, type FontCategory } from "../typography/fonts";
import { ColorField } from "./ColorPicker";
import { EffectsControls } from "./EffectsControls";
import { ActionBar, Section, SegGroup, Slider } from "./inspectorKit";
import { RecommendedSizeSlider } from "./RecommendedSizeSlider";

/**
 * The text inspector owns box *structure*: words, alignment, size, spacing,
 * background and drop-shadow/opacity effects. Character styling (bold/italic/
 * underline + colour) lives in the floating toolbar that appears over the text
 * itself, so there is a single, selection-aware place to style characters —
 * whole-box when the box is selected, per-word while editing in place.
 */
export function Inspector({
  box,
  pageWidthIn,
  pageHeightIn,
  ageRangeId,
  readingModeId,
  onChange,
  onDelete,
  onDuplicate,
}: {
  box: TextBox | null;
  /** Real single-page trim, so font size can be shown in physical points. */
  pageWidthIn?: number;
  pageHeightIn?: number;
  /** Reader age band + reading mode, to recommend an age-appropriate size range. */
  ageRangeId?: string;
  readingModeId?: ReadingModeId | null;
  onChange: (patch: Partial<TextBox>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const typography = useAppConfigStore((s) => s.typography);
  const trimHeightIn = pageHeightIn && pageHeightIn > 0 ? pageHeightIn : 8.27;
  const ptPerPct = trimHeightIn * 72;
  const fmtIn = (n?: number) => (n ? Math.round(n * 10) / 10 : undefined);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (!box) return;
    const external = textFromParagraphs(box.paragraphs);
    if (external !== textFromParagraphs(wordParagraphs(draft))) setDraft(external);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.id, box?.paragraphs]);

  // Load the box's current face so the selector previews it in that font.
  useEffect(() => {
    if (box?.fontFamily) loadFont(box.fontFamily);
  }, [box?.fontFamily]);

  if (!box) {
    return (
      <div className="p-4 text-sm text-ink-400">
        Select a text box to edit it, or add one from the panel above.
      </div>
    );
  }

  const sizePt = Math.round(box.fontSizePct * ptPerPct);

  const hasBg = box.fill !== undefined && box.fill !== "rgba(0,0,0,0)";

  return (
    <div className="space-y-4 p-4">
      <ActionBar
        locked={box.locked}
        onDuplicate={onDuplicate}
        onToggleLock={() => onChange({ locked: !box.locked })}
        onDelete={onDelete}
      />

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
          To change <span className="font-medium text-ink-500">colour, bold, italic or underline</span>,
          use the toolbar that floats above the text — it styles the whole box, or just the words you
          select when you double-click to edit.
        </p>
      </Section>

      <Section title="Font">
        <FontField value={box.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} />
      </Section>

      <Section title="Alignment">
        <div className="flex flex-wrap items-center gap-2">
          <SegGroup<HAlign>
            value={box.align}
            onChange={(align) => onChange({ align })}
            options={[
              { id: "left", node: <AlignLeft className="size-4" />, title: "Align left" },
              { id: "center", node: <AlignCenter className="size-4" />, title: "Align centre" },
              { id: "right", node: <AlignRight className="size-4" />, title: "Align right" },
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

      <Section title="Size">
        {fmtIn(pageWidthIn) && fmtIn(pageHeightIn) && (
          <p className="mb-2 text-[11px] text-ink-400">
            Page {fmtIn(pageWidthIn)}″ × {fmtIn(pageHeightIn)}″ — size shown in real points.
          </p>
        )}
        <RecommendedSizeSlider
          sizePt={sizePt}
          rec={
            ageRangeId && pageHeightIn && pageWidthIn
              ? recommendFontSize({
                  ageRangeId,
                  readingModeId,
                  trim: { widthIn: pageWidthIn, heightIn: pageHeightIn },
                  boxWidthIn: box.rect.w * pageWidthIn,
                  config: typography,
                })
              : null
          }
          onChange={(pt) =>
            // Manually setting a size is authoritative: turn off auto-fit so the
            // chosen size actually sticks (auto-fit would otherwise clamp it).
            onChange({ fontSizePct: pt / ptPerPct, autoFit: false, autoFitGrow: false })
          }
        />
      </Section>

      <Section title="Spacing">
        <Slider
          label="Padding"
          min={0}
          max={0.3}
          step={0.01}
          value={box.padding ?? 0.08}
          onChange={(padding) => onChange({ padding })}
        />
      </Section>

      <Section title="Background" collapsible defaultOpen={hasBg}>
        <label className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-600">
          <input
            type="checkbox"
            checked={hasBg}
            onChange={(e) => onChange({ fill: e.target.checked ? "rgba(255,255,255,1)" : "rgba(0,0,0,0)" })}
          />
          Show a background behind the text
        </label>
        {hasBg && (
          <div className="space-y-2">
            <ColorField label="Fill (colour & transparency)" value={box.fill!} onChange={(fill) => onChange({ fill })} />
          </div>
        )}
      </Section>

      <Section title="Effects" collapsible defaultOpen={!!box.effects}>
        <p className="mb-2 text-[11px] leading-snug text-ink-400">
          "Blur" softens the whole box (a frosted look); Opacity fades it; a drop
          shadow lifts it off the page.
        </p>
        <EffectsControls
          effects={box.effects}
          showOpacity
          onChange={(effects: ElementEffects | undefined) => onChange({ effects })}
        />
      </Section>
    </div>
  );
}

const FONT_CATEGORY_ORDER: FontCategory[] = ["rounded", "sans", "serif", "hand"];

/** A grouped font picker that previews the chosen face inline. */
function FontField({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const current = getFont(value);
  return (
    <select
      value={current?.id ?? ""}
      onChange={(e) => {
        const font = getFont(e.target.value);
        if (!font) return;
        loadFont(font.family);
        onChange(font.family);
      }}
      style={{ fontFamily: fontStack(current?.family ?? value) }}
      className="w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-800"
    >
      {FONT_CATEGORY_ORDER.map((cat) => (
        <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
          {FONTS.filter((f) => f.category === cat).map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
