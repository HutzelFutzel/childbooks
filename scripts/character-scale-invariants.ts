import assert from "node:assert/strict";
import {
  heightAfterAgeChange,
  heightFractions,
  humanHeightCm,
  relativeHeightsText,
} from "../books-frontend/src/core/book/anchorScale";
import { createDefaultPromptsConfig } from "../books-frontend/src/core/prompts/registry";
import type { Anchor, BodyPlan } from "../books-frontend/src/core/types";

function person(
  name: string,
  partial: { ageYears?: number; heightCm?: number; bodyPlan?: BodyPlan } = {},
): Anchor {
  return {
    id: name.toLowerCase(),
    name,
    source: "analysis",
    type: "character",
    description: `${name}.`,
    importance: "high",
    mode: "creative",
    include: true,
    ...partial,
  };
}

// --- Same age means same size, whatever the analysis model guessed ---
{
  const aren = person("Aren", { ageYears: 2, heightCm: 92 });
  const amira = person("Amira", { ageYears: 2, heightCm: 84 });
  const text = relativeHeightsText([aren, amira]);
  assert.match(text, /Aren and Amira are exactly the same height/, text);
  assert.doesNotMatch(text, /tallest|eyes|chin|comes up/, "a tie is not a ranking");
  const fractions = heightFractions([aren, amira]);
  assert.equal(fractions.size, 2, "an equal pair still gets a size chart");
  assert.equal(fractions.get("aren"), 1);
  assert.equal(fractions.get("amira"), 1);

  // The cast list's own people carry no estimate at all: still equal.
  const bare = relativeHeightsText([person("Aren", { ageYears: 2 }), person("Amira", { ageYears: 2, heightCm: 95 })]);
  assert.match(bare, /exactly the same height/, bare);
}

// --- Half a year apart is a small, stated difference, not a tie and not a giant gap ---
{
  const text = relativeHeightsText([person("Aren", { ageYears: 2.5 }), person("Amira", { ageYears: 2 })]);
  assert.match(text, /Aren is the tallest; Amira comes up to the eyes of Aren/, text);
}

// --- An adult and a child still differ, with landmarks ---
{
  const text = relativeHeightsText([
    person("Dad", { ageYears: 35, heightCm: 185 }),
    person("Amanda", { ageYears: 5 }),
  ]);
  assert.match(text, /Dad is the tallest; Amanda comes up to the waist of Dad/, text);
  assert.match(text, /Dad 185cm/, text);
}

// --- Two adults keep their own estimates (age says nothing about adult height) ---
{
  const text = relativeHeightsText([
    person("Mom", { ageYears: 34, heightCm: 165 }),
    person("Dad", { ageYears: 36, heightCm: 188 }),
  ]);
  assert.match(text, /Dad is the tallest; Mom comes up to the chin of Dad/, text);
}

// --- Twins beside a parent are one group with plural wording ---
{
  const text = relativeHeightsText([
    person("Dad", { ageYears: 35, heightCm: 185 }),
    person("Aren", { ageYears: 5 }),
    person("Amira", { ageYears: 5, heightCm: 130 }),
  ]);
  assert.match(text, /Dad is the tallest; Aren and Amira each come up to the waist of Dad/, text);
  const fractions = heightFractions([person("Dad", { ageYears: 35, heightCm: 185 }), person("Aren", { ageYears: 5 }), person("Amira", { ageYears: 5 })]);
  assert.equal(fractions.get("aren"), fractions.get("amira"), "tied characters share one fraction");
}

// --- A toy or creature that is not on the human curve keeps its own size ---
{
  const teddy = person("Teddy", { ageYears: 5, heightCm: 30 });
  const child = person("Mila", { ageYears: 5 });
  const text = relativeHeightsText([child, teddy]);
  assert.match(text, /Mila is the tallest; Teddy comes up to the knee of Mila/, text);
}

// --- Animals are not sized like children, and a lone character says nothing ---
{
  const pet = person("Pip", { ageYears: 4, bodyPlan: "quadruped" });
  assert.equal(relativeHeightsText([person("Mila", { ageYears: 5 }), pet]), "");
  assert.equal(relativeHeightsText([person("Mila", { ageYears: 5 })]), "");
  assert.equal(heightFractions([person("Mila", { ageYears: 5 })]).size, 0);

  const tall = person("Rex", { ageYears: 4, bodyPlan: "quadruped", heightCm: 60 });
  const text = relativeHeightsText([person("Dad", { ageYears: 35, heightCm: 180 }), tall]);
  assert.match(text, /Rex comes up to the knee of Dad/, "a four-legged animal stands on the ground, so a landmark applies");

  const fish = person("Fin", { ageYears: 4, bodyPlan: "aquatic", heightCm: 90 });
  const fishText = relativeHeightsText([person("Dad", { ageYears: 35, heightCm: 180 }), fish]);
  assert.match(fishText, /Fin is about half as tall as Dad/, fishText);
}

// --- Places and objects never take part ---
{
  const place: Anchor = { ...person("Garden", { ageYears: 5 }), type: "place" };
  assert.equal(relativeHeightsText([person("Mila", { ageYears: 5 }), place]), "");
}

// --- Editing an age must not leave the old age's estimate behind ---
{
  const child = person("Aren", { ageYears: 2, heightCm: 86 });
  assert.equal(heightAfterAgeChange(child, 8), undefined, "an estimate that restated the old age goes");
  const teddy = person("Teddy", { ageYears: 5, heightCm: 30 });
  assert.equal(heightAfterAgeChange(teddy, 6), 30, "a toy keeps its size");
  const dad = person("Dad", { ageYears: 35, heightCm: 185 });
  assert.equal(heightAfterAgeChange(dad, 40), 185, "an adult stays the height they are");
  assert.equal(heightAfterAgeChange(dad, 10), undefined, "an adult made a child follows the new age");
  assert.equal(heightAfterAgeChange(person("Mila", { ageYears: 5 }), 6), undefined, "nothing to keep");
}

// --- The curve itself: monotonic, and a two-year-old is toddler-sized ---
{
  let last = 0;
  for (let age = 0; age <= 20; age += 0.5) {
    const cm = humanHeightCm(age);
    assert.ok(cm >= last, `height must not shrink with age (${age})`);
    last = cm;
  }
  assert.ok(humanHeightCm(2) > 80 && humanHeightCm(2) < 92, "a two-year-old is about 86cm");
  assert.ok(humanHeightCm(35) > 165 && humanHeightCm(35) < 180);
}

// --- The prompt tells the model what may and may not change with perspective ---
{
  const prompts = createDefaultPromptsConfig();
  const dump = JSON.stringify(prompts);
  assert.match(dump, /same distance from the viewer/);
  assert.doesNotMatch(dump, /whoever is nearer the camera/);
}

console.log("character-scale invariants passed");
