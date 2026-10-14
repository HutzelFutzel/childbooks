/**
 * Invariants for who is in the story: children, pets, toys and creatures, and
 * how they belong together.
 *
 * The claims worth checking are the ones a parent would notice:
 *
 * - a dog or a teddy is never asked its age, and a person always is;
 * - "what kind of animal is Bello?" is asked when nobody said, and the story
 *   waits for it the way it waits for an age;
 * - the reading age comes from the first person, never from a pet listed first;
 * - the story prompt and the portrait say what a character is;
 * - "Myla and Shilo are twins" reaches the story, the ages and the portraits,
 *   and the looks step asks once whether they look alike.
 *
 * Offline and deterministic: pure functions over synthesized books.
 */
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import { REQUIREMENTS } from "../books-frontend/src/core/guide/agent/requirements";
import type { CommandContext } from "../books-frontend/src/core/guide/agent/types";
import { personFollowUp } from "../books-frontend/src/core/guide/agent/followUps";
import { createDefaultGuideAgentConfig } from "../books-frontend/src/core/config/guideAgent";
import { createDefaultGuideFactPolicies, missingGuideFacts } from "../books-frontend/src/core/guide/factPolicy";
import { deriveJourney, styleChoiceOpen } from "../books-frontend/src/core/guide/journey";
import { statedCast } from "../books-frontend/src/core/guide/castList";
import { applyGuidePatch, guidePatchContext } from "../books-frontend/src/core/guide/patch";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { resolvePromptsConfig } from "../books-frontend/src/core/prompts/context";
import { portraitInputs, portraitPrompt, portraitStatus, withLooksDecided } from "../books-frontend/src/core/guide/portrait";
import { renamePersonEverywhere } from "../books-frontend/src/core/guide/rename";
import { anchorSignature } from "../books-frontend/src/core/pipeline/provenance";
import { staleAnchorIds } from "../books-frontend/src/core/book/anchorFreshness";
import { createVersionTree, getCursor } from "../books-frontend/src/core/versioning";
import {
  audienceSourceCharacter,
  castPromptLines,
  createDefaultStoryBrief,
  heroesLine,
  isBriefReady,
  storyBriefSignature,
} from "../books-frontend/src/core/story/brief";
import { missingDetails } from "../books-frontend/src/core/story/castKinds";
import { relationsOf, twinsToAsk } from "../books-frontend/src/core/story/relations";
import { createDefaultConfig, type Project, type StoryCastMember } from "../books-frontend/src/core/types";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

const policies = createDefaultGuideFactPolicies();
const ctx: CommandContext = { now: 1, guest: false, styles: [], languages: [] };
const patchContext = guidePatchContext({});

function book(cast: StoryCastMember[], storyText = ""): Project {
  return withAuthoring(
    {
      id: "cast-book",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      stage: "setup",
      furthestStage: "setup",
      config: {
        ...createDefaultConfig(),
        storyText,
        styleReady: false,
        storyBrief: { ...createDefaultStoryBrief("guided"), cast },
      },
    },
    { entry: "guided", askedFacts: ["names", "ages"] },
  );
}

const castOf = (project: Project): StoryCastMember[] => project.config.storyBrief?.cast ?? [];
const maya: StoryCastMember = { id: "c1", name: "Maya", age: 5 };
const bello: StoryCastMember = { id: "c2", name: "Bello", kind: "animal", species: "golden retriever" };

// --- Kinds decide what is asked ----------------------------------------------------------------------

{
  check(missingDetails({ ...bello }).length === 0, "A golden retriever is asked for an age.");
  check(missingDetails({ id: "x", name: "Fluffy", kind: "toy" }).includes("species"), "A toy with no kind of toy isn't asked what it is.");
  check(missingDetails({ id: "x", name: "Leo" }).includes("age"), "A person without an age isn't asked for one.");
  check(
    missingDetails({ id: "x", name: "Frog", bodyPlan: "aquatic", appearance: "a small green frog" }).length === 0,
    "An older book's frog, described by its story, is asked for an age or a kind.",
  );

  const withDog = book([maya, bello]);
  check(isBriefReady(withDog.config.storyBrief!), "A child with an age and a named dog can't have a story.");
  check(missingGuideFacts(withDog, policies).length === 0, "The chat still asks for something when a child and a dog are complete.");
  check(REQUIREMENTS.castAges.met(withDog, ctx), "Portraits wait for the dog's age.");

  const unknownToy = book([maya, { id: "c3", name: "Fluffy", kind: "toy" }]);
  check(!isBriefReady(unknownToy.config.storyBrief!), "The story starts before anyone said what Fluffy is.");
  check(missingGuideFacts(unknownToy, policies).includes("ages"), "An unknown toy doesn't hold the story like a missing age.");
  const remedy = !REQUIREMENTS.castAges.met(unknownToy, ctx) ? REQUIREMENTS.castAges.remedy(unknownToy) : null;
  check(remedy?.command === "setPersonKind", "The portraits remedy for an unknown toy isn't setPersonKind.");

  const dogFirst = book([{ ...bello, age: 9 }, maya]);
  check(audienceSourceCharacter(castOf(dogFirst))?.id === "c1", "A dog listed first sets the reading age.");
}

// --- The interpreter's writes ------------------------------------------------------------------------

{
  const fresh = book([]);
  const said = applyGuidePatch(
    fresh,
    { heroes: [{ name: "Maya", age: 5 }, { name: "Bello", role: "Maya's dog", kind: "animal", species: "dog" }] },
    patchContext,
  );
  const dog = castOf(said.project).find((m) => m.name === "Bello");
  check(dog?.kind === "animal" && dog.species === "dog", "Naming a dog in the cast drops what he is.");
  check(said.applied.includes("heroes"), "Naming a dog with his kind isn't applied.");
  const again = applyGuidePatch(said.project, { heroes: [{ name: "Maya" }, { name: "Bello" }] }, patchContext);
  check(castOf(again.project).find((m) => m.name === "Bello")?.kind === "animal", "Re-listing the cast forgets the dog is a dog.");

  const kinds = applyGuidePatch(book([maya, { id: "c3", name: "Fluffy" }]), { castKinds: [{ name: "Fluffy", kind: "toy", species: "teddy bear" }] }, patchContext);
  const toy = castOf(kinds.project).find((m) => m.name === "Fluffy");
  check(toy?.kind === "toy" && toy.species === "teddy bear", "castKinds doesn't make Fluffy a teddy bear.");
  const stranger = applyGuidePatch(book([maya]), { castKinds: [{ name: "Rex", kind: "animal", species: "dog" }] }, patchContext);
  check(stranger.rejected.some((r) => r.key === "castKinds"), "castKinds invents a character the book never had.");

  const twins = book([{ id: "m", name: "Myla", age: 4 }, { id: "s", name: "Shilo" }]);
  const related = applyGuidePatch(twins, { relations: [{ names: ["Myla", "Shilo"], type: "twins" }] }, patchContext);
  check(relationsOf(related.project.config.storyBrief!).length === 1, "'They are twins' leaves no relation on the book.");
  check(castOf(related.project).find((m) => m.id === "s")?.age === 4, "Twins don't share the age that was given.");
  check((authoringOf(related.project).sameAge ?? []).length === 1, "Twins aren't remembered as the same age.");
  const restated = applyGuidePatch(related.project, { relations: [{ names: ["Myla", "Shilo"], type: "twins" }] }, patchContext);
  check(restated.unchanged.includes("relations"), "Restating the twins counts as a change.");
}

// --- The story and the portraits know --------------------------------------------------------------

{
  const withDog = book([maya, bello]);
  const line = heroesLine(withDog.config.storyBrief!);
  check(/child called "Maya"/.test(line) && /"Bello" \(a golden retriever/.test(line), "The story prompt calls the dog a child, or leaves him out.");
  check(/never turn it into a person/.test(line), "The story prompt doesn't keep the dog a dog.");
  check(castPromptLines(withDog.config.storyBrief!).includes("golden retriever"), "The cast lines drop what Bello is.");

  const twins = applyGuidePatch(
    book([{ id: "m", name: "Myla", age: 4 }, { id: "s", name: "Shilo", age: 4 }]),
    { relations: [{ names: ["Myla", "Shilo"], type: "twins", lookAlike: "identical" }] },
    patchContext,
  ).project;
  check(/Myla and Shilo are identical twins/.test(castPromptLines(twins.config.storyBrief!)), "The story never hears that they are twins.");
  const before = book([{ id: "m", name: "Myla", age: 4 }, { id: "s", name: "Shilo", age: 4 }]);
  check(
    storyBriefSignature(before.config.storyBrief!, "3-5") !== storyBriefSignature(twins.config.storyBrief!, "3-5"),
    "Saying they are twins doesn't make the old draft stale.",
  );

  const prompts = resolvePromptsConfig(null);
  const dogPrompt = portraitPrompt(withDog, bello, prompts);
  check(/is an animal: a golden retriever/.test(dogPrompt), "The dog's portrait prompt doesn't say he is a dog.");
  const twinPrompt = portraitPrompt(twins, castOf(twins)[1]!, prompts);
  check(/identical twin/.test(twinPrompt), "The second twin's portrait doesn't know she is an identical twin.");
  const untold = book([{ id: "m", name: "Myla", age: 4 }, { id: "s", name: "Shilo", age: 4 }]);
  check(
    portraitInputs(untold, castOf(untold)[1]!).subjectSignature !== portraitInputs(twins, castOf(twins)[1]!).subjectSignature,
    "A portrait drawn before 'identical twins' still counts as current.",
  );
  check(portraitInputs(book([maya]), maya).subjectSignature === JSON.stringify({ age: 5, months: null, visualAge: null, role: "" }), "A plain person's portrait signature changed, so every drawn portrait goes stale.");
}

/** The ids of pages whose recorded character descriptions or images no longer match (as `isIllustrationStale`). */
function pagesOutOfDate(project: Project): string[] {
  const byId = new Map((project.anchors ?? []).map((anchor) => [anchor.id, anchor]));
  return Object.entries(project.illustrations ?? {})
    .filter(([, tree]) =>
      (getCursor(tree).content.references ?? []).some((use) => {
        const anchor = byId.get(use.anchorId);
        if (!anchor) return true;
        if (!use.textOnly && (anchor.versions?.cursorId ?? undefined) !== use.versionId) return true;
        return use.signature !== undefined && use.signature !== anchorSignature(anchor);
      }),
    )
    .map(([id]) => id);
}

// --- A new name changes no look ------------------------------------------------------------------------
// The name is not a portrait input, a drawn page or character image stays current through a rename, and a
// portrait drawn when the name was part of its signature is not made stale by that either.

{
  const story = "Arthur found a shell. Arthur's shell was blue.";
  const base = book([{ id: "a", name: "Arthur", age: 6 }, { id: "b", name: "Brian", age: 4 }], story);
  const description = "Arthur is a small boy in a red coat.";
  const anchor = {
    id: "an1",
    name: "Arthur",
    type: "character",
    description,
    importance: "main",
    mode: "auto",
    include: true,
    ageYears: 6,
  } as unknown as NonNullable<Project["anchors"]>[number];
  const signatureThen = anchorSignature(anchor);
  const drawnAnchor = {
    ...anchor,
    versions: createVersionTree({ blobId: "sheet", mimeType: "image/png", references: [{ anchorId: "an1", signature: signatureThen, textOnly: true }] }),
  } as unknown as typeof anchor;
  const portraitFor = (project: Project, legacyName: boolean) => {
    const inputs = portraitInputs(project, castOf(project)[0]!);
    const signature = legacyName ? JSON.stringify({ name: "Arthur", ...JSON.parse(inputs.subjectSignature) }) : inputs.subjectSignature;
    return createVersionTree({ blobId: "face", mimeType: "image/png", inputs: { ...inputs, subjectSignature: signature }, createdAt: 1 });
  };
  const drawn = (legacyName: boolean): Project => {
    const plain: Project = { ...base, anchors: [drawnAnchor] };
    return {
      ...withAuthoring(plain, { portraits: { a: portraitFor(plain, legacyName) } }),
      illustrations: {
        s1: createVersionTree({ blobId: "page", mimeType: "image/png", references: [{ anchorId: "an1", versionId: drawnAnchor.versions!.cursorId, signature: signatureThen }] }),
      },
    } as unknown as Project;
  };

  for (const legacyName of [false, true]) {
    const label = legacyName ? "a portrait drawn with the name in its signature" : "a portrait";
    const before = drawn(legacyName);
    check(portraitStatus(before, "a") === "current", `${label} isn't current before the rename.`);
    check(pagesOutOfDate(before).length === 0, "A drawn page is stale before the rename.");

    const renamed = renamePersonEverywhere(before, "a", "shiloh");
    check(!("refused" in renamed), "The rename was refused.");
    if ("refused" in renamed) continue;
    check(renamed.to === "Shiloh", "The new name isn't capitalised.");
    check(castOf(renamed.project)[0]?.name === "Shiloh", "The cast card doesn't carry the new name.");
    check(renamed.project.config.storyText === "Shiloh found a shell. Shiloh's shell was blue.", "The story doesn't carry the new name.");
    check(renamed.project.anchors?.[0]?.description.startsWith("Shiloh is") === true, "The anchor's description doesn't carry the new name.");
    check(portraitStatus(renamed.project, "a") === "current", `Renaming makes ${label} out of date.`);
    check(pagesOutOfDate(renamed.project).length === 0, "Renaming makes a drawn page out of date.");
    check(staleAnchorIds(renamed.project).length === 0, "Renaming makes a character image out of date.");
    check(portraitStatus(renamed.project, "b") === "none", "Renaming one person gives another a portrait status.");
  }

  // Something that does change the look still does: a rename restamps only what the name touched.
  const aged = renamePersonEverywhere(drawn(false), "a", "Shiloh");
  if (!("refused" in aged)) {
    const older = { ...aged.project, config: { ...aged.project.config, storyBrief: { ...aged.project.config.storyBrief!, cast: castOf(aged.project).map((m) => (m.id === "a" ? { ...m, age: 9 } : m)) } } };
    check(portraitStatus(older, "a") === "stale", "A change of age no longer makes the portrait out of date.");
  }
  // A page already out of date stays so: the rename doesn't hide an earlier change.
  const staleBefore = drawn(false);
  const edited = { ...staleBefore, anchors: [{ ...staleBefore.anchors![0]!, userGuidance: "wears a hat" }] } as Project;
  check(pagesOutOfDate(edited).length === 1, "Editing a character's guidance doesn't make its page stale.");
  const editedRenamed = renamePersonEverywhere(edited, "a", "Shiloh");
  check(!("refused" in editedRenamed) && pagesOutOfDate(editedRenamed.project).length === 1, "A rename hides that a page was already out of date.");
}

// --- The looks step asks about twins once ------------------------------------------------------------

{
  const story = "Myla and Shilo found a door in the garden wall.";
  const twins = applyGuidePatch(
    book([{ id: "m", name: "Myla", age: 4 }, { id: "s", name: "Shilo" }], story),
    { relations: [{ names: ["Myla", "Shilo"], type: "twins" }] },
    patchContext,
  ).project;
  const journey = deriveJourney(twins, policies);
  check(journey.well?.kind === "lookAlike", "The looks step doesn't ask whether the twins look alike.");
  check(!styleChoiceOpen(twins, journey), "The style picker shows before the twins question is answered.");
  const answered = applyGuidePatch(twins, { relations: [{ names: ["Myla", "Shilo"], type: "twins", lookAlike: "different" }] }, patchContext).project;
  check(twinsToAsk(answered.config.storyBrief!).length === 0, "Answering the twins question doesn't settle it.");
  check(deriveJourney(answered, policies).well?.kind === "castLooks", "After the twins question, the looks aren't asked.");
  const settled = withLooksDecided(answered, ["m", "s"]);
  check(deriveJourney(settled, policies).well?.kind !== "lookAlike", "The twins question comes back.");
}

// --- Skills --------------------------------------------------------------------------------------------

{
  const add = GUIDE_COMMANDS.addPerson.run(book([maya]), { name: "Fluffy", kind: "toy", species: "teddy bear", id: "c9" }, ctx);
  const added = add.kind === "write" ? castOf(add.project).find((m) => m.name === "Fluffy") : undefined;
  check(added?.kind === "toy" && added.species === "teddy bear", "addPerson loses that Fluffy is a teddy bear.");
  const follow = add.kind === "write" ? personFollowUp(add.project, createDefaultGuideAgentConfig().people, ["c9"]) : null;
  check(follow?.beat.key !== "missingAges" && follow?.beat.key !== "missingAgesMany", "A teddy bear is asked for its age.");

  const bare = GUIDE_COMMANDS.addPerson.run(book([maya]), { name: "Rex", kind: "animal", id: "c8" }, ctx);
  const ask = bare.kind === "write" ? personFollowUp(bare.project, createDefaultGuideAgentConfig().people, ["c8"]) : null;
  check(ask?.beat.key === "missingKind", "An animal with no kind isn't asked what kind of animal it is.");

  const kind = GUIDE_COMMANDS.setPersonKind.run(book([maya, { id: "c3", name: "Spark" }]), { person: "Spark", kind: "creature", species: "dragon" }, ctx);
  check(kind.kind === "write" && castOf(kind.project).find((m) => m.id === "c3")?.species === "dragon", "setPersonKind doesn't make Spark a dragon.");

  const relation = GUIDE_COMMANDS.setRelation.run(
    book([{ id: "m", name: "Myla", age: 4 }, { id: "s", name: "Shilo" }]),
    { people: "Myla, Shilo", type: "twins", lookAlike: "identical" },
    ctx,
  );
  check(
    relation.kind === "write" && relationsOf(relation.project.config.storyBrief!)[0]?.lookAlike === "identical",
    "setRelation doesn't record identical twins.",
  );
  check(relation.kind === "write" && castOf(relation.project).find((m) => m.id === "s")?.age === 4, "setRelation's twins don't share an age.");
}

// --- "shiloh, 2" is one child, aged 2 ------------------------------------------------

{
  const one = statedCast("shiloh, 2");
  check(one?.length === 1 && one[0]?.name === "Shiloh" && one[0]?.age === 2, '"shiloh, 2" is not Shiloh, age 2.');
  check(statedCast("shiloh 2")?.[0]?.age === 2, '"shiloh 2" is not an age.');
  const two = statedCast("Maya 5, Leo 3");
  check(two?.length === 2 && two[0]?.name === "Maya" && two[1]?.age === 3, "A list of two children with ages was dropped.");
  check(statedCast("shiloh, 18 months")?.[0]?.ageMonths === 18, "Months were stored as years.");
  check(statedCast("Micah and Neil, both 5 years old") === null, '"both 5" was read as a cast list.');
  check(statedCast("What about a dog?") === null, "A question was read as a cast list.");
  check(statedCast("2") === null, "A bare number became a person.");
  const written = applyGuidePatch(
    book([]),
    { heroes: (one ?? []).map((person) => ({ name: person.name, age: person.age })) },
    patchContext,
  );
  const shiloh = castOf(written.project).find((member) => member.name === "Shiloh");
  check(shiloh?.age === 2 && castOf(written.project).length === 1, "Writing shiloh, 2 did not leave one child aged 2.");
  check(!missingGuideFacts(written.project, policies).includes("names"), "Shiloh was written and the guide still asks who is in the book.");
  check(!missingGuideFacts(written.project, policies).includes("ages"), "Shiloh's age was written and the guide still asks for an age.");
}

report.push("Characters and how they belong together");
report.push("  people are asked an age, pets, toys and creatures what they are; the reading age comes from a person");
report.push("  twins reach the story, the shared age and the portraits, and the looks step asks once if they look alike");
notes.push("Characters: kinds, species questions, relations, twins look-alike and the skills checked");

export function checkGuideCast(): CheckResult {
  return { failures, notes, report, cases };
}
