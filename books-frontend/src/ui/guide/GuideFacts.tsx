/**
 * What the book knows, always on screen.
 *
 * The problem this solves is specific to conversational interfaces: everything the
 * reader has told us is *behind* them, in a transcript they have to scroll. Ten
 * messages in, "what did I say the ages were?" becomes a scrolling exercise, and the
 * usual answer — asking the assistant to recap — is a worse interface than a label.
 *
 * So the settled facts are pinned. It's a summary, never an input: each chip reads
 * straight out of `GUIDE_SLOTS[].describe`, which is the same function the engine's
 * satisfaction predicates are written against, so a chip cannot claim something the
 * flow disagrees with. Editing happens by saying so — that is the whole premise of
 * the flow — which is why these are text and not fields.
 *
 * Which facts appear is `coveredGuideSlots`' decision, and the reasoning for it is
 * worth reading before adding a chip here: nearly every field in a book config has a
 * working default, so a strip of "everything with a value" would introduce itself to
 * a brand-new reader by telling them their layout and trim size.
 */
"use client";

import { GUIDE_SLOTS, type GuideSlotId } from "../../core/guide/slots";
import type { Project } from "../../core/types";
import { cn } from "../lib/cn";

export function GuideFacts({
  project,
  slots,
  onOpen,
  className,
}: {
  project: Project;
  /** The facts the conversation has reached — see `coveredGuideSlots`. */
  slots: readonly GuideSlotId[];
  /** Open the surface that owns a fact, so a chip is a way back to it. */
  onOpen?: (slot: GuideSlotId) => void;
  className?: string;
}) {
  const known = slots
    .map((id) => ({ id, label: GUIDE_SLOTS[id].label, value: GUIDE_SLOTS[id].describe(project) }))
    .filter((fact): fact is { id: GuideSlotId; label: string; value: string } => Boolean(fact.value));

  // Nothing settled yet. An empty rail of placeholder chips would only advertise
  // how much is left to do, which is the opposite of what this pane is for.
  if (known.length === 0) return null;

  return (
    <div
      className={cn("flex flex-wrap gap-1.5", className)}
      aria-label="What we know about your book"
    >
      {known.map((fact) => (
        <button
          key={fact.id}
          type="button"
          disabled={!onOpen}
          onClick={() => onOpen?.(fact.id)}
          // Still a summary, not a field: the chip opens the surface that owns the
          // fact rather than editing it in place. Changing it is something you say.
          title={onOpen ? `Show ${fact.label.toLowerCase()}` : undefined}
          className={cn(
            "inline-flex max-w-full items-baseline gap-1.5 rounded-lg bg-white px-2 py-1 text-left ring-1 ring-inset ring-ink-200",
            onOpen &&
              "transition-colors hover:ring-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
          )}
        >
          <span className="shrink-0 text-[10px] font-semibold tracking-wide text-ink-400 uppercase">
            {fact.label}
          </span>
          <span className="truncate text-xs font-medium text-ink-800">{fact.value}</span>
        </button>
      ))}
    </div>
  );
}
