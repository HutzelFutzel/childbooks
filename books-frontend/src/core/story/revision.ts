import { z } from "zod";
import { diffChars } from "diff";
import type { BookConfig } from "../types";
import { restoreModelLineBreaks } from "./lineBreaks";

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

/**
 * A voice or shape change that has to touch the manuscript as a whole: rhyme,
 * simpler words, shorter. A warmer ending stays a small patch.
 */
const LOCAL_STORY_TARGET =
  /\b(ending|beginning|opening|scene|paragraph|sentence|page|line|moment|title|name|character)\b/iu;
const WHOLE_STORY_STYLE =
  /\b(rhyme|rhym\w*|verses?|poems?|simpler words|simpler language|easier words|easier to read|read[- ]aloud|whole story|entire story|throughout|every (?:sentence|line|page|paragraph))\b/iu;
const BROAD_STORY_EDIT = /\b(shorter|longer|simpler|funnier|sillier|gentler|calmer)\b/iu;
const STORY_WORD = /\b(story|text|it|book|manuscript)\b/iu;
const EDIT_VERB = /\b(make|change|rewrite|rework|shorten|lengthen|add|remove|take|cut|expand|simplify|warm|fix)\b/iu;
const STORY_EDIT_TOPIC =
  /\b(story|text|manuscript|ending|scene|rhyme|rhym\w*|verse|simpler|shorter|longer|read[- ]aloud|paragraph)\b/iu;

export function rewritesWholeStory(instruction: string): boolean {
  const text = instruction.trim();
  if (!text || text.length > 280 || LOCAL_STORY_TARGET.test(text)) return false;
  if (WHOLE_STORY_STYLE.test(text)) return true;
  return BROAD_STORY_EDIT.test(text) && STORY_WORD.test(text);
}

/** A sentence that is already the edit, so the revision can start before the interpreter answers. */
export function isEagerStoryEdit(instruction: string, marked = false): boolean {
  const text = instruction.trim();
  if (!text || text.length > 400 || /[?？]\s*$/u.test(text)) return false;
  if (rewritesWholeStory(text)) return !marked;
  if (marked && EDIT_VERB.test(text)) return true;
  return EDIT_VERB.test(text) && STORY_EDIT_TOPIC.test(text);
}

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

/** The model's `before`, written so it matches the text it was copied from. */
function spanInManuscript(haystack: string, before: string): string {
  if (occurrences(haystack, before).length === 1) return before;
  const restored = restoreModelLineBreaks(before);
  if (restored !== before && occurrences(haystack, restored).length === 1) return restored;
  return before;
}

/**
 * What the reader is told when a marked passage cannot carry the request they
 * made ("make the whole story shorter" with one sentence marked). Shown as the
 * revision's error, so it is written for them.
 */
export const STORY_EDIT_SCOPE_ERROR =
  "That change needs text outside the part you marked. Unmark it, or ask again without the mark.";

/** The editor could not do the request inside the marked passage. Retrying cannot fix it. */
export class StoryRevisionScopeError extends Error {
  constructor() {
    super(STORY_EDIT_SCOPE_ERROR);
    this.name = "StoryRevisionScopeError";
  }
}

const OUTSIDE_SELECTION = "A proposed change reached outside the selected passage.";

/** Whether a validation failure was the model leaving the marked passage. */
export function isOutsideSelectionFailure(message: string): boolean {
  return message === OUTSIDE_SELECTION;
}

function formatExpandedPassage(before: string, after: string): string {
  const trimmed = after.trim();
  if (/\n\s*\n/u.test(trimmed)) return after;

  const substantiallyExpanded =
    trimmed.length >= 180 && trimmed.length >= Math.max(120, before.trim().length * 2);
  if (!substantiallyExpanded) return after;

  const sentences =
    trimmed
      .match(/[^.!?。！？]+(?:[.!?。！？]+["'’”»)]*|$)/gu)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [];
  if (sentences.length < 3) return after;

  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) {
    paragraphs.push(sentences.slice(index, index + 2).join(" "));
  }
  return paragraphs.join("\n\n");
}

/**
 * Validate model-authored replacements against the immutable base manuscript.
 * Every `before` must identify one unique, non-overlapping span. That makes it
 * mechanically impossible for the model to alter text it did not name.
 */
export interface AssessedStoryRevision {
  summary: string;
  /** Replacements that match the manuscript and do not overlap. */
  changes: StoryRevisionChange[];
  /** Why the rest were refused, in the order the model sent them. */
  problems: string[];
  /** Every change was a no-op inside a marked passage. */
  scopeError: boolean;
}

/**
 * Keep every replacement that lands, and name the ones that do not.
 *
 * One bad `before` used to throw away the rest and force a second full
 * generation. The caller can ask again for only the failures.
 */
export function assessStoryRevision(
  baseStory: string,
  result: StoryRevisionModelResult,
  selection?: StoryRevisionSelection,
  already: readonly StoryRevisionChange[] = [],
): AssessedStoryRevision {
  const summary = result.summary.trim().slice(0, 240) || "Prepared the requested story changes.";
  if (result.changes.length > 40) {
    return {
      summary,
      changes: [],
      problems: ["The editor proposed too many separate changes."],
      scopeError: false,
    };
  }
  const occupied: Array<{ start: number; end: number }> = already.map((change) => ({
    start: change.baseStart ?? 0,
    end: change.baseEnd ?? (change.baseStart ?? 0) + change.before.length,
  }));
  const changes: StoryRevisionChange[] = [];
  const problems: string[] = [];
  // With a marked passage, a span only has to be unique inside it: a phrase that
  // repeats elsewhere in the story is not ambiguous about which one was marked.
  const scope = selection ? baseStory.slice(selection.start, selection.end) : baseStory;
  const scopeAt = selection?.start ?? 0;
  let sawNoop = false;

  for (const raw of result.changes) {
    const before = spanInManuscript(scope, raw.before);
    const after = formatExpandedPassage(before, restoreModelLineBreaks(raw.after));
    if (before === after) {
      sawNoop = true;
      continue;
    }
    if (!before) {
      problems.push("An insertion did not include an exact manuscript anchor.");
      continue;
    }
    if (already.some((change) => change.before === before) || changes.some((change) => change.before === before)) {
      continue;
    }
    const hits = occurrences(scope, before);
    if (hits.length !== 1) {
      if (selection && hits.length === 0 && occurrences(baseStory, before).length > 0) {
        problems.push(OUTSIDE_SELECTION);
      } else {
        problems.push(
          hits.length === 0
            ? "A proposed change no longer matches the manuscript."
            : "A proposed change was ambiguous in the manuscript.",
        );
      }
      continue;
    }
    const start = scopeAt + hits[0];
    const end = start + before.length;
    if (occupied.some((span) => start < span.end && end > span.start)) {
      problems.push("The proposed changes overlap each other.");
      continue;
    }
    occupied.push({ start, end });
    changes.push({
      id: `change-${already.length + changes.length + 1}`,
      before,
      after,
      reason: raw.reason.trim().slice(0, 180) || "Requested story change",
      baseStart: start,
      baseEnd: end,
    });
  }

  return {
    summary,
    changes,
    problems,
    scopeError: Boolean(selection) && changes.length === 0 && problems.length === 0 && sawNoop,
  };
}

export function validateStoryRevision(
  baseStory: string,
  result: StoryRevisionModelResult,
  selection?: StoryRevisionSelection,
): StoryRevisionProposal {
  const assessed = assessStoryRevision(baseStory, result, selection);
  if (assessed.scopeError) throw new StoryRevisionScopeError();
  if (assessed.problems.length > 0) throw new Error(assessed.problems[0]);
  if (assessed.changes.length === 0) {
    throw new Error("The editor did not propose a meaningful change.");
  }
  return { summary: assessed.summary, changes: assessed.changes };
}

interface SpanEdit {
  baseStart: number;
  baseEnd: number;
  nextStart: number;
  nextEnd: number;
}

/** The rewritten manuscript as reviewable hunks. A near-total rewrite is one change. */
export function proposalFromRewrite(baseStory: string, rewritten: string, summary: string): StoryRevisionProposal {
  const next = restoreModelLineBreaks(rewritten).trim();
  const base = baseStory;
  if (!next || next === base.trim()) {
    throw new Error("The editor did not propose a meaningful change.");
  }
  const edits = spanEdits(base, next);
  const changed = edits.reduce(
    (sum, edit) => sum + (edit.baseEnd - edit.baseStart) + (edit.nextEnd - edit.nextStart),
    0,
  );
  const heading = summary.trim().slice(0, 240) || "Prepared the requested story changes.";
  if (changed >= (base.length + next.length) * 0.55) {
    return {
      summary: heading,
      changes: [
        {
          id: "change-1",
          before: base,
          after: next,
          reason: heading,
          baseStart: 0,
          baseEnd: base.length,
        },
      ],
    };
  }
  const merged = coalesceSpans(base, edits, 80).slice(0, 40);
  if (merged.length === 0) throw new Error("The editor did not propose a meaningful change.");
  return {
    summary: heading,
    changes: merged.map((edit, index) => ({
      id: `change-${index + 1}`,
      before: base.slice(edit.baseStart, edit.baseEnd),
      after: next.slice(edit.nextStart, edit.nextEnd),
      reason: heading,
      baseStart: edit.baseStart,
      baseEnd: edit.baseEnd,
    })),
  };
}

function spanEdits(base: string, next: string): SpanEdit[] {
  const edits: SpanEdit[] = [];
  let baseAt = 0;
  let nextAt = 0;
  let active: SpanEdit | null = null;
  const flush = () => {
    if (!active) return;
    if (active.baseEnd > active.baseStart || active.nextEnd > active.nextStart) edits.push(active);
    active = null;
  };
  for (const part of diffChars(base, next)) {
    if (!part.added && !part.removed) {
      flush();
      baseAt += part.value.length;
      nextAt += part.value.length;
      continue;
    }
    active ??= { baseStart: baseAt, baseEnd: baseAt, nextStart: nextAt, nextEnd: nextAt };
    if (part.removed) {
      baseAt += part.value.length;
      active.baseEnd = baseAt;
    } else {
      nextAt += part.value.length;
      active.nextEnd = nextAt;
    }
  }
  flush();
  return edits;
}

function coalesceSpans(base: string, edits: SpanEdit[], gap: number): SpanEdit[] {
  const merged: SpanEdit[] = [];
  for (const edit of edits) {
    const prev = merged[merged.length - 1];
    const between = prev ? base.slice(prev.baseEnd, edit.baseStart) : "";
    if (prev && between.length <= gap) {
      prev.baseEnd = edit.baseEnd;
      prev.nextEnd = edit.nextEnd;
      continue;
    }
    merged.push({ ...edit });
  }
  return merged;
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
        currentText: restoreModelLineBreaks(currentText),
        suggestedText: restoreModelLineBreaks(suggestedText),
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
        segments.push({ type: "unchanged", text: restoreModelLineBreaks(currentStory.slice(at, start)) });
      }
      segments.push({ type: "author", text: restoreModelLineBreaks(currentStory.slice(start, end)) });
      at = Math.max(at, end);
    }
    if (at < to) {
      segments.push({ type: "unchanged", text: restoreModelLineBreaks(currentStory.slice(at, to)) });
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
  return restoreModelLineBreaks(next);
}

export function applyStoryRevision(
  baseStory: string,
  proposal: StoryRevisionProposal,
  decisions: Record<string, StoryRevisionDecision>,
): string {
  return applyStoryRevisionToCurrent(baseStory, baseStory, proposal, decisions);
}
