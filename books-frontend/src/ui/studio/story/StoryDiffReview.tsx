"use client";

import { useMemo } from "react";
import {
  Check,
  CheckCheck,
  CircleAlert,
  FilePenLine,
  Minus,
  Plus,
  Undo2,
  X,
} from "lucide-react";
import type {
  StoryRevisionDecision,
  StoryRevisionJob,
  StoryReviewChange,
} from "../../../core/story/revision";
import { buildStoryMergePlan } from "../../../core/story/revision";
import { Button } from "../../components/Button";
import { cn } from "../../lib/cn";

export function StoryDiffReview({
  revision,
  currentStory,
  onDecide,
}: {
  revision: StoryRevisionJob;
  currentStory: string;
  onDecide: (id: string, decision: StoryRevisionDecision) => Promise<void>;
}) {
  const proposal = revision.proposal;
  const plan = useMemo(
    () =>
      proposal
        ? buildStoryMergePlan(revision.baseStory, currentStory, proposal)
        : null,
    [currentStory, proposal, revision.baseStory],
  );
  if (!proposal) return null;

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-7 sm:py-5">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[10.5px] font-semibold">
          <Legend className="bg-emerald-50 text-emerald-700 ring-emerald-200" icon={<Plus className="size-3" />}>
            Added
          </Legend>
          <Legend className="bg-sky-50 text-sky-700 ring-sky-200" icon={<FilePenLine className="size-3" />}>
            Updated
          </Legend>
          <Legend className="bg-rose-50 text-rose-700 ring-rose-200" icon={<Minus className="size-3" />}>
            Deleted
          </Legend>
          {plan?.hasLocalEdits && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-violet-700 ring-1 ring-violet-200">
              Your newer edits are preserved
            </span>
          )}
        </div>

        {plan && plan.conflictCount > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <p>
              You and the AI edited {plan.conflictCount === 1 ? "the same passage" : `${plan.conflictCount} of the same passages`}.
              Choose which version to keep where marked.
            </p>
          </div>
        )}

        <div className="rounded-2xl bg-white px-4 py-5 shadow-2xs ring-1 ring-ink-100 sm:px-7">
          <div className="whitespace-pre-wrap font-serif text-[15px] leading-[1.9] text-ink-800 sm:text-[16px]">
            {plan?.segments.map((segment, index) =>
              segment.type === "unchanged" ? (
                <span key={`text-${index}`}>{segment.text}</span>
              ) : segment.type === "author" ? (
                <span
                  key={`author-${index}`}
                  title="Your edit made while the suggestion was being prepared"
                  className="rounded-sm bg-violet-100/80 text-violet-950 ring-1 ring-violet-200/70"
                >
                  {segment.text}
                </span>
              ) : (
                <InlineChange
                  key={`${segment.change.id}-${index}`}
                  change={segment.change}
                  index={plan.changes.findIndex((item) => item.id === segment.change.id)}
                  total={plan.changes.length}
                  decision={revision.decisions?.[segment.change.id]}
                  detached={segment.detached}
                  onDecide={onDecide}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({
  className,
  icon,
  children,
}: {
  className: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 ring-1", className)}>
      {icon}
      {children}
    </span>
  );
}

function InlineChange({
  change,
  index,
  total,
  decision,
  detached,
  onDecide,
}: {
  change: StoryReviewChange;
  index: number;
  total: number;
  decision?: StoryRevisionDecision;
  detached?: boolean;
  onDecide: (id: string, decision: StoryRevisionDecision) => Promise<void>;
}) {
  const display = splitChangeContext(change.currentText, change.suggestedText);
  const displayKind =
    !display.before && display.after
      ? "add"
      : display.before && !display.after
        ? "delete"
        : "update";
  const label =
    displayKind === "add" ? "Added" : displayKind === "delete" ? "Deleted" : "Updated";
  const colors =
    displayKind === "add"
      ? "border-emerald-300 bg-emerald-50/55"
      : displayKind === "delete"
        ? "border-rose-300 bg-rose-50/55"
        : "border-sky-300 bg-sky-50/45";

  return (
    <>
      {display.prefix && <span>{display.prefix}</span>}
      <span
        id={`story-change-${change.id}`}
        className={cn(
          "my-3 block overflow-hidden rounded-xl border-l-4 text-left font-sans shadow-2xs ring-1 ring-ink-100",
          colors,
          decision === "accepted" && "ring-2 ring-emerald-300",
          decision === "rejected" && "opacity-65 grayscale-[0.25]",
        )}
      >
        <span className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-3 py-2">
          <span className="inline-flex rounded-full bg-white/80 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-ink-600 ring-1 ring-black/5">
            {label} · {index + 1}/{total}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void onDecide(change.id, "rejected")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10.5px] font-bold transition",
                decision === "rejected"
                  ? "bg-ink-700 text-white"
                  : "bg-white/90 text-ink-600 ring-1 ring-ink-200 hover:bg-rose-50 hover:text-rose-700",
              )}
            >
              <X className="size-3" />
              {change.conflict ? "Keep mine" : "Discard"}
            </button>
            <button
              type="button"
              onClick={() => void onDecide(change.id, "accepted")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10.5px] font-bold transition",
                decision === "accepted"
                  ? "bg-emerald-600 text-white"
                  : "bg-white/90 text-ink-600 ring-1 ring-ink-200 hover:bg-emerald-50 hover:text-emerald-700",
              )}
            >
              <Check className="size-3" />
              {change.conflict ? "Use suggestion" : "Keep"}
            </button>
          </span>
        </span>

        {detached && (
          <span className="block bg-amber-50 px-3 py-1.5 text-[10.5px] font-semibold text-amber-700">
            This suggestion overlaps another marked passage.
          </span>
        )}

        {change.conflict ? (
          <span className="grid divide-y divide-amber-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <DiffPane label="Your latest text" className="bg-violet-50/70 text-violet-950">
              {display.before || "Passage removed by you"}
            </DiffPane>
            <DiffPane label="AI suggestion" className="bg-emerald-50/70 text-ink-800">
              {display.after || "Remove this passage"}
            </DiffPane>
          </span>
        ) : displayKind === "add" ? (
          <span className="block px-3 py-3 font-serif text-[14px] leading-7 text-emerald-950">
            {display.after}
          </span>
        ) : displayKind === "delete" ? (
          <span className="block bg-rose-50/70 px-3 py-3 font-serif text-[14px] leading-7 text-ink-700 line-through decoration-rose-500/70">
            {display.before}
          </span>
        ) : (
          <span className="grid divide-y divide-sky-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <DiffPane label="Current" className="bg-rose-50/60 text-ink-700 line-through decoration-rose-500/70">
              {display.before}
            </DiffPane>
            <DiffPane label="Suggested" className="bg-emerald-50/60 text-ink-800">
              {display.after}
            </DiffPane>
          </span>
        )}
      </span>
      {display.suffix && <span>{display.suffix}</span>}
    </>
  );
}

function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[\p{L}\p{N}]/u.test(value));
}

/**
 * Keep shared context in the normal manuscript and put only the changed core
 * inside the colored review box. Boundaries are expanded to whole words.
 */
function splitChangeContext(before: string, after: string) {
  let prefixLength = 0;
  while (
    prefixLength < before.length &&
    prefixLength < after.length &&
    before[prefixLength] === after[prefixLength]
  ) {
    prefixLength += 1;
  }
  if (prefixLength < before.length && prefixLength < after.length) {
    while (
      prefixLength > 0 &&
      isWordCharacter(before[prefixLength - 1]) &&
      (isWordCharacter(before[prefixLength]) ||
        isWordCharacter(after[prefixLength]))
    ) {
      prefixLength -= 1;
    }
  }

  let suffixLength = 0;
  while (
    suffixLength < before.length - prefixLength &&
    suffixLength < after.length - prefixLength &&
    before[before.length - suffixLength - 1] ===
      after[after.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }
  while (suffixLength > 0) {
    const beforeStart = before.length - suffixLength;
    const afterStart = after.length - suffixLength;
    if (
      !isWordCharacter(before[beforeStart]) ||
      (!isWordCharacter(before[beforeStart - 1]) &&
        !isWordCharacter(after[afterStart - 1]))
    ) {
      break;
    }
    suffixLength -= 1;
  }

  const suffix = suffixLength > 0 ? before.slice(-suffixLength) : "";
  return {
    prefix: before.slice(0, prefixLength),
    before: before
      .slice(prefixLength, before.length - suffixLength)
      .trim(),
    after: after
      .slice(prefixLength, after.length - suffixLength)
      .trim(),
    suffix,
  };
}

function DiffPane({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("block px-3 py-3", className)}>
      <span className="mb-1 block font-sans text-[9.5px] font-extrabold uppercase tracking-[0.12em] opacity-65">
        {label}
      </span>
      <span className="block whitespace-pre-wrap font-serif text-[14px] leading-7">{children}</span>
    </span>
  );
}

export function StoryDiffActions({
  revision,
  currentStory,
  saving,
  onKeepAll,
  onKeepSelected,
  onDiscardAll,
}: {
  revision: StoryRevisionJob;
  currentStory: string;
  saving: boolean;
  onKeepAll: () => void;
  onKeepSelected: () => void;
  onDiscardAll: () => void;
}) {
  const changes = revision.proposal?.changes ?? [];
  const accepted = changes.filter(
    (change) => revision.decisions?.[change.id] === "accepted",
  ).length;
  const decided = changes.filter((change) => revision.decisions?.[change.id]).length;
  const plan = revision.proposal
    ? buildStoryMergePlan(revision.baseStory, currentStory, revision.proposal)
    : null;
  const unresolvedConflicts =
    plan?.changes.filter(
      (change) => change.conflict && !revision.decisions?.[change.id],
    ).length ?? 0;

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-medium text-ink-500">
        {decided} of {changes.length} reviewed
      </span>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={saving}
          leftIcon={<Undo2 className="size-3.5" />}
          onClick={onDiscardAll}
          className="h-8 text-xs"
        >
          Discard all
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={saving || accepted === 0}
          leftIcon={<Check className="size-3.5" />}
          onClick={onKeepSelected}
          className="h-8 text-xs"
        >
          Keep selected ({accepted})
        </Button>
        <Button
          size="sm"
          variant="magic"
          loading={saving}
          disabled={saving || unresolvedConflicts > 0}
          leftIcon={<CheckCheck className="size-3.5" />}
          onClick={onKeepAll}
          className="h-8 text-xs"
        >
          {unresolvedConflicts > 0
            ? `Resolve ${unresolvedConflicts} conflict${unresolvedConflicts === 1 ? "" : "s"}`
            : "Keep all"}
        </Button>
      </div>
    </div>
  );
}
