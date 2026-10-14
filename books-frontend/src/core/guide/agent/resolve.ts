/**
 * Names the reader typed, resolved to the things in the book.
 *
 * The interpreter passes names, never ids it invented: "Amanda", "the dog",
 * "watercolor". This finds the one thing each name means, or reports that
 * several match (the chat asks which) or none does. Matching forgives case,
 * accents and one typo on longer names, and nothing looser — a wrong match
 * redraws the wrong child.
 */
import { briefOf, namedCast } from "../../story/brief";
import type { Anchor, Project, StoryCastMember } from "../../types";

export type Resolution<T> =
  | { kind: "one"; value: T }
  | { kind: "many"; values: T[] }
  | { kind: "none" };

export function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length]![b.length]!;
}

/** Best matches for a name among labelled things: exact first, then first-name, then one typo. */
export function matchByName<T>(name: string, items: readonly T[], labels: (item: T) => string[]): Resolution<T> {
  const wanted = foldName(name);
  if (!wanted) return { kind: "none" };
  const tiers: ((label: string) => boolean)[] = [
    (label) => label === wanted,
    (label) => label.split(" ")[0] === wanted || wanted.split(" ")[0] === label,
    (label) => wanted.length >= 4 && distance(label, wanted) <= 1,
  ];
  for (const tier of tiers) {
    const hits = items.filter((item) => labels(item).map(foldName).some(tier));
    if (hits.length === 1) return { kind: "one", value: hits[0]! };
    if (hits.length > 1) return { kind: "many", values: hits };
  }
  return { kind: "none" };
}

export function castOf(project: Project): StoryCastMember[] {
  return namedCast(briefOf(project.config)).filter((member) => member.name.trim());
}

export function resolvePerson(project: Project, name: string): Resolution<StoryCastMember> {
  return matchByName(name, castOf(project), (member) => [member.name]);
}

export function resolveAnchor(project: Project, name: string): Resolution<Anchor> {
  const anchors = (project.anchors ?? []).filter((anchor) => anchor.type !== "character");
  return matchByName(name, anchors, (anchor) => [anchor.name, ...(anchor.aliasNames ?? [])]);
}

export function resolveOption<T extends { id: string; label: string }>(
  name: string,
  options: readonly T[],
): Resolution<T> {
  return matchByName(name, options, (option) => [option.id, option.label]);
}

/** Whole-word occurrences of a name in a text, across scripts. */
export function nameRegExp(name: string): RegExp {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
}

export function countMentions(text: string, name: string): number {
  if (!name.trim()) return 0;
  return text.match(nameRegExp(name))?.length ?? 0;
}
