import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloatingBarPortal } from "./FloatingBarPortal";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Blend,
  Bold,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Italic,
  Minus,
  MoreHorizontal,
  MoveVertical,
  Paintbrush,
  Plus,
  Search,
  Square,
  Trash2,
  Underline,
} from "lucide-react";
import type { HAlign, TextBox, VAlign } from "../../core/types";
import type { ReadingModeId } from "../../core/config/ageWritingCatalog";
import { recommendFontSize, type FontSizeRec } from "../../core/config/typography";
import { useAppConfigStore } from "../../state/appConfigStore";
import {
  CATEGORY_LABEL,
  FONT_CATEGORY_ORDER,
  FONTS,
  fontStack,
  getFont,
  loadFont,
  type FontDef,
} from "../typography/fonts";
import { cn } from "../lib/cn";
import { parseColor, toHex } from "./color";
import { effectiveBackdropBlur } from "./effects";
import { effectiveFontSizePct } from "./textFit";
import { useStudioPanelStore } from "../studio/studioPanelStore";
import type { TextEditSection } from "./TextEditPanel";
import type { FloatingBarPlacement } from "./floatingBarPlacement";
import { PortalToolbarFlyout } from "./toolbarFlyout";

export type TextStyleKey = "bold" | "italic" | "underline";

/** Optional box-level chrome for the Canva-style whole-box toolbar. */
export type TextBoxToolbarChrome = {
  box: TextBox;
  /** Physical trim of one page (for pt conversion + age recommendations). */
  pageWidthIn: number;
  pageHeightIn: number;
  /**
   * Stage surface aspect (width/height) the box rect is normalized against —
   * equals the single-page aspect normally, or ~2× for a facing-page stage.
   */
  surfaceAspect: number;
  ageRangeId?: string;
  readingModeId?: ReadingModeId | null;
  onPatch: (patch: Partial<TextBox>, opts?: { coalesce?: string }) => void;
  /** Close a coalesced undo gesture (after a slider drag). */
  onGestureEnd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onCopyStyle: () => void;
  onPasteStyle: () => void;
  canPasteStyle: boolean;
};

/**
 * Slim Canva-style floating toolbar: everyday type controls on the row;
 * Effects / Background / style / duplicate live under More.
 */
export function TextStyleBar({
  placement,
  bold,
  italic,
  underline,
  color,
  onToggle,
  onColor,
  chrome,
}: {
  placement: FloatingBarPlacement;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color?: string;
  onToggle: (key: TextStyleKey) => void;
  onColor: (c: string) => void;
  chrome?: TextBoxToolbarChrome;
}) {
  return (
    <FloatingBarPortal
      placement={placement}
      data-text-style-bar
      // Keep the caret / box selection alive when a control is clicked.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-0.5 rounded-xl border border-ink-200 bg-white/95 p-1 shadow-lifted backdrop-blur">
        {chrome && (
          <>
            <FontField
              value={chrome.box.fontFamily}
              onChange={(fontFamily) => chrome.onPatch({ fontFamily })}
            />
            <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
            <SizeStepper chrome={chrome} />
            <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
            <AlignMenu
              value={chrome.box.align}
              onChange={(align) => chrome.onPatch({ align })}
            />
            <VAlignMenu
              value={chrome.box.vAlign}
              onChange={(vAlign) => chrome.onPatch({ vAlign })}
            />
            <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
          </>
        )}

        <Toggle label="Bold" active={bold} onClick={() => onToggle("bold")}>
          <Bold className="size-4" />
        </Toggle>
        <Toggle label="Italic" active={italic} onClick={() => onToggle("italic")}>
          <Italic className="size-4" />
        </Toggle>
        <Toggle label="Underline" active={underline} onClick={() => onToggle("underline")}>
          <Underline className="size-4" />
        </Toggle>

        <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />

        <TextColorChip color={color} onColor={onColor} />

        {chrome && (
          <>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
            <MoreMenu chrome={chrome} />
            <Toggle label="Delete" active={false} onClick={chrome.onDelete}>
              <Trash2 className="size-4" />
            </Toggle>
          </>
        )}
      </div>
    </FloatingBarPortal>
  );
}

/** Overflow menu: Effects / Background (docked panel) + style / duplicate. */
function MoreMenu({ chrome }: { chrome: TextBoxToolbarChrome }) {
  const textEditSection = useStudioPanelStore((s) => s.textEditSection);
  const toggleTextEdit = useStudioPanelStore((s) => s.toggleTextEdit);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const hasBg =
    (chrome.box.fill !== undefined && parseColor(chrome.box.fill).a > 0) ||
    effectiveBackdropBlur(chrome.box) > 0;
  const hasEffects = !!chrome.box.effects?.shadow;

  const openPanel = (section: TextEditSection) => {
    toggleTextEdit(section);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Toggle
        label="More"
        active={open || textEditSection !== null || hasEffects || hasBg}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="size-4" />
      </Toggle>
      <PortalToolbarFlyout
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={rootRef}
        align="end"
        className="min-w-44 overflow-hidden py-1"
      >
        <MenuItem
          icon={<Blend className="size-4" />}
          label="Effects"
          active={textEditSection === "effects" || hasEffects}
          onClick={() => openPanel("effects")}
        />
        <MenuItem
          icon={
            <Square
              className="size-4"
              style={hasBg ? { fill: chrome.box.fill, color: chrome.box.fill } : undefined}
            />
          }
          label="Background"
          active={textEditSection === "background" || hasBg}
          onClick={() => openPanel("background")}
        />
        <div className="my-1 border-t border-ink-100" />
        <MenuItem
          icon={<Paintbrush className="size-4" />}
          label="Copy style"
          onClick={() => {
            chrome.onCopyStyle();
            setOpen(false);
          }}
        />
        <MenuItem
          icon={<ClipboardPaste className="size-4" />}
          label="Paste style"
          disabled={!chrome.canPasteStyle}
          onClick={() => {
            chrome.onPasteStyle();
            setOpen(false);
          }}
        />
        <MenuItem
          icon={<Copy className="size-4" />}
          label="Duplicate"
          onClick={() => {
            chrome.onDuplicate();
            setOpen(false);
          }}
        />
      </PortalToolbarFlyout>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={disabled && label === "Paste style" ? "Copy a text box's style first" : label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition",
        disabled && "pointer-events-none opacity-40",
        active
          ? "bg-brand-50 font-medium text-brand-700"
          : "text-ink-700 hover:bg-ink-50",
      )}
    >
      <span className="text-ink-500">{icon}</span>
      {label}
    </button>
  );
}

/**
 * Native OS colour picker. React's `onChange` fires on every drag sample (it
 * listens to the DOM `input` event), so we keep a local draft for the chip and
 * only commit via the native `change` event when the picker is dismissed.
 */
function TextColorChip({
  color,
  onColor,
}: {
  color?: string;
  onColor: (c: string) => void;
}) {
  const committed = toHex(parseColor(color ?? "#1f2937"));
  const [draft, setDraft] = useState(committed);
  const inputRef = useRef<HTMLInputElement>(null);
  const onColorRef = useRef(onColor);
  onColorRef.current = onColor;
  const picking = useRef(false);

  useEffect(() => {
    if (!picking.current) setDraft(committed);
  }, [committed]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onNativeChange = () => {
      picking.current = false;
      const v = el.value;
      setDraft(v);
      onColorRef.current(v);
    };
    el.addEventListener("change", onNativeChange);
    return () => el.removeEventListener("change", onNativeChange);
  }, []);

  return (
    <label
      title="Text colour"
      className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-ink-200 transition hover:border-brand-300"
    >
      <span
        className="size-4 rounded-full ring-1 ring-inset ring-black/15"
        style={{ background: draft }}
      />
      <input
        ref={inputRef}
        type="color"
        value={draft}
        onInput={(e) => {
          picking.current = true;
          setDraft(e.currentTarget.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

function SizeStepper({ chrome }: { chrome: TextBoxToolbarChrome }) {
  const typography = useAppConfigStore((s) => s.typography);
  const { box, pageWidthIn, pageHeightIn, surfaceAspect, ageRangeId, readingModeId, onPatch } =
    chrome;
  const trimH = pageHeightIn > 0 ? pageHeightIn : 8.27;
  const ptPerPct = trimH * 72;
  const sizePt = Math.round(effectiveFontSizePct(box, surfaceAspect) * ptPerPct);
  const boxWidthIn = box.rect.w * surfaceAspect * trimH;

  const rec: FontSizeRec | null =
    ageRangeId && pageHeightIn && pageWidthIn
      ? recommendFontSize({
          ageRangeId,
          readingModeId,
          trim: { widthIn: pageWidthIn, heightIn: pageHeightIn },
          boxWidthIn,
          config: typography,
        })
      : null;

  const setPt = (pt: number) => onPatch({ fontSizePct: Math.max(6, pt) / ptPerPct });

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Toggle label="Smaller" active={false} onClick={() => setPt(sizePt - 1)}>
        <Minus className="size-3.5" />
      </Toggle>
      <button
        type="button"
        title={rec ? `Recommended ${rec.minPt}–${rec.maxPt}pt` : "Font size"}
        onClick={() => rec && setPt(rec.idealPt)}
        className={cn(
          "min-w-9 rounded-lg px-1 py-1 text-center text-xs font-semibold tabular-nums transition",
          rec && sizePt < rec.floorPt
            ? "text-amber-600 hover:bg-amber-50"
            : rec && sizePt >= rec.minPt && sizePt <= rec.maxPt
              ? "text-brand-700 hover:bg-brand-50"
              : "text-ink-700 hover:bg-ink-100",
        )}
      >
        {sizePt}
      </button>
      <Toggle label="Larger" active={false} onClick={() => setPt(sizePt + 1)}>
        <Plus className="size-3.5" />
      </Toggle>
    </div>
  );
}

/** Single align button + menu — saves three toolbar slots vs a full segment. */
function AlignMenu({
  value,
  onChange,
}: {
  value: HAlign;
  onChange: (a: HAlign) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const opts: { id: HAlign; icon: React.ReactNode; title: string }[] = [
    { id: "left", icon: <AlignLeft className="size-4" />, title: "Align left" },
    { id: "center", icon: <AlignCenter className="size-4" />, title: "Align centre" },
    { id: "right", icon: <AlignRight className="size-4" />, title: "Align right" },
    { id: "justify", icon: <AlignJustify className="size-4" />, title: "Justify" },
  ];
  const current = opts.find((o) => o.id === value) ?? opts[0];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Toggle label={current.title} active={open} onClick={() => setOpen((o) => !o)}>
        {current.icon}
      </Toggle>
      <PortalToolbarFlyout
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={rootRef}
        className="flex gap-0.5 p-1"
      >
        {opts.map((o) => (
          <Toggle
            key={o.id}
            label={o.title}
            active={value === o.id}
            onClick={() => {
              onChange(o.id);
              setOpen(false);
            }}
          >
            {o.icon}
          </Toggle>
        ))}
      </PortalToolbarFlyout>
    </div>
  );
}

/** Vertical align — sits beside horizontal align on the bar. */
function VAlignMenu({
  value,
  onChange,
}: {
  value: VAlign;
  onChange: (a: VAlign) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const opts: { id: VAlign; icon: React.ReactNode; title: string }[] = [
    { id: "top", icon: <ArrowUpToLine className="size-4" />, title: "Align top" },
    { id: "center", icon: <MoveVertical className="size-4" />, title: "Align middle" },
    { id: "bottom", icon: <ArrowDownToLine className="size-4" />, title: "Align bottom" },
  ];
  const current = opts.find((o) => o.id === value) ?? opts[1];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Toggle label={current.title} active={open} onClick={() => setOpen((o) => !o)}>
        {current.icon}
      </Toggle>
      <PortalToolbarFlyout
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={rootRef}
        className="flex gap-0.5 p-1"
      >
        {opts.map((o) => (
          <Toggle
            key={o.id}
            label={o.title}
            active={value === o.id}
            onClick={() => {
              onChange(o.id);
              setOpen(false);
            }}
          >
            {o.icon}
          </Toggle>
        ))}
      </PortalToolbarFlyout>
    </div>
  );
}

/**
 * Grouped font picker with live face previews. The menu is portaled so
 * mousedown-preventDefault on the bar doesn't break search focus.
 */
function FontField({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const current = getFont(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value) loadFont(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    for (const f of FONTS) loadFont(f.id);
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 288) });
    };
    place();
    requestAnimationFrame(() => searchRef.current?.focus());
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
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
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ fontFamily: fontStack(current?.family ?? value) }}
        className="flex h-7 max-w-28 shrink-0 items-center justify-between gap-1 rounded-lg border border-ink-200 bg-white px-2 text-left text-xs text-ink-800 transition hover:border-brand-300"
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className="size-3.5 shrink-0 text-ink-400" />
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-100 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lifted"
            style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
            onMouseDown={(e) => e.stopPropagation()}
          >
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
                  <p className="px-2 py-4 text-center text-xs text-ink-400">
                    No fonts match &ldquo;{query}&rdquo;
                  </p>
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
          </div>,
          document.body,
        )}
    </>
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

function Toggle({
  children,
  active,
  onClick,
  label,
  disabled,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg border transition",
        disabled && "pointer-events-none opacity-40",
        active
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : "border-transparent text-ink-600 hover:bg-ink-100 hover:text-brand-600",
      )}
    >
      {children}
    </button>
  );
}
