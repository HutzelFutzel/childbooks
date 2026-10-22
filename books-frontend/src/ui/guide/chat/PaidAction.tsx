"use client";

/**
 * The one coral button. It fetches its estimate as it appears and starts
 * exactly the batch that estimate covers, once. When the balance can't cover
 * it, the same place offers the smallest pack that does; the purchase comes
 * back to this book and the same estimate.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import type { GenerationQuote, GenerationQuoteUnit } from "../../../core/billing/generationQuote";
import { packTotalSparks } from "../../../core/config/sparks";
import { formatMoney } from "../../../core/i18n/format";
import { buySparkPack } from "../../../platform/payments";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAuthStore } from "../../../state/authStore";
import { notify } from "../../lib/notify";
import { holdKeptQuote, quoteKey, takeResumeDraw, useChatStudio } from "../../../state/chatStudio";
import { useProjectsStore } from "../../../state/projectsStore";
import { useSparksStore } from "../../../state/sparksStore";
import { cn } from "../../lib/cn";
import { useGuideLabel, useGuideT } from "../intl";

export function PaidAction({
  purpose,
  units,
  extraKey = "",
  label,
  start,
  onDefault,
}: {
  purpose: GenerationQuote["purpose"];
  units: GenerationQuoteUnit[];
  extraKey?: string;
  label: string;
  start: (quote: GenerationQuote) => Promise<boolean | void>;
  /** Registers what Enter on an empty field does while this is the well. */
  onDefault?: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("chrome");
  const key = useMemo(() => quoteKey(purpose, units, extraKey), [purpose, units, extraKey]);
  const slot = useChatStudio((s) => s.quotes[key]);
  const starting = useChatStudio((s) => s.starting === key);
  const ensureQuote = useChatStudio((s) => s.ensureQuote);
  const confirm = useChatStudio((s) => s.confirm);
  const balance = useSparksStore((s) => s.balance);
  const balanceLoading = useSparksStore((s) => s.loading);

  useEffect(() => {
    void ensureQuote(key, purpose, units);
    // `units` is folded into `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ensureQuote, purpose]);

  const quote = slot?.status === "ready" ? slot.quote : null;
  const short = quote && !balanceLoading && balance < quote.maximumSparks;
  const run = () => {
    if (quote && !short) void confirm(key, start);
  };

  useEffect(() => {
    onDefault?.(quote && !short ? run : null);
    return () => onDefault?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, short, onDefault]);

  // Back from buying the Sparks for exactly this: start it once they've landed.
  useEffect(() => {
    if (quote && !short && !balanceLoading && takeResumeDraw(quote.id)) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, short, balanceLoading]);

  if (short && quote) return <TopUp needed={quote.maximumSparks - balance} quote={quote} quoteSlot={key} />;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={!quote || starting}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-full bg-linear-to-b from-brand-400 to-brand-500 px-5 text-[15px] font-semibold text-white shadow-[0_4px_14px_-4px_rgba(249,106,77,0.5),inset_0_1px_0_rgba(255,255,255,0.28)] ring-1 ring-brand-600/80 transition",
          // No lift on hover: a button that moves out from under the pointer flickers at its edge.
          "hover:from-brand-500 hover:to-brand-600 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
          "disabled:cursor-default disabled:opacity-70",
        )}
      >
        {starting && <Loader2 className="size-4 animate-spin" />}
        {label}
      </button>
      <p className="flex items-center gap-1.5 text-xs text-ink-500">
        <Sparkles className="size-3 text-ink-400" aria-hidden />
        {slot?.status === "error" ? (
          <button type="button" onClick={() => void ensureQuote(key, purpose, units)} className="underline underline-offset-2">
            {t("estimateFailed")}
          </button>
        ) : quote ? (
          <span className="font-medium text-ink-800">{t("sparks", { sparks: quote.maximumSparks })}</span>
        ) : (
          <span>{t("estimating")}</span>
        )}
      </p>
    </div>
  );
}

/** Not enough Sparks: the smallest pack that covers this, bought in place. */
export function TopUp({ needed, quote, quoteSlot }: { needed: number; quote: GenerationQuote; quoteSlot: string }) {
  const label = useGuideLabel();
  const packs = useAppConfigStore((s) => s.sparks.packs);
  const currency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const projectId = useProjectsStore((s) => s.currentId);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const [busy, setBusy] = useState(false);
  const active = [...packs].filter((p) => p.active).sort((a, b) => packTotalSparks(a) - packTotalSparks(b));
  const pack = active.find((p) => packTotalSparks(p) >= needed) ?? active[active.length - 1];
  if (!pack) return null;
  const price = pack.prices[currency];
  const buy = async () => {
    setBusy(true);
    try {
      const { url, quoteExpiresAt } = await buySparkPack(pack.id, currency, undefined, projectId ?? undefined, quote.id);
      if (quoteExpiresAt) holdKeptQuote(quoteSlot, quote, quoteExpiresAt);
      window.location.href = url;
    } catch (err) {
      setBusy(false);
      notify.error(err, "Couldn't start checkout. Please try again.");
    }
  };
  // Guests can't buy Sparks: the way forward is an account, not a button that fails.
  if (accessLevel === "guest") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-start gap-1.5">
        <button
          type="button"
          onClick={() => openAuthDialog("drawBook")}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-500 px-5 text-[15px] font-semibold text-white shadow-soft transition hover:bg-brand-600 active:scale-[0.98]"
        >
          {label("createAccount")}
        </button>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={() => void buy()}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-500 px-5 text-[15px] font-semibold text-white shadow-soft transition hover:bg-brand-600 active:scale-[0.98] disabled:opacity-70"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {label("buyPack")}
        {typeof price === "number" && (
          <span className="font-normal text-white/85">· {formatMoney(navigator.language, price, currency)}</span>
        )}
      </button>
      <p className="text-xs text-ink-500">
        {pack.label} · {packTotalSparks(pack)} Sparks
      </p>
    </motion.div>
  );
}
