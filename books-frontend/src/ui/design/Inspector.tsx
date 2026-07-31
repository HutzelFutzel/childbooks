import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  MoveVertical,
  Search,
} from "lucide-react";
import { textFromParagraphs, wordParagraphs } from "../../core/design";
import type { ElementEffects, HAlign, TextBox, VAlign } from "../../core/types";
import type { ReadingModeId } from "../../core/config/ageWritingCatalog";
import { recommendFontSize } from "../../core/config/typography";
import { useAppConfigStore } from "../../state/appConfigStore";
import {
  CATEGORY_LABEL,
  FONTS,
  fontStack,
  getFont,
  loadFont,
  type FontCategory,
  type FontDef,
} from "../typography/fonts";
import { cn } from "../lib/cn";
import { ColorField } from "./ColorPicker";
import { parseColor } from "./color";
import { EffectsControls } from "./EffectsControls";
import { ActionBar, Section, SegGroup, Slider } from "./inspectorKit";
import { RecommendedSizeSlider } from "./RecommendedSizeSlider";
import { effectiveFontSizePct } from "./textFit";

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
  onCopyStyle,
  onPasteStyle,
  canPasteStyle,
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
  /** Copies this box's styling (font, colors, fill/stroke, effects, …) to a clipboard. */
  onCopyStyle: () => void;
  /** Applies a previously-copied box's styling onto this box. */
  onPasteStyle: () => void;
  /** Whether a style is currently on the clipboard, ready to paste. */
  canPasteStyle: boolean;
}) {
  const typography = useAppConfigStore((s) => s.typography);
  const trimHeightIn = pageHeightIn && pageHeightIn > 0 ? pageHeightIn : 8.27;
  const trimWidthIn = pageWidthIn && pageWidthIn > 0 ? pageWidthIn : trimHeightIn;
  const pageAspect = trimWidthIn / trimHeightIn;
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

  // Auto-fit shrinks (or, with autoFitGrow, also grows) the *rendered* font
  // relative to `fontSizePct` — the size the author last requested. The
  // Inspector must show the former: it's what's actually on the page right
  // now, and it's what should move live as the box is resized. `fontSizePct`
  // is kept around unclamped so the text can grow back if the box does.
  const requestedPt = Math.round(box.fontSizePct * ptPerPct);
  const sizePt = Math.round(effectiveFontSizePct(box, pageAspect) * ptPerPct);
  const autoFitAdjusted = !!box.autoFit && sizePt !== requestedPt;

  // A fill only counts as "a background" if it's actually visible — plenty of
  // presets default to a fully-transparent fill (e.g. "rgba(255,255,255,0)"),
  // which is invisible but not the literal string "rgba(0,0,0,0)", so this
  // checks alpha rather than doing an exact string match.
  const hasBg = box.fill !== undefined && parseColor(box.fill).a > 0;

  return (
    <div className="space-y-4 p-4">
      <ActionBar
        locked={box.locked}
        onCopyStyle={onCopyStyle}
        onPasteStyle={onPasteStyle}
        canPasteStyle={canPasteStyle}
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
              { id: "justify", node: <AlignJustify className="size-4" />, title: "Justify" },
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
            // This is the size the user is now asking for. If auto-fit is on
            // it stays on: the request sticks whenever it fits the box, and
            // keeps shrinking/growing with it after — it's never silently
            // turned off just because the size was touched once.
            onChange({ fontSizePct: pt / ptPerPct })
          }
        />
        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-ink-600">
          <input
            type="checkbox"
            checked={!!box.autoFit}
            onChange={(e) => {
              const autoFit = e.target.checked;
              // Auto-fit and auto-height solve the same problem (text vs. box
              // size) in opposite directions, so turning one on turns the
              // other off.
              onChange(autoFit ? { autoFit, autoHeight: false } : { autoFit, autoFitGrow: false });
            }}
          />
          Shrink text to fit the box
        </label>
        {autoFitAdjusted && (
          <p className="mt-1 text-[11px] leading-snug text-ink-400">
            {sizePt < requestedPt
              ? `Auto-shrunk to ${sizePt}pt to fit the box (requested ${requestedPt}pt — drag the box bigger to get it back).`
              : `Auto-grown to ${sizePt}pt to fill the box (requested ${requestedPt}pt).`}
          </p>
        )}
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

/**
 * A grouped font picker that renders every option in its own face, so you can
 * see what a font actually looks like before picking it (a native `<select>`
 * can't do this — options render in the OS's own popup with no per-item
 * styling). Faces are lazily fetched as soon as the panel opens.
 */
function FontField({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const current = getFont(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Preload every face up front — @fontsource woff2s at weight 400 are tiny,
    // and doing it eagerly means the whole list previews correctly right away
    // instead of faces popping in one by one as they scroll into view.
    for (const f of FONTS) loadFont(f.id);
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(font: FontDef) {
    loadFont(font.family);
    onChange(font.family);
    setOpen(false);
    setQuery("");
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? FONTS.filter((f) => f.label.toLowerCase().includes(q)) : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ fontFamily: fontStack(current?.family ?? value) }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-left text-sm text-ink-800 transition hover:border-brand-300"
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-400" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-72 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lifted">
          <div className="flex items-center gap-1.5 border-b border-ink-100 px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-ink-300" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fonts…"
              className="w-full text-xs text-ink-700 outline-none placeholder:text-ink-300"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered ? (
              filtered.length > 0 ? (
                <FontOptionList fonts={filtered} currentId={current?.id} onPick={pick} />
              ) : (
                <p className="px-2 py-4 text-center text-xs text-ink-400">No fonts match "{query}"</p>
              )
            ) : (
              FONT_CATEGORY_ORDER.map((cat) => (
                <div key={cat} className="mb-1 last:mb-0">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                    {CATEGORY_LABEL[cat]}
                  </div>
                  <FontOptionList
                    fonts={FONTS.filter((f) => f.category === cat)}
                    currentId={current?.id}
                    onPick={pick}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FontOptionList({
  fonts,
  currentId,
  onPick,
}: {
  fonts: FontDef[];
  currentId?: string;
  onPick: (font: FontDef) => void;
}) {
  return (
    <>
      {fonts.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onPick(f)}
          style={{ fontFamily: fontStack(f.family) }}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-base transition",
            f.id === currentId ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50",
          )}
        >
          <span className="truncate">{f.label}</span>
          {f.id === currentId && <Check className="size-3.5 shrink-0" />}
        </button>
      ))}
    </>
  );
}
