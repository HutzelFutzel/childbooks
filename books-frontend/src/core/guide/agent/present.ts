/**
 * Beats into one message.
 *
 * A turn can produce several things to say ("Amanda is 2", "here are the
 * Sparks packs", "how old is Brian?"). They are ordered by weight — something
 * blocking first, then a confirmation, results, answers, and the question last
 * so the message ends on it — and capped, so a combined request still reads as
 * one short message. A blocking beat stands alone.
 */
import { guideCopy, type GuideCopyOverrides, type GuideLineKey } from "../copy";
import type { Beat, BeatPriority } from "./types";

const ORDER: Record<BeatPriority, number> = { blocking: 0, confirm: 1, result: 2, answer: 3, question: 4 };

export interface Utterance {
  /** The configured meanings, joined. Shown as-is when the composer is off or fails. */
  meaning: string;
  meanings: string[];
  keys: GuideLineKey[];
  names: string[];
  mustSay: string[];
  question: boolean;
  receipt: string[];
}

export function presentBeats(beats: readonly Beat[], copy: GuideCopyOverrides | undefined, max = 3): Utterance | null {
  const ordered = beats
    .map((beat, index) => ({ beat, index }))
    .sort((a, b) => ORDER[a.beat.priority] - ORDER[b.beat.priority] || a.index - b.index)
    .map((entry) => entry.beat);
  if (ordered.length === 0) return null;
  const picked: Beat[] = [];
  for (const beat of ordered) {
    const text = beat.text ?? guideCopy(copy, beat.key, beat.vars);
    if (picked.some((p) => (p.text ?? guideCopy(copy, p.key, p.vars)) === text)) continue;
    if (beat.key === "done" && picked.some((p) => p.priority === "result")) continue;
    picked.push(beat);
    if (beat.priority === "blocking") break;
  }
  const lines =
    picked[0]!.priority === "blocking"
      ? [picked[0]!]
      : picked.length > max
        ? [...picked.slice(0, max - 1), picked.find((b) => b.priority === "question") ?? picked[max - 1]!]
        : picked;
  const meanings = lines.map((beat) => (beat.text ?? guideCopy(copy, beat.key, beat.vars)).trim()).filter(Boolean);
  if (meanings.length === 0) return null;
  const names = new Set<string>();
  for (const beat of lines) {
    const raw = beat.vars?.names;
    for (const name of Array.isArray(raw) ? raw : raw ? [raw] : []) if (typeof name === "string" && name.trim()) names.add(name.trim());
  }
  return {
    meaning: meanings.join(" "),
    meanings,
    keys: lines.map((beat) => beat.key),
    names: [...names],
    mustSay: [...new Set(lines.flatMap((beat) => beat.mustSay ?? []))],
    question: lines.some((beat) => beat.priority === "question") || meanings.some((m) => m.trim().endsWith("?")),
    receipt: beats.map((beat) => beat.receipt).filter((r): r is string => Boolean(r)),
  };
}
