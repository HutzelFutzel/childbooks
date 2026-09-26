"use client";

/**
 * The composer. White field, a 1px ink ring, send as a small ink circle. The
 * context chip and the chat language sit inside the field on the left. The
 * placeholder is the live question.
 *
 * Violet is only the moment work is running: a 1px violet edge traces the ring
 * once, then rests there until the work is done. There is no typing-dot row.
 *
 * Send is never blocked. Enter on an empty field accepts the well's
 * recommended choice, so the cheapest path is one key.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, X } from "lucide-react";
import { enabledBookLanguages } from "../../../core/config/bookLanguages";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Popover } from "../../components/Popover";
import { cn } from "../../lib/cn";
import { traceDuration } from "../motion";
import { useGuideT } from "../intl";

export function Composer({
  value,
  onChange,
  onSend,
  onAcceptDefault,
  placeholder,
  chip,
  onClearChip,
  locale,
  onLocale,
  working,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  /** Enter on an empty field: the well's focused, cheap choice. */
  onAcceptDefault?: () => void;
  placeholder: string;
  chip: string | null;
  onClearChip: () => void;
  locale: string;
  onLocale: (locale: string) => void;
  working: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useGuideT("chrome");
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = () => {
    const text = value.trim();
    if (!text) {
      onAcceptDefault?.();
      return;
    }
    onSend(text);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative">
        <Trace active={working} />
        <div className="relative flex items-end gap-2 rounded-[1.1rem] bg-white py-2 pr-2 pl-3 ring-1 ring-ink-900/85 shadow-soft transition-shadow focus-within:shadow-lifted">
          <div className="flex shrink-0 items-center gap-1 self-center">
            <LanguageCode locale={locale} onLocale={onLocale} />
            <AnimatePresence initial={false}>
              {chip && (
                <motion.span
                  key={chip}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  className="inline-flex max-w-[9rem] items-center gap-1 rounded-full bg-ink-900 py-0.5 pr-1 pl-2.5 text-xs font-medium text-white"
                >
                  <span className="truncate">{chip}</span>
                  <button
                    type="button"
                    onClick={onClearChip}
                    aria-label={t("clearChip", { label: chip })}
                    className="flex size-4 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
                  >
                    <X className="size-3" />
                  </button>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <textarea
            ref={field}
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            aria-label={t("send")}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white transition",
              "hover:bg-ink-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2",
              !value.trim() && "bg-ink-900/80",
            )}
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

function LanguageCode({ locale, onLocale }: { locale: string; onLocale: (locale: string) => void }) {
  const t = useGuideT("chrome");
  const config = useAppConfigStore((s) => s.bookLanguages);
  const languages = enabledBookLanguages(config);
  if (languages.length <= 1) return null;
  return (
    <Popover
      side="top"
      align="start"
      panelClassName="w-56"
      trigger={
        <span
          role="button"
          tabIndex={0}
          aria-label={t("chatLanguage")}
          title={t("chatLanguage")}
          className="rounded-md px-1.5 py-1 font-mono text-[11px] tracking-tight text-ink-500 transition hover:bg-ink-50 hover:text-ink-800"
        >
          {locale}
        </span>
      }
    >
      {(close) => (
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label={t("chatLanguage")}>
          {languages.map((language) => (
            <li key={language.id}>
              <button
                type="button"
                role="option"
                aria-selected={language.id === locale}
                onClick={() => {
                  onLocale(language.id);
                  close();
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-ink-50",
                  language.id === locale ? "font-medium text-ink-900" : "text-ink-600",
                )}
              >
                <span>{language.endonym}</span>
                <span className="font-mono text-[11px] text-ink-400">{language.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

/** The violet edge: traces the ring once when work starts, then rests. */
function Trace({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const [runs, setRuns] = useState(0);
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current) setRuns((n) => n + 1);
    was.current = active;
  }, [active]);
  return (
    <AnimatePresence>
      {active && (
        <motion.svg
          key={runs}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
        >
          <motion.rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            rx="17.6"
            fill="none"
            stroke="var(--color-magic-500)"
            strokeWidth="1.5"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: traceDuration, ease: [0.45, 0, 0.2, 1] }}
          />
        </motion.svg>
      )}
    </AnimatePresence>
  );
}
