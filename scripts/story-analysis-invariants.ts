import assert from "node:assert/strict";
import {
  dropLowImportance,
  foldWornItemsIntoOwners,
  refineAnalyzedAnchors,
  sameSubject,
} from "../books-frontend/src/core/book/anchorMerge";
import {
  mergeAliasNames,
  normalizeAnchorName,
  reconcileAnchorIds,
} from "../books-frontend/src/core/book/anchorRefs";
import { matchAnchorNames } from "../books-frontend/src/core/pipeline/screenplay";
import { createDefaultPromptsConfig } from "../books-frontend/src/core/prompts/registry";
import { renderTextPrompt } from "../books-frontend/src/core/prompts/render";
import type { Anchor, AnchorImportance, AnchorType, BodyPlan } from "../books-frontend/src/core/types";

function anchor(partial: {
  id?: string;
  name: string;
  type: AnchorType;
  description: string;
  importance?: AnchorImportance;
  aliasNames?: string[];
  bodyPlan?: BodyPlan;
}): Anchor {
  return {
    id: partial.id ?? partial.name.toLowerCase().replace(/\s+/g, "-"),
    name: partial.name,
    source: "analysis",
    type: partial.type,
    description: partial.description,
    importance: partial.importance ?? "high",
    mode: "creative",
    include: true,
    ...(partial.aliasNames ? { aliasNames: partial.aliasNames } : {}),
    ...(partial.bodyPlan ? { bodyPlan: partial.bodyPlan } : {}),
  };
}

const overExtracted: Anchor[] = [
  anchor({
    name: "Mila",
    type: "character",
    bodyPlan: "bipedal",
    description: "A young girl in a bright play outfit and bright yellow boots.",
  }),
  anchor({
    name: "Pip",
    type: "character",
    bodyPlan: "quadruped",
    description: "A small brown puppy with a wiggly tail.",
  }),
  anchor({
    name: "Bluey",
    type: "character",
    bodyPlan: "bipedal",
    description: "A small blue stuffed elephant who giggles and sits up straight.",
  }),
  anchor({
    name: "blue toy elephant",
    type: "object",
    importance: "medium",
    description: "A blue plush elephant that rides in the wagon.",
  }),
  anchor({
    name: "yellow boots",
    type: "object",
    importance: "medium",
    description: "Bright yellow rain boots.",
  }),
  anchor({
    name: "red wagon",
    type: "object",
    importance: "medium",
    description: "A small red wagon with black wheels.",
  }),
  anchor({
    name: "red blanket",
    type: "object",
    importance: "low",
    description: "A soft red picnic blanket.",
  }),
  anchor({
    name: "strawberries",
    type: "object",
    importance: "low",
    description: "A handful of red strawberries.",
  }),
  anchor({
    name: "mud patch",
    type: "place",
    importance: "low",
    description: "A wet patch of mud in the yard.",
  }),
  anchor({
    name: "green grass",
    type: "place",
    importance: "low",
    description: "Tall tickly green grass.",
  }),
  anchor({
    name: "oak tree",
    type: "place",
    importance: "low",
    description: "A giant oak tree with a pile of dry leaves.",
  }),
];

const refined = refineAnalyzedAnchors(overExtracted);
const names = refined.map((row) => normalizeAnchorName(row.name)).sort();

assert.deepEqual(names, ["bluey", "mila", "pip", "red wagon"]);

const bluey = refined.find((row) => normalizeAnchorName(row.name) === "bluey");
assert.equal(bluey?.type, "character");
assert.match(bluey?.description ?? "", /elephant/i);
assert.ok(
  (bluey?.aliasNames ?? []).some((alias) => normalizeAnchorName(alias).includes("elephant")),
  "Bluey should keep the toy-elephant phrase as an alias",
);
assert.equal(
  refined.filter((row) => /elephant|bluey/i.test(row.name)).length,
  1,
);

const mila = refined.find((row) => normalizeAnchorName(row.name) === "mila");
assert.match(mila?.description ?? "", /boot/i);
assert.equal(
  refined.some((row) => normalizeAnchorName(row.name).includes("boot")),
  false,
);

assert.equal(
  sameSubject(
    anchor({
      name: "Bluey",
      type: "character",
      description: "A small blue stuffed elephant who giggles.",
    }),
    anchor({
      name: "blue toy elephant",
      type: "object",
      description: "A blue plush elephant.",
    }),
  ),
  true,
);

assert.equal(
  sameSubject(
    anchor({
      name: "Bluey the blue toy elephant",
      type: "character",
      description: "A standing toy elephant.",
    }),
    anchor({
      name: "toy elephant",
      type: "object",
      description: "A blue toy.",
    }),
  ),
  true,
);

assert.equal(
  sameSubject(
    anchor({
      name: "Bluey",
      type: "character",
      description: "A small blue stuffed elephant who rides in a wagon.",
    }),
    anchor({
      name: "red wagon",
      type: "object",
      description: "A small red wagon.",
    }),
  ),
  false,
);

assert.equal(
  sameSubject(
    anchor({
      name: "Pip",
      type: "character",
      bodyPlan: "quadruped",
      description: "A small brown puppy.",
    }),
    anchor({
      name: "blue toy elephant",
      type: "object",
      description: "A blue plush elephant.",
    }),
  ),
  false,
);

const pipMerged = refineAnalyzedAnchors([
  anchor({ name: "Pip", type: "character", description: "A wiggly puppy." }),
  anchor({
    name: "Pip the puppy",
    type: "character",
    description: "A small brown puppy with a wagging tail.",
  }),
]);
assert.equal(pipMerged.length, 1);
assert.equal(normalizeAnchorName(pipMerged[0]!.name), "pip");

const folded = foldWornItemsIntoOwners([
  anchor({
    name: "Mila",
    type: "character",
    bodyPlan: "bipedal",
    description: "A young girl in a play dress.",
  }),
  anchor({
    name: "Pip",
    type: "character",
    bodyPlan: "quadruped",
    description: "A brown puppy.",
  }),
  anchor({
    name: "yellow boots",
    type: "object",
    description: "Bright yellow rain boots.",
  }),
]);
assert.equal(folded.some((row) => normalizeAnchorName(row.name).includes("boot")), false);
assert.match(
  folded.find((row) => normalizeAnchorName(row.name) === "mila")?.description ?? "",
  /boot/i,
);

assert.deepEqual(
  dropLowImportance(overExtracted)
    .filter((row) => row.type === "place")
    .map((row) => row.name),
  [],
);

const { system } = renderTextPrompt(createDefaultPromptsConfig(), "storyAnalysis", {
  vars: {
    age: "2 years",
    ageGuidance: "",
    languageName: "English",
    story: "Mila pulls on her boots.",
    castHints: "",
    artLooks: "",
    artworkNames: "",
  },
  flags: { hasCastHints: false, hasArtLooks: false, hasArtworkNames: false },
});
assert.match(system, /ONE IDENTITY PER SUBJECT/);
assert.match(system, /Do not extract clothing/);
assert.doesNotMatch(system, /low = minor but still needs consistency/);

const previous = [
  anchor({
    id: "keep-bluey",
    name: "Ellie",
    type: "character",
    description: "Renamed by the author.",
    aliasNames: ["Bluey"],
  }),
];
previous[0]!.source = "user";
const next = [
  anchor({
    id: "fresh",
    name: "Bluey",
    type: "character",
    description: "A blue stuffed elephant.",
    aliasNames: ["the blue toy elephant"],
  }),
];
const reconciled = reconcileAnchorIds(next, previous);
assert.equal(reconciled[0]?.id, "keep-bluey");
assert.equal(reconciled[0]?.name, "Ellie");
assert.deepEqual(
  (reconciled[0]?.aliasNames ?? []).map((alias) => normalizeAnchorName(alias)).sort(),
  ["blue toy elephant", "bluey"],
);

const matched = matchAnchorNames(["the toy elephant"], [
  anchor({
    id: "b1",
    name: "Bluey",
    type: "character",
    description: "A blue stuffed elephant.",
    aliasNames: ["the blue toy elephant", "toy elephant"],
  }),
]);
assert.deepEqual(matched.ids, ["b1"]);
assert.deepEqual(matched.unmatched, []);

assert.deepEqual(mergeAliasNames("Bluey", ["Bluey"], ["the blue toy elephant"], [" toy elephant "]), [
  "the blue toy elephant",
  "toy elephant",
]);

console.log("Story analysis invariants passed.");
