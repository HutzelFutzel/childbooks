"use client";

/**
 * "Have a code?" — the one place a customer types a coupon.
 *
 * Collapsed by default, and that's the important decision. A visible empty
 * discount box is a reason to abandon a checkout and go hunting for a code on a
 * voucher site; a link that says "have a code?" serves the person who has one
 * and doesn't advertise to the person who doesn't.
 *
 * Three further choices worth knowing about:
 *
 *   1. **Nothing is validated locally.** Not the format, not the length. The
 *      server is the only thing that knows whether a string is a code, and a
 *      client-side "that doesn't look like a code" is how a valid code gets
 *      rejected by a regex written before the batch prefixes existed.
 *   2. **The result is quoted in money.** A percentage against a subtotal the
 *      customer is still changing isn't checkable. The amount shown comes from
 *      the same evaluator that will price the order.
 *   3. **A subtotal change re-checks silently.** Codes are restricted by order
 *      value, so a code accepted on a three-copy order can stop qualifying on a
 *      one-copy order — and finding that out at the payment step is exactly the
 *      surprise this component exists to prevent. When it stops qualifying the
 *      reason is shown and the code is dropped, so the parent can't submit a
 *      checkout carrying a code the server would refuse.
 *
 * The accepted code is handed to the parent, which passes it into the checkout
 * request. It is NOT applied here: applying happens inside the checkout
 * transaction, where it's re-validated and reserved atomically.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Tag, X } from "lucide-react";
import { checkCouponCode, type CouponCheck } from "../../platform/coupons";
import { useAuthStore } from "../../state/authStore";

export function CouponField({
  itemType,
  subtotal,
  currency,
  productId,
  country,
  onChange,
  className = "",
}: {
  itemType: "print" | "ebook" | "pack" | "plan";
  /** The subtotal on screen, in `currency`. */
  subtotal: number;
  currency: string;
  productId?: string;
  country?: string;
  /** The accepted code, or null. The parent sends it with the checkout request. */
  onChange: (code: string | null) => void;
  className?: string;
}) {
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<CouponCheck | null>(null);

  // The accepted code, kept out of state-derived render logic so the re-check
  // effect below doesn't need `verdict` in its dependency list (which would
  // make it re-run on its own result).
  const accepted = verdict?.ok ? verdict.code : null;
  const acceptedRef = useRef<string | null>(null);
  acceptedRef.current = accepted;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Re-check an accepted code whenever the order changes underneath it.
  useEffect(() => {
    const code = acceptedRef.current;
    if (!code) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void checkCouponCode({ code, itemType, subtotal, currency, productId, country }).then(
        (next) => {
          if (cancelled) return;
          setVerdict(next);
          onChangeRef.current(next.ok ? next.code : null);
        },
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [itemType, subtotal, currency, productId, country]);

  // Codes are per-account (caps, first-order-only, allowlists), so there's
  // nothing to offer a guest but a box that will refuse whatever they type.
  if (accessLevel !== "full") return null;

  const submit = async () => {
    const code = input.trim();
    if (!code || checking) return;
    setChecking(true);
    try {
      const next = await checkCouponCode({
        code,
        itemType,
        subtotal,
        currency,
        productId,
        country,
      });
      setVerdict(next);
      onChange(next.ok ? next.code : null);
      if (next.ok) setInput("");
    } finally {
      setChecking(false);
    }
  };

  const clear = () => {
    setVerdict(null);
    setInput("");
    onChange(null);
  };

  if (verdict?.ok) {
    return (
      <div
        className={`flex items-start gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800 ${className}`}
      >
        <Tag className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">{verdict.summary}</span>
          <span className="block text-emerald-700/80">
            {money(verdict.discountAmount, currency)} off
            {verdict.code ? ` with ${verdict.code}` : ""} — applied when you pay.
          </span>
          {verdict.notes.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-emerald-700/70">
              {verdict.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={clear}
          aria-label="Remove code"
          className="rounded p-0.5 text-emerald-700/70 transition hover:bg-emerald-100 hover:text-emerald-900"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  if (!open) {
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
              void submit();
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
          onClick={() => void submit()}
          disabled={!input.trim() || checking}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl2 bg-ink-900 px-3.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-40"
        >
          {checking && <Loader2 className="size-3.5 animate-spin" />}
          Apply
        </button>
      </div>
      {verdict && !verdict.ok && (
        <p role="status" className="text-xs text-rose-700">
          {verdict.message}
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
