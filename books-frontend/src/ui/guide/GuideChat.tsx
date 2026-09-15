/**
 * The conversation.
 *
 * Two design decisions carry this surface, and both are about trust rather than
 * looks.
 *
 * **The guide speaks in the open; the reader speaks in a bubble.** The guide's lines
 * are unadorned text in the display face — the register of a book being read aloud,
 * which is what this product is — while the reader's own words get the enclosed,
 * tinted treatment. It reads as being *guided* rather than as querying a service,
 * and it keeps the reader's side visually scannable, which is what they scroll back
 * for.
 *
 * **Every turn that changes the book says so.** When a message moves a fact, the new
 * value appears under the reply as a receipt. This is the one piece of decoration
 * the surface allows itself, and it earns it: the failure mode of a conversational
 * form is a person stating an age, seeing a friendly acknowledgement, and having no
 * idea whether anything was recorded. A sentence saying "got it" is a claim; the
 * value itself is evidence. It is read from the book after the patch landed, not
 * from what the model said it did, so it cannot flatter.
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, Loader2, RotateCw } from "lucide-react";
import { GUIDE_SLOTS } from "../../core/guide/slots";
import type { GuideCursor } from "../../core/guide/engine";
import type { GuideMessage } from "../../core/guide/session";
import type {
  GuideChoiceOption,
  GuideConfirmAction,
  GuideWidget,
} from "../../core/guide/widgets";
import type { Project } from "../../core/types";
import { Button } from "../components/Button";
import { cn } from "../lib/cn";

export function GuideChat({
  project,
  messages,
  cursor,
  widget,
  sending,
  error,
  onSend,
  onChoose,
  onConfirm,
  onRetry,
  onSkip,
}: {
  project: Project;
  messages: GuideMessage[];
  cursor: GuideCursor | null;
  /** What the reader can do about the live question — see `core/guide/widgets.ts`. */
  widget: GuideWidget;
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onChoose: (option: GuideChoiceOption) => void;
  onConfirm: (action: GuideConfirmAction) => void;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastFailed = messages[messages.length - 1]?.failed === true;

  // Follow the conversation. `layout` rather than a plain effect so the jump
  // happens in the same frame the message paints and never reads as a scroll.
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);

  // Grow with the text instead of scrolling inside a two-line box. Capped, so a
  // pasted paragraph can't swallow the transcript above it.
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          {messages.map((message) =>
            message.role === "guide" ? (
              <GuideLine key={message.id} message={message} project={project} />
            ) : (
              <ReaderLine key={message.id} message={message} />
            ),
          )}

          <AnimatePresence>
            {sending && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-ink-400"
                aria-label="Reading your message"
              >
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="size-1.5 rounded-full bg-current"
                    animate={{ opacity: [0.25, 1, 0.25] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18 }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-ink-100 bg-white px-4 py-3">
        <div className="mx-auto max-w-xl">
          {/* The affordance for the live question, above the box rather than inside
              it: these are the answer, and the box is the way round them. */}
          {/* Height-capped and scrollable: an admin can configure a dozen art styles
              with a sentence of description each, and an uncapped option list would
              push the conversation off its own screen. */}
          {!sending && widget.kind === "choice" && (
            <div className="mb-2.5 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
              {widget.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  title={option.hint}
                  onClick={() => onChoose(option)}
                  className="max-w-full rounded-xl bg-brand-50 px-3 py-1.5 text-left ring-1 ring-inset ring-brand-200 transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <span className="block text-sm font-semibold text-brand-800">{option.label}</span>
                  {option.hint && (
                    <span className="block max-w-[14rem] truncate text-[11px] text-brand-700/70">
                      {option.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {!sending && widget.kind === "confirm" && (
            <div className="mb-2.5">
              <Button
                size="sm"
                leftIcon={<Check className="size-4" />}
                onClick={() => onConfirm(widget.action)}
              >
                {widget.affirm}
              </Button>
            </div>
          )}

          {!sending && widget.kind === "wait" && (
            <div className="mb-2.5 flex items-center gap-2 text-xs text-ink-500">
              <Loader2 className="size-3.5 animate-spin text-brand-400" />
              {widget.message}
            </div>
          )}

          {/* Errors state what happened and offer the one action that helps. The
              reader's words are still in the transcript, so this is a re-send and
              never a retype. */}
          {error && lastFailed && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2">
              <p className="text-xs text-red-700">{error}</p>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0 whitespace-nowrap"
                leftIcon={<RotateCw className="size-3.5" />}
                onClick={onRetry}
              >
                Send again
              </Button>
            </div>
          )}

          <div className="flex items-end gap-2 rounded-2xl bg-ink-50 p-1.5 ring-1 ring-inset ring-ink-200 focus-within:ring-2 focus-within:ring-brand-400">
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line. The composer is for
                // sentences, so the common key does the common thing.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={widget.placeholder}
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none"
            />
            <Button
              size="sm"
              aria-label="Send"
              className="size-9 shrink-0 !px-0"
              disabled={!draft.trim()}
              loading={sending}
              onClick={submit}
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>

          {/* Only offered where declining is real. A skip control on a question the
              book cannot be made without would be a button that argues back. */}
          {cursor?.component?.skippable && !sending && (
            <button
              type="button"
              onClick={onSkip}
              className="mt-2 text-xs font-medium text-ink-400 underline decoration-ink-200 underline-offset-2 transition-colors hover:text-ink-600"
            >
              Skip this — you choose
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GuideLine({ message, project }: { message: GuideMessage; project: Project }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-2"
    >
      <p className="font-display text-[15px] leading-relaxed text-ink-800">{message.text}</p>
      <FactReceipt message={message} project={project} />
    </motion.div>
  );
}

function ReaderLine({ message }: { message: GuideMessage }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex justify-end"
    >
      <p
        className={cn(
        "max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap",
        // `brand-100`, not `brand-50`: the pane sits on the cream canvas, and the
        // lighter tint is within a couple of values of it — the bubble disappeared,
        // taking the distinction between who said what with it.
        message.failed
          ? "bg-ink-100 text-ink-400 line-through decoration-ink-300"
          : "bg-brand-100 text-ink-800",
        )}
      >
        {message.text}
      </p>
    </motion.div>
  );
}

/**
 * The facts a turn changed, read from the book as it is now.
 *
 * Only rendered when something actually moved: `applied` comes from
 * `applyGuidePatch`, which reports nothing for a value restated unchanged. So a
 * reader who repeats themselves doesn't get a receipt for a change that didn't
 * happen, which would be exactly as misleading as no receipt at all.
 */
function FactReceipt({ message, project }: { message: GuideMessage; project: Project }) {
  const changed = (message.applied ?? [])
    .map((id) => ({ id, label: GUIDE_SLOTS[id].label, value: GUIDE_SLOTS[id].describe(project) }))
    .filter((fact): fact is { id: typeof fact.id; label: string; value: string } =>
      Boolean(fact.value),
    );
  if (changed.length === 0) return null;

  return (
    <motion.ul
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15 }}
      className="flex flex-col gap-1 border-l-2 border-brand-200 pl-3"
    >
      {changed.map((fact) => (
        <li key={fact.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold tracking-wide text-brand-700 uppercase">{fact.label}</span>
          <span className="text-ink-600">{fact.value}</span>
        </li>
      ))}
    </motion.ul>
  );
}

