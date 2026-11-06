"use client";

/**
 * "Have a code?" for the print-order dialog.
 *
 * Unlike {@link CouponField}, this one keeps no verdict of its own and works out
 * no discount. The code goes to the server as part of the QUOTE request; the
 * quote that comes back either carries the discount (shown here as the badge) or
 * says why the code didn't apply (shown here as the message). The price on screen
 * and the price charged are then the same record, which a box that validated
 * separately and subtracted on its own could never promise.
 *
 * Collapsed by default for the same reason as the other one: a visible empty
 * discount box sends people off hunting for codes.
 */
import { useState } from "react";
import { Loader2, Tag, X } from "lucide-react";
import { fromMinorUnits } from "../../core/billing/printQuote";
import { useAuthStore } from "../../state/authStore";

export function QuoteCouponField({
  applied,
  rejection,
  currency,
  pending,
  onApply,
  onRemove,
  className = "",
}: {
  /** What the current quote applied because of a code, or null. */
  applied: { code: string | null; summary: string; amountMinor: number; notes: string[] } | null;
  /** Why the last code didn't apply, from the quote. */
  rejection: string | null;
  currency: string;
  /** A quote is being fetched — the answer to what was just typed isn't in yet. */
  pending: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
  className?: string;
}) {
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  // Codes are per-account (caps, first-order-only, allowlists), so there's
  // nothing to offer a guest but a box that will refuse whatever they type.
  if (accessLevel !== "full") return null;

  const submit = () => {
    const code = input.trim();
    if (!code || pending) return;
    onApply(code);
    setInput("");
  };

  if (applied?.code) {
    return (
      <div
        className={`flex items-start gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800 ${className}`}
      >
        <Tag className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">{applied.summary}</span>
          <span className="block text-emerald-700/80">
            {money(fromMinorUnits(applied.amountMinor, currency), currency)} off with {applied.code}
          </span>
          {applied.notes.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-emerald-700/70">
              {applied.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove code"
          className="rounded p-0.5 text-emerald-700/70 transition hover:bg-emerald-100 hover:text-emerald-900"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  if (!open && !rejection) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-700 ${className}`}
      >
        Have a code?
      </button>
    );
  }

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Discount code"
          autoComplete="off"
          spellCheck={false}
          aria-label="Discount code"
          maxLength={40}
          className="h-10 min-w-0 flex-1 rounded-xl2 bg-white px-3 font-mono text-sm uppercase tracking-wide text-ink-800 ring-1 ring-inset ring-ink-200 transition focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!input.trim() || pending}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl2 bg-ink-900 px-3.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-40"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Apply
        </button>
      </div>
      {rejection && (
        <p role="status" className="text-xs text-rose-700">
          {rejection}
        </p>
      )}
    </div>
  );
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
