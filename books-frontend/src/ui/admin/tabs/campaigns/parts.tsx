"use client";

/**
 * Small shared pieces for the Campaigns tab. Nothing here knows anything about
 * campaigns — they're the two controls the tab needs that the component library
 * doesn't have: a labelled switch, and a multi-select that reads as a sentence
 * rather than a list box.
 */
import type { ReactNode } from "react";
import { Toggle } from "../../../components/Toggle";
import { useReadOnly } from "../../../components/ReadOnlyContext";

/**
 * A switch with the visible label + one-line explanation the bare `Toggle`
 * doesn't render (its `label` is the accessible name only). Every switch on this
 * tab changes money or who can earn it, so none of them ship unlabelled.
 */
export function SwitchField({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink-700">{label}</div>
        {hint && <p className="text-[11px] leading-relaxed text-ink-400">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * A toggle-chip multi-select.
 *
 * `allowEmpty` distinguishes the two very different meanings an empty list can
 * carry. For a scope ("which actions does this cover?") empty means EVERYTHING,
 * which is a legitimate and common choice. For a target ("which items can this
 * discount be used on?") empty means NOTHING, i.e. a rule that can never fire —
 * so those lists refuse to empty and say why instead.
 */
export function Chips({
  options,
  selected,
  onChange,
  allowEmpty = false,
  emptyHint,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  allowEmpty?: boolean;
  emptyHint?: string;
}) {
  const readOnly = useReadOnly();
  const toggle = (value: string) => {
    if (readOnly) return;
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
    if (next.length === 0 && !allowEmpty) return;
    onChange(next);
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.includes(option.value);
          if (readOnly && !on) return null; // read-only: show only what's selected
          return (
            <button
              key={option.value}
              type="button"
              disabled={readOnly}
              onClick={() => toggle(option.value)}
              className={
                on
                  ? "rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-semibold text-brand-800"
                  : "rounded-full bg-white px-2.5 py-0.5 text-[11px] text-ink-500 ring-1 ring-inset ring-ink-200 transition hover:text-ink-700 disabled:cursor-default"
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-[11px] text-ink-400">{emptyHint ?? "Nothing selected — this covers everything."}</p>
      )}
    </div>
  );
}

/** One headline number, matching the referral tab's impact cards. */
export function StatCard({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-ink-100">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="text-base font-semibold text-ink-800">{value}</div>
      {note && <div className="text-[11px] text-ink-400">{note}</div>}
    </div>
  );
}

/** A date/time field that reads and writes ms-epoch, with 0 meaning "open". */
export function DateField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  // `datetime-local` wants a local-time string with no zone; the round trip is
  // through the Date constructor so the admin's own clock is what they see.
  const toInput = (ms: number): string => {
    if (!ms) return "";
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const readOnly = useReadOnly();
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-sm font-medium text-ink-700">{label}</label>
      {readOnly ? (
        <div className="flex h-11 items-center rounded-xl2 bg-ink-50 px-3.5 text-sm text-ink-700">
          {value ? new Date(value).toLocaleString() : "Open (no date set)"}
        </div>
      ) : (
        <input
          type="datetime-local"
          value={toInput(value)}
          onChange={(e) => {
            const parsed = e.target.value ? new Date(e.target.value).getTime() : 0;
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
          className="h-11 w-full rounded-xl2 bg-white pl-3.5 pr-3 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 transition focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
      )}
      {hint && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
