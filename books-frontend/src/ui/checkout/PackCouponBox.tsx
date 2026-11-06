"use client";

/**
 * The "have a code?" box on a Spark pack.
 *
 * A pack with no code is bought straight off its list price — the server prices
 * it the moment it is bought, by the same code that would have quoted it. Typing
 * a code is the one case where the buyer needs a price before paying, so only
 * then is a quote fetched: the server decides whether the code applies and what
 * it takes off, this box shows exactly that, and the parent hands the quote's id
 * to checkout so what is charged is that record.
 */
import { useEffect, useRef, useState } from "react";
import type { DigitalQuoteView } from "../../core/billing/printQuote";
import { fetchPackQuote } from "../../platform/payments";
import { QuoteCouponField } from "./QuoteCouponField";

export function PackCouponBox({
  packId,
  currency,
  resetKey = 0,
  onQuote,
  className,
}: {
  packId: string;
  currency: string;
  /** Bump to forget the applied code (e.g. its quote was refused as stale). */
  resetKey?: number;
  /** The quote carrying an applied code, or null when there is none. */
  onQuote: (quote: DigitalQuoteView | null) => void;
  className?: string;
}) {
  const [quote, setQuote] = useState<DigitalQuoteView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const onQuoteRef = useRef(onQuote);
  onQuoteRef.current = onQuote;
  const seq = useRef(0);

  const clear = () => {
    seq.current += 1;
    setQuote(null);
    setMessage(null);
    setPending(false);
    onQuoteRef.current(null);
  };

  // Forgetting the code when the parent says its quote is no good.
  useEffect(() => {
    if (resetKey > 0) clear();
  }, [resetKey]);

  const apply = async (code: string) => {
    const mine = ++seq.current;
    setPending(true);
    setMessage(null);
    try {
      const next = await fetchPackQuote({ packId, currency, couponCode: code });
      if (mine !== seq.current) return;
      const applied = next.discount?.code ? next : null;
      setQuote(applied);
      setMessage(next.couponRejection?.message ?? null);
      onQuoteRef.current(applied);
    } catch (err) {
      if (mine !== seq.current) return;
      setMessage(err instanceof Error ? err.message : "We couldn't check that code.");
      onQuoteRef.current(null);
    } finally {
      if (mine === seq.current) setPending(false);
    }
  };

  return (
    <QuoteCouponField
      className={className}
      applied={
        quote?.discount?.code
          ? {
              code: quote.discount.code,
              summary: quote.discount.summary,
              amountMinor: quote.discount.amountMinor,
              notes: quote.discount.notes,
            }
          : null
      }
      rejection={message}
      currency={currency}
      pending={pending}
      onApply={(code) => void apply(code)}
      onRemove={clear}
    />
  );
}
