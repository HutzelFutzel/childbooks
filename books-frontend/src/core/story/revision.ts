import { z } from "zod";
import { diffChars } from "diff";
import type { BookConfig } from "../types";

export type StoryRevisionStatus =
  | "pending"
  | "running"
  | "ready"
  | "error"
  | "applied"
  | "discarded";

export type StoryRevisionDecision = "accepted" | "rejected";

export interface StoryRevisionSelection {
  start: number;
  end: number;
  text: string;
}

export interface StoryRevisionChange {
  id: string;
  before: string;
  after: string;
  reason: string;
  /** Immutable coordinates in `baseStory`; optional for older persisted jobs. */
  baseStart?: number;
  baseEnd?: number;
}

export interface StoryRevisionProposal {
  summary: string;
  changes: StoryRevisionChange[];
}

export interface StoryRevisionJob {
  projectId: string;
  config: BookConfig;
  baseStory: string;
  baseHash: string;
  instruction: string;
  selection?: StoryRevisionSelection;
  status: StoryRevisionStatus;
  proposal?: StoryRevisionProposal;
  decisions?: Record<string, StoryRevisionDecision>;
  /** Snapshot of each conflict shown when its decision was made. */
  decisionContexts?: Record<string, string>;
  resultHash?: string;
  quotedSparks?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  claimedUntil?: number;
}

export const storyRevisionModelSchema = z.object({
  // Length limits are normalized after parsing. Gemini's response-schema
  // subset cannot express maxLength/maxItems, so enforcing those here makes a
  // semantically valid answer fail before the revision pipeline can repair it.
  summary: z.string().optional().default("Prepared the requested story changes."),
  changes: z
    .array(
      z.object({
        before: z.string(),
        after: z.string(),
        reason: z.string().optional().default("Requested story change"),
      }),
    )
    .min(1),
});

export type StoryRevisionModelResult = z.infer<typeof storyRevisionModelSchema>;

export type StoryRevisionChangeKind = "add" | "delete" | "update";

export interface StoryReviewChange extends StoryRevisionChange {
  kind: StoryRevisionChangeKind;
  baseStart: number;
  baseEnd: number;
  currentStart: number;
  currentEnd: number;
  currentText: string;
  /** Text used when accepting; spans the full conflict region when necessary. */
  suggestedText: string;
  conflict: boolean;
}

export type StoryReviewSegment =
  | { type: "unchanged"; text: string }
  | { type: "author"; text: string }
  | { type: "change"; change: StoryReviewChange; detached?: boolean };

export interface StoryMergePlan {
  changes: StoryReviewChange[];
  segments: StoryReviewSegment[];
  hasLocalEdits: boolean;
  conflictCount: number;
}

/** Small deterministic fingerprint used for optimistic conflict detection. */
export function storyTextHash(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    out.push(at);
    from = at + 1;
  }
  return out;
}

/**
 * Validate model-authored replacements against the immutable base manuscript.
 * Every `before` must identify one unique, non-overlapping span. That makes it
 * mechanically impossible for the model to alter text it did not name.
 */
export function validateStoryRevision(
  baseStory: string,
  result: StoryRevisionModelResult,
  selection?: StoryRevisionSelection,
): StoryRevisionProposal {
  if (result.changes.length > 40) {
    throw new Error("The editor proposed too many separate changes.");
  }
  const occupied: Array<{ start: number; end: number }> = [];
  const changes: StoryRevisionChange[] = [];

  for (const [index, raw] of result.changes.entries()) {
    if (raw.before === raw.after) continue;
    if (!raw.before) {
      throw new Error("An insertion did not include an exact manuscript anchor.");
    }
    const hits = occurrences(baseStory, raw.before);
    if (hits.length !== 1) {
      throw new Error(
        hits.length === 0
          ? "A proposed change no longer matches the manuscript."
          : "A proposed change was ambiguous in the manuscript.",
      );
    }
    const start = hits[0];
    const end = start + raw.before.length;
    if (selection && (start < selection.start || end > selection.end)) {
      throw new Error("A proposed change reached outside the selected passage.");
    }
    if (occupied.some((span) => start < span.end && end > span.start)) {
      throw new Error("The proposed changes overlap each other.");
    }
    occupied.push({ start, end });
    changes.push({
      id: `change-${index + 1}`,
      before: raw.before,
      after: raw.after,
      reason: raw.reason.trim().slice(0, 180) || "Requested story change",
      baseStart: start,
      baseEnd: end,
    });
  }

  if (changes.length === 0) {
    throw new Error("The editor did not propose a meaningful change.");
  }
  return {
    summary:
      result.summary.trim().slice(0, 240) ||
      "Prepared the requested story changes.",
    changes,
  };
}

interface LocalEdit {
  baseStart: number;
  baseEnd: number;
  currentStart: number;
  currentEnd: number;
}

/** Convert a character diff into the base/current spans changed by the author. */
function localEdits(baseStory: string, currentStory: string): LocalEdit[] {
  const edits: LocalEdit[] = [];
  let baseAt = 0;
  let currentAt = 0;
  let active: LocalEdit | null = null;
  const flush = () => {
    if (!active) return;
    active.currentEnd = currentAt;
    edits.push(active);
    active = null;
  };

  for (const part of diffChars(baseStory, currentStory)) {
    if (!part.added && !part.removed) {
      flush();
      baseAt += part.value.length;
      currentAt += part.value.length;
      continue;
    }
    active ??= {
      baseStart: baseAt,
      baseEnd: baseAt,
      currentStart: currentAt,
      currentEnd: currentAt,
    };
    if (part.removed) {
      baseAt += part.value.length;
      active.baseEnd = baseAt;
    } else {
      currentAt += part.value.length;
    }
  }
  flush();
  return edits;
}

function rangesOverlap(start: number, end: number, edit: LocalEdit): boolean {
  if (edit.baseStart === edit.baseEnd) {
    // An insertion exactly at a replacement boundary can be preserved safely.
    return edit.baseStart > start && edit.baseStart < end;
  }
  return start < edit.baseEnd && end > edit.baseStart;
}

function mapBaseOffset(
  offset: number,
  edits: LocalEdit[],
  edge: "start" | "end",
): number {
  let delta = 0;
  for (const edit of edits) {
    if (edit.baseStart === edit.baseEnd && edit.baseStart === offset) {
      return edge === "start" ? edit.currentEnd : edit.currentStart;
    }
    if (offset < edit.baseStart) break;
    if (offset > edit.baseEnd || offset === edit.baseEnd) {
      delta +=
        edit.currentEnd -
        edit.currentStart -
        (edit.baseEnd - edit.baseStart);
      continue;
    }
    return edge === "start" ? edit.currentStart : edit.currentEnd;
  }
  return offset + delta;
}

function baseRange(baseStory: string, change: StoryRevisionChange): [number, number] {
  const start =
    typeof change.baseStart === "number"
      ? change.baseStart
      : occurrences(baseStory, change.before)[0];
  if (typeof start !== "number") {
    throw new Error("A proposed change no longer matches the revision snapshot.");
  }
  return [
    start,
    typeof change.baseEnd === "number" ? change.baseEnd : start + change.before.length,
  ];
}

export function storyRevisionChangeKind(
  before: string,
  after: string,
): StoryRevisionChangeKind {
  if (!after) return "delete";
  const parts = diffChars(before, after);
  const added = parts.some((part) => part.added);
  const removed = parts.some((part) => part.removed);
  if (added && !removed) return "add";
  if (removed && !added) return "delete";
  return "update";
}

/**
 * Three-way merge plan:
 *   baseStory    = immutable snapshot sent to the model
 *   currentStory = latest author text
 *   proposal     = model replacements against the base
 *
 * Non-overlapping author edits are retained automatically. Overlaps are
 * surfaced as per-change conflicts and resolved by the same accept/reject map.
 */
export function buildStoryMergePlan(
  baseStory: string,
  currentStory: string,
  proposal: StoryRevisionProposal,
): StoryMergePlan {
  const edits = localEdits(baseStory, currentStory);
  const changes = proposal.changes
    .map((change): StoryReviewChange => {
      const [start, end] = baseRange(baseStory, change);
      const overlapping = edits.filter((edit) => rangesOverlap(start, end, edit));
      const conflictStart = overlapping.reduce(
        (value, edit) => Math.min(value, edit.baseStart),
        start,
      );
      const conflictEnd = overlapping.reduce(
        (value, edit) => Math.max(value, edit.baseEnd),
        end,
      );
      const currentStart = mapBaseOffset(conflictStart, edits, "start");
      const currentEnd = mapBaseOffset(conflictEnd, edits, "end");
      const currentText = currentStory.slice(currentStart, currentEnd);
      const conflict =
        overlapping.length > 0 ||
        currentStory.slice(
          mapBaseOffset(start, edits, "start"),
          mapBaseOffset(end, edits, "end"),
        ) !== change.before;
      const suggestedText = conflict
        ? baseStory.slice(conflictStart, start) +
          change.after +
          baseStory.slice(end, conflictEnd)
        : change.after;
      return {
        ...change,
        kind: storyRevisionChangeKind(change.before, change.after),
        baseStart: start,
        baseEnd: end,
        currentStart,
        currentEnd,
        currentText,
        suggestedText,
        conflict,
      };
    })
    .sort((a, b) => a.currentStart - b.currentStart);

  const segments: StoryReviewSegment[] = [];
  let cursor = 0;
  const pushCurrentRange = (from: number, to: number) => {
    let at = from;
    for (const edit of edits) {
      const start = Math.max(from, edit.currentStart);
      const end = Math.min(to, edit.currentEnd);
      if (end <= start) continue;
      if (start > at) {
        segments.push({ type: "unchanged", text: currentStory.slice(at, start) });
      }
      segments.push({ type: "author", text: currentStory.slice(start, end) });
      at = Math.max(at, end);
    }
    if (at < to) {
      segments.push({ type: "unchanged", text: currentStory.slice(at, to) });
    }
  };
  for (const change of changes) {
    const detached = change.currentStart < cursor;
    if (!detached && change.currentStart > cursor) {
      pushCurrentRange(cursor, change.currentStart);
    }
    segments.push({ type: "change", change, ...(detached ? { detached: true } : {}) });
    if (!detached) cursor = Math.max(cursor, change.currentEnd);
  }
  if (cursor < currentStory.length) {
    pushCurrentRange(cursor, currentStory.length);
  }

  return {
    changes,
    segments,
    hasLocalEdits: baseStory !== currentStory,
    conflictCount: changes.filter((change) => change.conflict).length,
  };
}

export function storyRevisionDecisionContext(change: StoryReviewChange): string {
  return storyTextHash(`${change.currentText}\u0000${change.suggestedText}`);
}

export function applyStoryRevisionToCurrent(
  baseStory: string,
  currentStory: string,
  proposal: StoryRevisionProposal,
  decisions: Record<string, StoryRevisionDecision>,
): string {
  const accepted = buildStoryMergePlan(baseStory, currentStory, proposal).changes
    .filter((change) => decisions[change.id] === "accepted")
    .sort((a, b) => b.currentStart - a.currentStart);

  for (let index = 1; index < accepted.length; index += 1) {
    const later = accepted[index - 1];
    const earlier = accepted[index];
    if (earlier.currentEnd > later.currentStart) {
      throw new Error(
        "Two suggestions overlap the same text. Keep one of them, then apply the selected changes.",
      );
    }
  }

  let next = currentStory;
  for (const change of accepted) {
    next =
      next.slice(0, change.currentStart) +
      change.suggestedText +
      next.slice(change.currentEnd);
  }
  return next;
}

export function applyStoryRevision(
  baseStory: string,
  proposal: StoryRevisionProposal,
  decisions: Record<string, StoryRevisionDecision>,
): string {
  return applyStoryRevisionToCurrent(baseStory, baseStory, proposal, decisions);
}
