"use client";

/**
 * The composer. White field, a 1px ink ring, send as a small ink circle. The
 * context chip sits inside the field on the left. The
 * placeholder is the live question.
 *
 * Violet is only the moment work is running: a 1px violet edge traces the ring
 * once, then rests there until the work is done. There is no typing-dot row.
 *
 * Typing is never blocked, but a message is held while a turn is being
 * answered (`sending`): the store would drop it, so the draft stays in the
 * field and the send button says so. Enter on an empty field accepts the well's
 * recommended choice, so the cheapest path is one key.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2, PenLine, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useGuideT } from "../intl";

export function Composer({
  value,
  onChange,
  onSend,
  onAcceptDefault,
  placeholder,
  chip,
  chipTone = "pinned",
  onClearChip,
  context = null,
  quote = null,
  onClearQuote,
  tools,
  mentions,
  focusSignal = 0,
  sending = false,
  quiet = false,
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
  /**
   * `pinned`: the reader selected it (dark, can be cleared). `typed`: the pages the message names, shown
   * as they type. `following`: the pages in view, which a message with no other aim is about.
   */
  chipTone?: "pinned" | "typed" | "following";
  onClearChip: () => void;
  /**
   * What the open tab is about ("Story"), when the reader has not aimed at
   * something else. Shown as a quiet outline chip that cannot be cleared: it
   * is where the words go, not a choice.
   */
  context?: string | null;
  /**
   * The passage the reader marked in the story. It replaces the context chip
   * and, unlike it, can be cleared: the message is about exactly this text.
   */
  quote?: string | null;
  onClearQuote?: () => void;
  /** Small buttons beside send, such as the ideas menu. */
  tools?: ReactNode;
  /** What "@" can name: pages of the finished book. `text` is what goes into the message. */
  mentions?: readonly { id: string; label: string; text: string }[];
  /** Bumped by the book pane to move the cursor here. */
  focusSignal?: number;
  /** Keep prop optional for compatibility; composer ring no longer locks in violet during background work. */
  working?: boolean;
  /**
   * A turn is being answered. The field stays editable, so the next message
   * can be written, but it is held rather than sent into a turn that would drop it.
   */
  sending?: boolean;
  /** A card is open above: the field steps back until it is focused. */
  quiet?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useGuideT("chrome");
  const field = useRef<HTMLTextAreaElement>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // "@" after a space (or at the start) opens the page list; what follows filters it.
  const token = mentions && mentions.length > 0 ? /(^|\s)@([\p{L}\d]*)$/u.exec(value) : null;
  const options =
    token && dismissed !== value
      ? mentions!.filter((m) => m.label.toLowerCase().includes(token[2]!.toLowerCase())).slice(0, 8)
      : [];
  const pickMention = (option: { text: string }) => {
    if (!token) return;
    onChange(`${value.slice(0, token.index + token[1]!.length)}${option.text} `);
    setMenuIndex(0);
    field.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (focusSignal > 0) field.current?.focus({ preventScroll: true });
  }, [focusSignal]);

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
    if (sending) return;
    onSend(text);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative">
        {options.length > 0 && (
          <ul
            role="listbox"
            aria-label={t("mentionLabel")}
            className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-56 overflow-y-auto rounded-xl bg-white p-1 shadow-lifted ring-1 ring-ink-200"
          >
            {options.map((option, index) => (
              <li key={option.id} role="option" aria-selected={index === menuIndex}>
                <button
                  type="button"
                  // Keep the field focused: a blur would close the list before the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickMention(option)}
                  className={cn(
                    "flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm transition",
                    index === menuIndex ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50",
                  )}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div
          className={cn(
            "relative flex items-end gap-2 rounded-[1.2rem] bg-white py-2 pr-2 pl-3.5 shadow-[0_8px_24px_-8px_rgba(20,22,58,0.12),0_1px_2px_rgba(20,22,58,0.06)] ring-1 transition-all focus-within:shadow-[0_14px_32px_-10px_rgba(20,22,58,0.18),0_1px_3px_rgba(20,22,58,0.08)]",
            quiet ? "ring-ink-900/25 focus-within:ring-ink-900/80" : "ring-ink-900/75",
          )}
        >
          <div className="flex shrink-0 items-center gap-1 self-center">
            <AnimatePresence initial={false}>
              {chip && (
                <motion.span
                  key={chip}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    "inline-flex max-w-[9rem] items-center gap-1 rounded-full py-0.5 text-xs font-medium",
                    chipTone === "pinned"
                      ? "bg-ink-900 pr-1 pl-2.5 text-white"
                      : chipTone === "typed"
                        ? "bg-ink-900/85 px-2.5 text-white"
                        : "border border-ink-200 bg-white px-2.5 text-ink-600",
                  )}
                >
                  <span className="truncate">{chip}</span>
                  {chipTone === "pinned" && (
                    <button
                      type="button"
                      onClick={onClearChip}
                      aria-label={t("clearChip", { label: chip })}
                      className="flex size-4 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </motion.span>
              )}
              {!chip && quote && (
                <motion.span
                  key={`quote:${quote}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  title={quote}
                  className="inline-flex max-w-[11rem] items-center gap-1 rounded-full bg-magic-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-magic-700 ring-1 ring-magic-300"
                >
                  <PenLine className="size-3 shrink-0" aria-hidden />
                  <span className="truncate font-serif">“{quote}”</span>
                  {onClearQuote && (
                    <button
                      type="button"
                      onClick={onClearQuote}
                      aria-label={t("clearMark")}
                      className="flex size-4 shrink-0 items-center justify-center rounded-full text-magic-600 transition hover:bg-magic-100 hover:text-magic-800"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </motion.span>
              )}
              {!chip && !quote && context && (
                <motion.span
                  key={`context:${context}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  className="inline-flex max-w-[9rem] items-center gap-1 rounded-full bg-magic-50 px-2.5 py-0.5 text-xs font-medium text-magic-700 ring-1 ring-magic-200"
                >
                  <PenLine className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{context}</span>
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
              if (options.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setMenuIndex((i) => (i + step + options.length) % options.length);
                  return;
                }
                if ((event.key === "Enter" || event.key === "Tab") && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  pickMention(options[Math.min(menuIndex, options.length - 1)]!);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDismissed(value);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          {tools && <div className="flex shrink-0 items-center self-end">{tools}</div>}
          <button
            type="button"
            onClick={submit}
            aria-label={sending ? t("sendingPlaceholder") : t("send")}
            title={sending ? t("sendingPlaceholder") : t("send")}
            aria-disabled={sending ? true : undefined}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white transition",
              "hover:bg-ink-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2",
              !value.trim() && !sending && "bg-ink-900/80",
              sending && "cursor-wait bg-ink-900/65",
            )}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
