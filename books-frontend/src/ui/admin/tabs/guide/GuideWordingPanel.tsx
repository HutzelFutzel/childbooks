"use client";

/**
 * The Chat's wording, with a live preview of each line as the reader sees it.
 *
 * Lines are what the guide says; in another chat language the model phrases
 * the meaning written here. Labels are the trusted controls; an override here
 * applies in English, and other languages read the localization catalogue.
 */
import { useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import {
  DEFAULT_GUIDE_COPY,
  fillGuideCopy,
  GUIDE_COPY_HELP,
  GUIDE_LABEL_KEYS,
  GUIDE_LINE_KEYS,
  type GuideCopyKey,
  type GuideCopyOverrides,
} from "../../../../core/guide/copy";
import { Textarea } from "../../../components/Input";
import { cn } from "../../../lib/cn";

/** Interpreter free text is the model's reply, not configured wording. */
const HIDDEN: ReadonlySet<GuideCopyKey> = new Set(["reply"]);

const SAMPLE = {
  names: ["Maya", "Leo"],
  n: 3,
  sparks: "40",
  price: "$24",
  count: 24,
  shape: "square",
  min: 24,
  language: "Deutsch",
};

function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function GuideWordingPanel({
  wording,
  onChange,
  readOnly,
}: {
  wording: GuideCopyOverrides;
  onChange: (next: GuideCopyOverrides) => void;
  readOnly: boolean;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"lines" | "labels">("lines");
  const keys = useMemo(() => {
    const all = (kind === "lines" ? GUIDE_LINE_KEYS : GUIDE_LABEL_KEYS).filter((k) => !HIDDEN.has(k));
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (key) =>
        key.toLowerCase().includes(q) ||
        (wording[key] ?? DEFAULT_GUIDE_COPY[key]).toLowerCase().includes(q),
    );
  }, [kind, query, wording]);

  const set = (key: GuideCopyKey, value: string) => {
    const next = { ...wording };
    if (!value.trim() || value.trim() === DEFAULT_GUIDE_COPY[key]) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const edited = Object.keys(wording).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-full bg-ink-100/70 p-0.5 text-xs font-medium">
          {(["lines", "labels"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              className={cn(
                "rounded-full px-3 py-1.5 transition",
                kind === option ? "bg-white text-ink-900 shadow-soft" : "text-ink-500 hover:text-ink-800",
              )}
            >
              {option === "lines" ? "What the guide says" : "Buttons and labels"}
            </button>
          ))}
        </div>
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search wording"
            className="h-9 w-full rounded-full bg-white pr-3 pl-8 text-sm ring-1 ring-ink-100 placeholder:text-ink-400 focus:outline-none focus:ring-ink-300"
          />
        </label>
        {edited > 0 && !readOnly && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-800"
          >
            <RotateCcw className="size-3.5" />
            Reset {edited} edited
          </button>
        )}
      </div>

      <div className="space-y-2">
        {keys.map((key) => {
          const value = wording[key] ?? "";
          const text = fillGuideCopy(value.trim() || DEFAULT_GUIDE_COPY[key], SAMPLE);
          return (
            <div
              key={key}
              className="grid gap-3 rounded-xl bg-white p-3.5 ring-1 ring-ink-100 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-ink-900">{humanize(key)}</span>
                  {wording[key] && <span className="text-[10px] font-semibold uppercase text-brand-600">edited</span>}
                </div>
                {GUIDE_COPY_HELP[key] && <p className="text-[11px] text-ink-500">{GUIDE_COPY_HELP[key]}</p>}
                <Textarea
                  value={value}
                  placeholder={DEFAULT_GUIDE_COPY[key]}
                  disabled={readOnly}
                  rows={kind === "lines" ? 2 : 1}
                  maxLength={400}
                  onChange={(e) => set(key, e.target.value)}
                  className="text-sm"
                />
              </div>
              <Preview kind={kind} text={text} />
            </div>
          );
        })}
        {keys.length === 0 && <p className="py-8 text-center text-sm text-ink-400">No wording matches.</p>}
      </div>
      <p className="text-[11px] text-ink-400">
        Placeholders: {"{names}"}, {"{n}"}, {"{sparks}"}, {"{price}"}, {"{count}"}, {"{shape}"}, {"{min}"},{" "}
        {"{language}"}. The preview fills them with sample values.
      </p>
    </div>
  );
}

function Preview({ kind, text }: { kind: "lines" | "labels"; text: string }) {
  return (
    <div className="flex min-h-16 items-center rounded-lg bg-canvas px-4 py-3 ring-1 ring-ink-900/5">
      {kind === "lines" ? (
        <p className="font-display text-[14px] leading-relaxed text-ink-900 [text-wrap:pretty]">{text}</p>
      ) : (
        <span className="inline-flex min-h-9 items-center rounded-full bg-white px-4 text-sm font-medium text-ink-900 shadow-soft ring-1 ring-ink-200">
          {text}
        </span>
      )}
    </div>
  );
}
