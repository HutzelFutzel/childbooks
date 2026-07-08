import { useEffect, useState } from "react";
import { textFromParagraphs, wordParagraphs } from "../../core/design";
import type { TextBox } from "../../core/types";
import { ColorField } from "./ColorPicker";
import { ActionBar, Section } from "./inspectorKit";

/**
 * The text inspector — intentionally lean for the MVP. A text box exposes only
 * three things a user can change: its words, its size, and its color. Everything
 * else (fonts, alignment, presets, patterns, effects, per-word styling) is
 * deferred; the element-type registry in `design/elements.ts` is the seam for
 * reintroducing richer controls later without disturbing this surface.
 */
export function Inspector({
  box,
  pageWidthIn,
  pageHeightIn,
  onChange,
  onDelete,
  onDuplicate,
}: {
  box: TextBox | null;
  /** Real single-page trim, so font size can be shown in physical points. */
  pageWidthIn?: number;
  pageHeightIn?: number;
  onChange: (patch: Partial<TextBox>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  // Font size is stored as a fraction of page height; convert to/from real
  // points using the physical trim so "20 pt" means 20 pt on the printed page,
  // regardless of book size. Fall back to a common trim if not provided.
  const trimHeightIn = pageHeightIn && pageHeightIn > 0 ? pageHeightIn : 8.27;
  const ptPerPct = trimHeightIn * 72;
  const fmtIn = (n?: number) => (n ? Math.round(n * 10) / 10 : undefined);
  // Local draft for the text editor so the caret never jumps: we only resync
  // from the box when the *content* genuinely changes elsewhere (box switch,
  // undo/redo) — not after our own normalized keystrokes.
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
        Select a text box to edit it, or add one from the panel above.
      </div>
    );
  }

  const sizePt = Math.round(box.fontSizePct * ptPerPct);

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
          rows={4}
          className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm"
        />
        <p className="mt-1 text-[11px] text-ink-400">
          Tip: double-click the text on the page to edit it right there.
        </p>
      </Section>

      <Section title="Size">
        {fmtIn(pageWidthIn) && fmtIn(pageHeightIn) && (
          <p className="mb-2 text-[11px] text-ink-400">
            Page {fmtIn(pageWidthIn)}″ × {fmtIn(pageHeightIn)}″ — size shown in real points.
          </p>
        )}
        <label className="flex items-center gap-2 text-xs text-ink-500">
          <input
            type="range"
            min={6}
            max={120}
            step={1}
            value={sizePt}
            onChange={(e) => onChange({ fontSizePct: Number(e.target.value) / ptPerPct })}
            className="flex-1"
          />
          <span className="w-10 text-right tabular-nums text-ink-500">{sizePt}pt</span>
        </label>
      </Section>

      <Section title="Color">
        <ColorField label="Text color" value={box.color} onChange={(color) => onChange({ color })} />
      </Section>
    </div>
  );
}
