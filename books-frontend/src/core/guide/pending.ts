/**
 * Looks said about somebody who is not in the book yet.
 *
 * "Papa wears a gray cap" can arrive before Papa is saved, or about somebody the
 * parent has not named properly yet. Refusing it loses it; guessing an owner puts
 * the cap on the wrong person. So it is held, with the words the parent used for
 * the person, and attached the moment exactly one person answers to those words.
 * Held looks are checked again after every change to the book (see
 * `reconcilePendingLooks`), so no step has to remember to do it.
 */
import type { PendingLook, Project, StoryCastMember } from "../types";
import { briefOf } from "../story/brief";
import { resolvePerson } from "./agent/resolve";
import { castWithAlias } from "./aliases";
import { attachLook, lookKey } from "./lookNotes";
import { authoringOf, withAuthoring } from "./projectState";

export const MAX_PENDING_LOOKS = 12;

function wordsKey(words: string): string {
  return words
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function pendingLooksOf(project: Pick<Project, "authoringState">): PendingLook[] {
  return authoringOf(project).pendingLooks ?? [];
}

/** The book with a look held for somebody who cannot be found yet. The same look is held once. */
export function withPendingLook(project: Project, words: string, look: string): Project {
  const text = look.trim().slice(0, 400);
  const who = words.trim().slice(0, 60);
  if (!text || !who) return project;
  const current = pendingLooksOf(project);
  if (current.some((item) => wordsKey(item.words) === wordsKey(who) && lookKey(item.look) === lookKey(text))) return project;
  return withAuthoring(project, { pendingLooks: [...current, { words: who, look: text }].slice(-MAX_PENDING_LOOKS) });
}

/** The book without held looks that say this look (it was given to somebody properly). */
export function withoutPendingLook(project: Project, look: string): Project {
  const key = lookKey(look);
  const current = pendingLooksOf(project);
  const kept = current.filter((item) => lookKey(item.look) !== key);
  return kept.length === current.length ? project : withAuthoring(project, { pendingLooks: kept.length > 0 ? kept : undefined });
}

/** The book with the held looks marked as asked about, so the question is never repeated. */
export function withPendingLooksAsked(project: Project): Project {
  const current = pendingLooksOf(project);
  if (current.every((item) => item.asked)) return project;
  return withAuthoring(project, { pendingLooks: current.map((item) => ({ ...item, asked: true })) });
}

/** Held looks nobody has been asked about yet. */
export function unaskedPendingLooks(project: Pick<Project, "authoringState">): PendingLook[] {
  return pendingLooksOf(project).filter((item) => !item.asked);
}

/**
 * Attach every held look whose person can now be found, and learn the words used
 * as an alias so the person is found the same way next time. A word that could
 * mean two people stays held: the chat asks, never guesses. Idempotent, and the
 * same book back when nothing is held.
 */
export function reconcilePendingLooks(project: Project): Project {
  const held = pendingLooksOf(project);
  if (held.length === 0) return project;
  let next = project;
  const left: PendingLook[] = [];
  for (const item of held) {
    const found = resolvePerson(next, item.words);
    if (found.kind !== "one") {
      left.push(item);
      continue;
    }
    const member = found.value;
    next = attachLook(next, member, item.look);
    const cast = briefOf(next.config).cast ?? [];
    const withAlias = castWithAlias(cast, member.id, item.words);
    if (withAlias.some((candidate, index) => candidate !== cast[index])) {
      next = { ...next, config: { ...next.config, storyBrief: { ...briefOf(next.config), cast: withAlias } } };
    }
  }
  return left.length === held.length ? project : withAuthoring(next, { pendingLooks: left.length > 0 ? left : undefined });
}

/** Who a held look went to, for saying so: looks that were held before and are not now. */
export function placedLooks(before: Project, after: Project): { name: string; look: string }[] {
  const still = new Set(pendingLooksOf(after).map((item) => `${wordsKey(item.words)}|${lookKey(item.look)}`));
  const placed: { name: string; look: string }[] = [];
  for (const item of pendingLooksOf(before)) {
    if (still.has(`${wordsKey(item.words)}|${lookKey(item.look)}`)) continue;
    const found = resolvePerson(after, item.words);
    if (found.kind === "one") placed.push({ name: (found.value as StoryCastMember).name.trim(), look: item.look });
  }
  return placed;
}
