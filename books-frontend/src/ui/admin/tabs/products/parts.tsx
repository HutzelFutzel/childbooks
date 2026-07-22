"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Field, Input } from "../../../components/Input";

/** A labeled group of related fields, matching the Model-costs editor styling. */
export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2.5 rounded-lg bg-ink-50/50 p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</div>
          {hint && <p className="text-[11px] leading-relaxed text-ink-400">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * A consistent, plain-language header for a whole admin tab. Explains in one or
 * two sentences WHAT lives here, and — crucially for reducing "where is that
 * setting?" confusion — what deliberately lives ELSEWHERE (`elsewhere`), with
 * optional cross-link buttons the caller wires to the nav store.
 */
export function TabIntro({
  children,
  elsewhere,
  links,
}: {
  children: ReactNode;
  elsewhere?: ReactNode;
  links?: { label: string; onClick: () => void }[];
}) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-brand-100 bg-brand-50/50 px-3.5 py-3">
      <Info className="mt-0.5 size-4 shrink-0 text-brand-500" />
      <div className="space-y-1.5 text-xs leading-relaxed text-ink-600">
        <p>{children}</p>
        {elsewhere && <p className="text-ink-400">{elsewhere}</p>}
        {links && links.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {links.map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={l.onClick}
                className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-50"
              >
                {l.label} →
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A prominent "why this matters" callout for a single high-impact setting —
 * used inside a Section to spell out the business consequence of a value in
 * plain language (e.g. "0 here means the ebook is free for these members").
 */
export function ImpactNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
      {children}
    </p>
  );
}

export function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Responsive field grid so inputs align in columns instead of wrapping raggedly. */
export function Grid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const map = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };
  return <div className={`grid grid-cols-1 gap-3 ${map[cols]}`}>{children}</div>;
}

/** Collapsible "Advanced options" block — rare fields stay out of the way. */
export function Disclosure({ label = "Advanced options", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg ring-1 ring-inset ring-ink-100">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500 hover:text-ink-700"
      >
        <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      {open && <div className="space-y-3 border-t border-ink-100 p-3">{children}</div>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  step = "1",
  min = 0,
  onChange,
  className = "w-full",
  suffix,
}: {
  label: string;
  value: number;
  step?: string;
  min?: number;
  onChange: (n: number) => void;
  className?: string;
  suffix?: string;
}) {
  return (
    <Field label={label} className={className}>
      <div className="relative">
        <Input
          type="number"
          min={min}
          step={step}
          value={String(value)}
          onChange={(e) => onChange(num(e.target.value))}
          className={suffix ? "pr-10" : undefined}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

export function TextField({
  label,
  value,
  placeholder,
  onChange,
  className = "w-full",
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Format a number as currency for display (best-effort; falls back to a plain string). */
export function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
