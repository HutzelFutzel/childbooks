/**
 * Post-process story-analysis anchors so one story identity becomes one row.
 *
 * The model is asked not to split "Bluey the blue toy elephant" into a named
 * character plus a toy object, and not to promote one-scene props. This pass
 * is the deterministic belt when it still does: merge aliases, fold worn items
 * into their owner, and drop low-importance extras before they become sheets.
 */
import type { Anchor, AnchorImportance } from "../types";
import { mergeAliasNames, normalizeAnchorName } from "./anchorRefs";

const IMPORTANCE_RANK: Record<AnchorImportance, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

const TYPE_RANK: Record<Anchor["type"], number> = {
  character: 2,
  object: 1,
  place: 0,
};

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "from",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "orange",
  "brown",
  "black",
  "white",
  "grey",
  "gray",
  "gold",
  "silver",
  "bright",
  "dark",
  "big",
  "little",
  "small",
  "tiny",
  "tall",
  "giant",
  "soft",
  "wet",
  "sweet",
  "old",
  "new",
]);

const TOY_HINTS = new Set(["toy", "stuffed", "plush", "doll", "puppet", "teddy"]);

const ANIMAL_NOUNS = new Set([
  "elephant",
  "puppy",
  "pup",
  "dog",
  "cat",
  "kitten",
  "bear",
  "rabbit",
  "bunny",
  "fox",
  "mouse",
  "bird",
  "duck",
  "owl",
  "dragon",
  "unicorn",
  "dinosaur",
  "penguin",
  "hedgehog",
  "giraffe",
  "lion",
  "tiger",
  "monkey",
  "panda",
  "koala",
  "hippo",
  "whale",
  "frog",
  "squirrel",
]);

const WORN_ITEMS = new Set([
  "boot",
  "boots",
  "shoe",
  "shoes",
  "hat",
  "cap",
  "coat",
  "jacket",
  "dress",
  "shirt",
  "sweater",
  "scarf",
  "glove",
  "gloves",
  "mitten",
  "mittens",
  "raincoat",
  "sneaker",
  "sneakers",
  "sandal",
  "sandals",
  "slipper",
  "slippers",
  "overalls",
  "cape",
  "bow",
  "ribbon",
  "glasses",
  "sock",
  "socks",
]);

function tokens(value: string): string[] {
  return normalizeAnchorName(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function distinctiveTokens(value: string): string[] {
  return tokens(value).filter((token) => !STOP.has(token));
}

function tokenSet(value: string): Set<string> {
  return new Set(tokens(value));
}

function labels(anchor: Pick<Anchor, "name" | "aliasNames">): string[] {
  return [anchor.name, ...(anchor.aliasNames ?? [])].map((n) => n.trim()).filter(Boolean);
}

function bagOf(anchor: Pick<Anchor, "name" | "aliasNames" | "description">): string {
  return [...labels(anchor), anchor.description].join(" ");
}

/** Whole-token sequence, so "blue" does not match "bluey". */
function containsTokenSequence(haystack: string, needle: string): boolean {
  const hay = tokens(haystack);
  const need = tokens(needle);
  if (need.length === 0 || need.every((token) => STOP.has(token))) return false;
  for (let i = 0; i <= hay.length - need.length; i++) {
    if (need.every((token, j) => hay[i + j] === token)) return true;
  }
  return false;
}

function isProperName(name: string): boolean {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^[\p{Lu}]/u.test(first) && !/^(The|A|An)$/i.test(first);
}

function looksLikeToy(anchor: Pick<Anchor, "name" | "aliasNames" | "description">): boolean {
  const bag = tokenSet(bagOf(anchor));
  return [...TOY_HINTS].some((hint) => bag.has(hint));
}

function animalNouns(anchor: Pick<Anchor, "name" | "aliasNames" | "description">): Set<string> {
  return new Set(tokens(bagOf(anchor)).filter((token) => ANIMAL_NOUNS.has(token)));
}

function animalConflict(a: Anchor, b: Anchor): boolean {
  const left = animalNouns(a);
  const right = animalNouns(b);
  if (left.size === 0 || right.size === 0) return false;
  for (const noun of left) if (right.has(noun)) return false;
  return true;
}

function nameOverlap(a: Anchor, b: Anchor): boolean {
  for (const left of labels(a)) {
    for (const right of labels(b)) {
      if (normalizeAnchorName(left) === normalizeAnchorName(right)) return true;
      if (containsTokenSequence(left, right) || containsTokenSequence(right, left)) return true;
    }
  }
  return false;
}

/**
 * True when two extracted rows are the same story identity — an appositive
 * split ("Bluey" + "the blue toy elephant") or a name the other row already
 * uses in its labels or description.
 */
export function sameSubject(a: Anchor, b: Anchor): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  if (nameOverlap(a, b)) return true;

  for (const label of labels(a)) {
    if (isProperName(label) && containsTokenSequence(bagOf(b), label)) return true;
  }
  for (const label of labels(b)) {
    if (isProperName(label) && containsTokenSequence(bagOf(a), label)) return true;
  }

  const types = new Set([a.type, b.type]);
  if (!types.has("character") || !types.has("object") || animalConflict(a, b)) return false;

  const character = a.type === "character" ? a : b;
  const object = a.type === "object" ? a : b;
  // Only the object side can prove a named-toy split. A toy character's
  // description often mentions props (wagon, blanket) that must stay separate.
  if (!looksLikeToy(object)) return false;

  const objectKind = distinctiveTokens(object.name).filter((token) => !TOY_HINTS.has(token));
  const characterTokens = tokenSet(bagOf(character));
  return objectKind.length > 0 && objectKind.every((token) => characterTokens.has(token));
}

function preferAnchor(a: Anchor, b: Anchor): Anchor {
  const typeDelta = TYPE_RANK[a.type] - TYPE_RANK[b.type];
  if (typeDelta !== 0) return typeDelta > 0 ? a : b;
  const importanceDelta = IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance];
  if (importanceDelta !== 0) return importanceDelta > 0 ? a : b;
  return a;
}

function preferName(a: Anchor, b: Anchor): string {
  const candidates = [a.name, b.name];
  const proper = candidates.filter(isProperName);
  const pool = proper.length > 0 ? proper : candidates;
  return pool.slice().sort((left, right) => {
    const tokenDelta = tokens(left).length - tokens(right).length;
    if (tokenDelta !== 0) return tokenDelta;
    return left.length - right.length;
  })[0]!;
}

function preferAgeSource(
  a?: Anchor["ageSource"],
  b?: Anchor["ageSource"],
): Anchor["ageSource"] | undefined {
  const rank = { author: 2, story: 1, suggested: 0 };
  if (!a) return b;
  if (!b) return a;
  return (rank[a] ?? 0) >= (rank[b] ?? 0) ? a : b;
}

function mergeDescriptions(keep: string, drop: string): string {
  const a = keep.trim();
  const b = drop.trim();
  if (!b) return a;
  if (!a) return b;
  const an = normalizeAnchorName(a);
  const bn = normalizeAnchorName(b);
  if (an.includes(bn)) return a;
  if (bn.includes(an)) return b;
  return a.length >= b.length ? a : b;
}

function collapseAnchors(a: Anchor, b: Anchor): Anchor {
  const winner = preferAnchor(a, b);
  const loser = winner.id === a.id ? b : a;
  const name = preferName(winner, loser);
  const character = winner.type === "character" ? winner : loser.type === "character" ? loser : winner;
  const ageSource = preferAgeSource(winner.ageSource, loser.ageSource);
  const ageYears =
    ageSource === winner.ageSource && winner.ageYears !== undefined
      ? winner.ageYears
      : ageSource === loser.ageSource && loser.ageYears !== undefined
        ? loser.ageYears
        : (winner.ageYears ?? loser.ageYears);
  return {
    ...winner,
    name,
    type: winner.type === "character" || loser.type === "character" ? "character" : winner.type,
    description: mergeDescriptions(winner.description, loser.description),
    importance:
      IMPORTANCE_RANK[winner.importance] >= IMPORTANCE_RANK[loser.importance]
        ? winner.importance
        : loser.importance,
    aliasNames: mergeAliasNames(name, winner.aliasNames, loser.aliasNames, [winner.name, loser.name]),
    include: winner.include || loser.include,
    ...(character.type === "character"
      ? {
          ...(character.bodyPlan || winner.bodyPlan || loser.bodyPlan
            ? { bodyPlan: character.bodyPlan ?? winner.bodyPlan ?? loser.bodyPlan }
            : {}),
          ...(ageYears !== undefined ? { ageYears, ageSource } : {}),
          ...(winner.heightCm ?? loser.heightCm
            ? { heightCm: winner.heightCm ?? loser.heightCm }
            : {}),
        }
      : {}),
  };
}

/** Collapse rows that refer to the same identity, keeping one id per cluster. */
export function mergeDuplicateAnchors(anchors: Anchor[]): Anchor[] {
  let list = anchors.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const next: Anchor[] = [];
    for (const anchor of list) {
      const index = next.findIndex((existing) => sameSubject(existing, anchor));
      if (index >= 0) {
        next[index] = collapseAnchors(next[index]!, anchor);
        changed = true;
      } else {
        next.push(anchor);
      }
    }
    list = next;
  }
  return list;
}

function isWornItem(anchor: Anchor): boolean {
  return anchor.type === "object" && tokens(anchor.name).some((token) => WORN_ITEMS.has(token));
}

function foldIntoOwner(owner: Anchor, item: Anchor): Anchor {
  const alreadyMentioned = containsTokenSequence(
    `${owner.name} ${owner.description}`,
    item.name,
  );
  const description = alreadyMentioned
    ? owner.description
    : owner.description.trim()
      ? `${owner.description.trim()} Wears ${item.name}.`
      : item.description;
  return {
    ...owner,
    description,
    aliasNames: mergeAliasNames(owner.name, owner.aliasNames, [item.name], item.aliasNames),
    importance:
      IMPORTANCE_RANK[owner.importance] >= IMPORTANCE_RANK[item.importance]
        ? owner.importance
        : item.importance,
  };
}

/**
 * Signature clothing belongs on the wearer, not as its own sheet — yellow
 * boots that only exist on Mila's feet should not become a second reference.
 */
export function foldWornItemsIntoOwners(anchors: Anchor[]): Anchor[] {
  const worn = anchors.filter(isWornItem);
  if (worn.length === 0) return anchors;
  const kept = anchors.filter((anchor) => !isWornItem(anchor));
  const owners = new Map(
    kept.filter((anchor) => anchor.type === "character").map((anchor) => [anchor.id, anchor]),
  );
  const leftover: Anchor[] = [];

  for (const item of worn) {
    const kind = distinctiveTokens(item.name);
    const matches = [...owners.values()].filter((owner) => {
      const hay = tokenSet(`${owner.name} ${owner.description}`);
      return kind.length > 0 && kind.every((token) => hay.has(token));
    });
    const bipeds = [...owners.values()].filter(
      (owner) => owner.bodyPlan === "bipedal" || owner.bodyPlan === undefined,
    );
    const owner =
      matches.length === 1
        ? matches[0]
        : matches.length === 0 && bipeds.length === 1
          ? bipeds[0]
          : undefined;
    if (!owner) {
      leftover.push(item);
      continue;
    }
    owners.set(owner.id, foldIntoOwner(owner, item));
  }

  return kept.map((anchor) => owners.get(anchor.id) ?? anchor).concat(leftover);
}

/** Low-importance extras are page-brief details, not consistency subjects. */
export function dropLowImportance(anchors: Anchor[]): Anchor[] {
  return anchors.filter((anchor) => anchor.importance !== "low");
}

/**
 * Merge splits, fold worn items, drop low-importance extras. Remaining rows
 * are the ones that should get reference sheets.
 */
export function refineAnalyzedAnchors(anchors: Anchor[]): Anchor[] {
  return dropLowImportance(foldWornItemsIntoOwners(mergeDuplicateAnchors(anchors))).map(
    (anchor) => ({ ...anchor, include: true }),
  );
}
