"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Loader2, MoreHorizontal } from "lucide-react";
import { Field, Input } from "../../../components/Input";
import { InfoHint } from "../../../components/InfoHint";
import { Popover } from "../../../components/Popover";
import { cn } from "../../../lib/cn";

/** Read a picked file as bare base64 (no data-URL prefix), for upload bodies. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** A labeled group of related fields. Spacing and a heading, not a nested card. */
export function Section({
  title,
  hint,
  help,
  action,
  children,
}: {
  title: string;
  hint?: string;
  help?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
            {help ? (
              <InfoHint title={title}>{help}</InfoHint>
            ) : null}
          </div>
          {hint && <p className="text-sm text-ink-500">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EditorTabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 border-b border-ink-100">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "-mb-px border-b-2 pb-2 text-sm transition-colors",
            value === item.id
              ? "border-ink-900 font-medium text-ink-900"
              : "border-transparent text-ink-500 hover:text-ink-800",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Cross-links to related pages. The page header already states what this
 * screen is; this only answers "where else?".
 */
export function TabIntro({
  children: _children,
  elsewhere: _elsewhere,
  links,
}: {
  children?: ReactNode;
  elsewhere?: ReactNode;
  links?: { label: string; onClick: () => void }[];
}) {
  if (!links?.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500">
      {links.map((l) => (
        <button
          key={l.label}
          type="button"
          onClick={l.onClick}
          className="hover:text-ink-800 hover:underline"
        >
          {l.label}
        </button>
      ))}
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
export function Disclosure({
  label = "Advanced options",
  defaultOpen = false,
  children,
}: {
  label?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
  hint,
}: {
  label: string;
  value: number;
  step?: string;
  min?: number;
  onChange: (n: number) => void;
  className?: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <Field label={label} className={className} hint={hint}>
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

/** Overflow (`⋯`) for rare catalog / market jobs. Confirm dialogs carry the risk copy. */
export function OverflowMenu({
  children,
}: {
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  return (
    <Popover
      align="end"
      panelClassName="w-72 rounded-xl p-1"
      trigger={
        <span className="inline-flex size-9 items-center justify-center rounded-xl text-ink-600 hover:bg-ink-100">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">More actions</span>
        </span>
      }
    >
      {(close) => (
        <div className="flex flex-col py-0.5">
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </Popover>
  );
}

export function OverflowItem({
  label,
  disabledReason,
  busy,
  onSelect,
}: {
  label: string;
  disabledReason?: string | null;
  busy?: boolean;
  onSelect: () => void;
}) {
  const disabled = Boolean(disabledReason) || busy;
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabledReason ?? undefined}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
    >
      {busy ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : null}
      <span>{label}</span>
    </button>
  );
}
