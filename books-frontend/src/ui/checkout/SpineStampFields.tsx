"use client";

import { RotateCcw } from "lucide-react";
import { Field, Input } from "../components/Input";
import { FOIL_STAMP_MAX_CHARS, foilStampReport } from "../../core/fulfillment/lulu/foilStamp";

export interface SpineLines {
  title: string;
  author: string;
}

/**
 * The words foil-stamped on a linen book's spine. They start as the book's own
 * title and author and the customer can change them; the preview underneath is
 * exactly what is sent to the printer, so nothing about the spine is a surprise
 * when the book arrives. Clearing both gives a plain spine.
 */
export function SpineStampFields({
  value,
  defaults,
  foilLabel,
  onChange,
}: {
  value: SpineLines;
  defaults: SpineLines;
  foilLabel: string;
  onChange: (next: SpineLines) => void;
}) {
  const report = foilStampReport(value);
  const edited = value.title !== defaults.title || value.author !== defaults.author;
  const over = report.length > FOIL_STAMP_MAX_CHARS;
  const notes: string[] = [];
  if (report.removedCharacters) {
    notes.push("Only Latin letters, numbers and simple punctuation can be stamped — the rest is left out.");
  }
  if (report.titleShortened) notes.push("The title is too long for the spine and is shortened.");
  if (report.authorDropped) notes.push("There's no room for the author beside this title, so only the title is stamped.");

  return (
    <div className="space-y-3 rounded-xl border border-ink-100 bg-ink-50/50 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-ink-800">Spine stamp</p>
          <p className="text-[11px] leading-relaxed text-ink-500">
            Stamped in {foilLabel.toLowerCase()} foil down the spine. Up to {FOIL_STAMP_MAX_CHARS} characters for
            both lines together.
          </p>
        </div>
        {edited && (
          <button
            type="button"
            onClick={() => onChange(defaults)}
            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline"
          >
            <RotateCcw className="size-3" /> Use book title
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Title" htmlFor="spine-title">
          <Input
            id="spine-title"
            value={value.title}
            maxLength={80}
            placeholder="Book title"
            aria-describedby="spine-preview"
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        </Field>
        <Field label="Author" htmlFor="spine-author">
          <Input
            id="spine-author"
            value={value.author}
            maxLength={60}
            placeholder="Optional"
            aria-describedby="spine-preview"
            onChange={(e) => onChange({ ...value, author: e.target.value })}
          />
        </Field>
      </div>
      <div id="spine-preview" aria-live="polite" className="space-y-1 text-[11px] leading-relaxed">
        <p className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 text-ink-700">
            {report.stamp ? (
              <>
                Will read: <span className="font-semibold">“{[report.stamp.title, report.stamp.author].filter(Boolean).join(" · ")}”</span>
              </>
            ) : value.title.trim() || value.author.trim() ? (
              "None of this can be stamped, so the spine will be plain."
            ) : (
              "Plain spine — nothing stamped."
            )}
          </span>
          <span className={over ? "shrink-0 font-medium text-amber-700" : "shrink-0 text-ink-400"}>
            {Math.min(report.length, 999)} / {FOIL_STAMP_MAX_CHARS}
          </span>
        </p>
        {notes.map((n) => (
          <p key={n} className="text-amber-700">
            {n}
          </p>
        ))}
      </div>
    </div>
  );
}