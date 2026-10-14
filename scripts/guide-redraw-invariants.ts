/**
 * Invariants for a typed change to someone's picture, and for twins' ages.
 *
 * The report that started these: Arthur and Amanda are twins; Arthur was set
 * to 3 and Amanda was estimated at 6. With Amanda's portrait selected the
 * parent typed "Amanda is 3 years old. Redraw her." Her age stayed 6, the old
 * picture was edited instead of drawn anew, and the whole sentence was kept as
 * a note for every later picture of her. Each of those is a claim here:
 *
 * - a plainly stated age is applied, selected picture or not, before any redraw;
 * - a person whose age or kind changed gets a new picture, never an edit;
 * - only how someone should look is kept on them, never a fact or "redraw her";
 * - twins move together: one stated age carries to the other, and the reading
 *   records twins the story only implies, from words that are really in it;
 * - a card on screen stays there while a turn runs, a line is phrased, the
 *   guide replies or the reader writes in the story.
 *
 * Offline and deterministic: pure functions over synthesized books.
 */
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import type { CommandCall, CommandContext } from "../books-frontend/src/core/guide/agent/types";
import { changePersonAge } from "../books-frontend/src/core/guide/ageSync";
import { wellStage } from "../books-frontend/src/core/guide/conversation";
import { createDefaultGuideFactPolicies } from "../books-frontend/src/core/guide/factPolicy";
import { deriveJourney } from "../books-frontend/src/core/guide/journey";
import { manuscriptHash, sanitizeManuscriptCast, withAnalysisCharacters, withManuscriptCast } from "../books-frontend/src/core/guide/ownWords";
import { agedPortraits, PICTURE_CHOICE_COMMANDS } from "../books-frontend/src/core/guide/pictureSettling";
import { currentPortrait, portraitInputs, portraitIsCurrent, portraitStatus } from "../books-frontend/src/core/guide/portrait";
import { ageShiftMatters } from "../books-frontend/src/core/guide/visualAge";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { asksForRedraw, identityChanged, redrawModeFor, visualChange } from "../books-frontend/src/core/guide/redrawMode";
import { guideMessage } from "../books-frontend/src/core/guide/session";
import { statedAgeCalls } from "../books-frontend/src/core/guide/statedAges";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { relationsOf } from "../books-frontend/src/core/story/relations";
import { createDefaultConfig, type Project, type StoryCastMember } from "../books-frontend/src/core/types";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

const ctx: CommandContext = { now: 1, guest: false, styles: [], languages: [] };
const STORY =
  "My name is Arthur. This is my mom. She grew TWO people in her tummy at the same time, myself and my sister, Amanda. Can you believe that?";

function book(cast: StoryCastMember[]): Project {
  const project: Project = {
    id: "redraw-book",
    title: "",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: {
      ...createDefaultConfig(),
      storyText: STORY,
      styleReady: true,
      storyBrief: { ...createDefaultStoryBrief("own"), cast },
    },
  };
  return withAuthoring(project, {
    entry: "own",
    manuscriptReadyAt: 1,
    extraction: { storyHash: manuscriptHash(STORY), at: 1, names: cast.map((m) => m.name), unresolved: [] },
  });
}

function castOf(project: Project): StoryCastMember[] {
  return project.config.storyBrief?.cast ?? [];
}

function member(project: Project, name: string): StoryCastMember {
  return castOf(project).find((m) => m.name === name)!;
}

/** The book with a portrait drawn of this person as they are now. */
function drawn(project: Project, castId: string): Project {
  const person = castOf(project).find((m) => m.id === castId)!;
  const image = { blobId: `p-${castId}`, mimeType: "image/png", createdAt: 1, inputs: portraitInputs(project, person) };
  return withAuthoring(project, {
    portraits: { ...(authoringOf(project).portraits ?? {}), [castId]: createVersionTree(image) },
  });
}

function written(result: ReturnType<(typeof GUIDE_COMMANDS)["setPersonAge"]["run"]>): Project | null {
  return result.kind === "write" ? result.project : null;
}

const arthur: StoryCastMember = { id: "a", name: "Arthur", age: 3 };
const amanda: StoryCastMember = { id: "m", name: "Amanda", role: "my sister", visualAge: { years: 6, source: "suggested" } };
const twins = (project: Project): Project => ({
  ...project,
  config: {
    ...project.config,
    storyBrief: { ...project.config.storyBrief!, relations: [{ ids: ["a", "m"], type: "twins" }] },
  },
});

// --- What a message keeps on the person ---------------------------------------------------------

{
  check(visualChange("Amanda is 3 years old. Redraw her.") === "", "An age and 'redraw her' were kept as a look.");
  check(visualChange("She's 3. Draw her again.") === "", "'She's 3. Draw her again.' was kept as a look.");
  check(visualChange("Make her hair blue.") === "Make her hair blue.", "A real look change was dropped.");
  check(
    visualChange("Amanda is 3 years old. Give her a red dress.") === "Give her a red dress.",
    "The look in a message with an age was not kept on its own.",
  );
  check(visualChange("Make her look 3 years old") === "Make her look 3 years old", "Looking an age is a look, and was dropped.");
  check(asksForRedraw("Amanda is 3 years old. Redraw her."), "'Redraw her.' after a fact did not count as a redraw.");
  check(!asksForRedraw("Make her hair blue."), "A look change counted as a redraw.");
}

// --- A changed person gets a new picture --------------------------------------------------------

{
  const start = drawn(book([arthur, amanda]), "m");
  const target = { kind: "person" as const, castId: "m", name: "Amanda" };
  check(!identityChanged(start, "m"), "A portrait drawn just now looks like a different person.");
  check(redrawModeFor(start, target) === "edit", "A look change to a current portrait does not edit it.");
  const younger = written(GUIDE_COMMANDS.setPersonAge.run(start, { person: "Amanda", age: "3" }, ctx))!;
  check(member(younger, "Amanda").age === 3, "setPersonAge did not set Amanda to 3.");
  check(identityChanged(younger, "m"), "A six-year-old portrait still counts as Amanda after she became 3.");
  check(redrawModeFor(younger, target) === "new", "A redraw after an age change edits the old face instead of drawing anew.");

  const asDog = {
    ...start,
    config: {
      ...start.config,
      storyBrief: {
        ...start.config.storyBrief!,
        cast: castOf(start).map((m) => (m.id === "m" ? { ...m, kind: "animal" as const, species: "dog" } : m)),
      },
    },
  };
  check(redrawModeFor(asDog, target) === "new", "A person who became a dog has her portrait edited.");
}

// --- The message from the report ------------------------------------------------------------------

{
  const start = drawn(book([arthur, amanda]), "m");
  const selected = { castId: "m", name: "Amanda" };
  const message = "Amanda is 3 years old. Redraw her.";

  const fromNothing = statedAgeCalls(message, start, selected, []);
  check(
    fromNothing[0]?.id === "setPersonAge" && fromNothing[0].args.person === "Amanda" && fromNothing[0].args.age === "3",
    "An age the reading missed was not set first.",
  );
  check(
    fromNothing[1]?.id === "editPersonLook" && fromNothing[1].args.mode === "new",
    "The redraw in the same message was not asked as a new picture after the age.",
  );
  check(statedAgeCalls(message.toLowerCase(), start, null, []).length === 2, "A lowercase message lost the age.");
  check(
    statedAgeCalls("She's 3 years old. Redraw her.", start, selected, [])[0]?.args.person === "Amanda",
    "'She's 3 years old' with Amanda selected was not Amanda's age.",
  );
  check(statedAgeCalls("She's 3 years old.", start, null, []).length === 0, "'She' with nobody selected was given to someone.");

  const modelCalls: CommandCall[] = [
    { id: "setPersonAge", args: { person: "Amanda", age: "3" }, evidence: "Amanda is 3 years old", confidence: 0.9, source: "model" },
    { id: "editPersonLook", args: { person: "Amanda", change: "Redraw her", mode: "new" }, evidence: "Redraw her", confidence: 0.9, source: "model" },
  ];
  check(statedAgeCalls(message, start, selected, modelCalls).length === 0, "The backstop repeated what the reading already asked.");
  const already = written(GUIDE_COMMANDS.setPersonAge.run(start, { person: "Amanda", age: "3" }, ctx))!;
  check(statedAgeCalls("Amanda is 3 years old.", already, null, []).length === 0, "An age the book already has was set again.");

  // Running the calls in order: the age lands, the portrait redraws anew, and nothing is noted.
  let project = start;
  let redraw: { mode?: string; instruction: string } | null = null;
  for (const call of fromNothing) {
    const result = GUIDE_COMMANDS[call.id].run(project, call.args, ctx);
    if (result.kind !== "write") continue;
    project = result.project;
    if (result.then?.kind === "redraw") redraw = result.then;
  }
  check(member(project, "Amanda").age === 3, "After the message Amanda is not 3.");
  check(!member(project, "Amanda").portraitNote, "The sentence was kept as a note on Amanda.");
  check(redraw?.mode === "new" && redraw.instruction === "", "The redraw was not a new picture with nothing to paint on.");

  const blue = GUIDE_COMMANDS.editPersonLook.run(start, { person: "Amanda", change: "Make her hair blue" }, ctx);
  check(
    blue.kind === "write" && blue.then?.kind === "redraw" && !blue.then.mode && member(blue.project, "Amanda").portraitNote === "Make her hair blue",
    "A look change no longer edits the portrait and keeps the change.",
  );

  // A note from before this rule is read without the fact in it.
  const noted = {
    ...start,
    config: {
      ...start.config,
      storyBrief: {
        ...start.config.storyBrief!,
        cast: castOf(start).map((m) => (m.id === "m" ? { ...m, portraitNote: "Amanda is 3 years old. Redraw her." } : m)),
      },
    },
  };
  check(!JSON.parse(portraitInputs(noted, member(noted, "Amanda")).sourceKey).some((part: unknown) => typeof part === "object"), "An old note with only a fact still reaches the portrait.");
}

// --- Twins share an age -------------------------------------------------------------------------

{
  const start = twins(book([{ ...arthur, age: undefined, visualAge: { years: 5, source: "suggested" } }, amanda]));
  const changed = changePersonAge(start, "a", { age: 3 })!;
  check(member(changed.project, "Amanda").age === 3, "Setting Arthur to 3 left his twin at her estimate.");
  check(changed.alongside.includes("Amanda"), "The twin who moved along is not reported.");

  const later = changePersonAge(changed.project, "a", { age: 4 })!;
  check(member(later.project, "Amanda").age === 4, "Twins who agreed fell out of step on the next change.");

  const apart = {
    ...start,
    config: {
      ...start.config,
      storyBrief: {
        ...start.config.storyBrief!,
        cast: castOf(start).map((m) => (m.id === "m" ? { ...m, age: 6, visualAge: undefined } : m)),
      },
    },
  };
  check(member(changePersonAge(apart, "a", { age: 3 })!.project, "Amanda").age === 6, "A twin the family gave her own age was overwritten.");

  const unaged = twins(book([arthur, { id: "m", name: "Amanda", role: "my sister" }, { id: "d", name: "Dad" }]));
  const card = deriveJourney(unaged, createDefaultGuideFactPolicies());
  const ages = card.open.find((item) => item.kind === "castAges");
  const shown = ages?.kind === "castAges" ? ages.people.find((p) => p.name === "Amanda") : undefined;
  check(Boolean(ages), "The ages card did not open for people with no age.");
  check(shown?.years === 3, "The ages card leaves Amanda blank although her twin is 3.");
  check(shown?.mates?.includes("a") === true, "The ages card does not know Amanda and Arthur move together.");

  const estimates = withAnalysisCharacters(
    twins(book([{ id: "a", name: "Arthur" }, { id: "m", name: "Amanda" }])),
    [
      { name: "Arthur", type: "character", ageYears: 5 },
      { name: "Amanda", type: "character", ageYears: 6 },
    ],
  );
  check(member(estimates, "Arthur").visualAge?.years === member(estimates, "Amanda").visualAge?.years, "Twins were estimated at different ages.");
}

// --- The reading records twins the story implies ------------------------------------------------

{
  const raw = {
    people: [
      { name: "Arthur", confidence: 0.95 },
      { name: "Amanda", role: "my sister", confidence: 0.95 },
    ],
    unclear: [],
    relations: [
      { names: ["Arthur", "Amanda"], type: "twins" as const, evidence: "She grew TWO people in her tummy at the same time, myself and my sister, Amanda." },
      { names: ["Arthur", "Amanda"], type: "siblings" as const, evidence: "They were born in different years." },
    ],
  };
  const found = sanitizeManuscriptCast(raw, STORY);
  check(found.relations?.length === 1 && found.relations[0]!.type === "twins", "A relation was kept whose words are not in the story, or the real one was dropped.");
  const read = withManuscriptCast(book([]), { ...found, people: found.people.map((p) => (p.name === "Arthur" ? { ...p, age: 3 } : p)) }, STORY);
  const relations = relationsOf(read.config.storyBrief!);
  check(relations.some((r) => r.type === "twins" && r.ids.length === 2), "The reading did not record the twins.");
  check(member(read, "Amanda").age === 3, "The twin of a person the story gives an age did not get it.");
}

// --- A card on screen stays ---------------------------------------------------------------------

{
  const asked = guideMessage("guide", "What should the cover say?", { keys: ["askCoverWordsOwn"], well: "coverWords" });
  const typed = guideMessage("reader", "Amanda is 3 years old. Redraw her.");
  const reply = guideMessage("guide", "Shall I draw her again?", { keys: ["reply"] });
  const pending = { ...guideMessage("guide", "Everyone's portraits are ready.", { keys: ["portraitsDone"] }), pending: true };
  const base = { topic: "coverWords", kind: "coverWords", hasIntro: true, canAnswer: true, locale: "en-US" };
  const situations: [string, Parameters<typeof wellStage>[0]["messages"], boolean][] = [
    ["a typed message being answered", [asked, typed], true],
    ["a line being phrased", [asked, pending], false],
    ["the guide's reply with a question", [asked, typed, reply], false],
  ];
  for (const [what, messages, busy] of situations) {
    check(wellStage({ ...base, messages, busy }) !== "show", `Without the on-screen rule, ${what} already kept the card (the check is stale).`);
    check(wellStage({ ...base, messages, busy, onScreen: true }) === "show", `The cover card left the screen during ${what}.`);
  }
}

// --- When a change of age changes the picture -----------------------------------------------------

{
  const years = (age: number | null) => ({ age });
  const matters = (from: number | null, to: number | null) => ageShiftMatters(years(from), years(to));
  check(matters(2, 3), "Two becoming three did not change the picture.");
  check(matters(3, 4) && matters(5, 6), "A child growing a year did not change the picture.");
  check(matters(12, 13) && matters(13, 12), "Twelve and thirteen were not judged the same both ways.");
  check(!matters(35, 36), "A grown-up's birthday changed the picture.");
  check(!matters(40, 49) && matters(40, 50), "The adult rule is not a decade.");
  check(!matters(14, 15) && matters(14, 16), "A teenager is not judged by two years.");
  check(!matters(30, 30), "The same age counted as a change.");
  check(!matters(null, null), "Two unknown ages counted as a change.");
  check(matters(null, 5) && matters(5, null), "Learning an age that was unknown did not count as a change.");
  check(ageShiftMatters({ months: 9 }, { months: 10 }) === false, "A baby month-and-a-half apart was redrawn.");
  check(ageShiftMatters({ months: 9 }, { months: 11 }), "A baby two months older was not redrawn.");
  check(ageShiftMatters({ months: 18 }, { months: 24 }), "A toddler half a year older was not redrawn.");
  check(!ageShiftMatters({ months: 18 }, { months: 23 }), "A toddler five months older was redrawn.");
  check(!ageShiftMatters({ visualYears: 35 }, { age: 36 }), "A story estimate and a stated age a year apart were told apart.");

  // A portrait follows the rule; its stored signature stays as it was drawn.
  const grown = (project: Project, id: string, age: number): Project => ({
    ...project,
    config: {
      ...project.config,
      storyBrief: {
        ...project.config.storyBrief!,
        cast: castOf(project).map((m) => (m.id === id ? { ...m, age, visualAge: undefined } : m)),
      },
    },
  });
  const mia: StoryCastMember = { id: "i", name: "Mia", age: 2 };
  const mum: StoryCastMember = { id: "u", name: "Mum", age: 35, role: "my mum" };
  const start = drawn(drawn(book([mia, mum]), "i"), "u");
  check(portraitStatus(start, "i") === "current", "A portrait drawn just now is not current.");
  check(portraitStatus(grown(start, "i", 3), "i") === "stale", "A two-year-old's portrait stayed current at three.");
  check(portraitStatus(grown(start, "u", 36), "u") === "current", "A grown-up's portrait went out of date after a year.");
  check(portraitStatus(grown(start, "u", 45), "u") === "stale", "A grown-up's portrait stayed current after ten years.");
  const oldSignature = currentPortrait(start, "u")!.inputs.subjectSignature;
  check(oldSignature === currentPortrait(grown(start, "u", 36), "u")!.inputs.subjectSignature, "The stored signature was rewritten.");
  check(JSON.parse(oldSignature).age === 35, "The signature does not keep the age it was drawn at.");

  // Who gets drawn again without being asked.
  const names = (before: Project, after: Project) => agedPortraits(before, after).map((p) => p.name);
  check(names(start, grown(start, "i", 4)).join() === "Mia", "A child who changed age was not found.");
  check(names(start, grown(start, "u", 36)).length === 0, "A grown-up's birthday was found.");
  check(names(start, grown(start, "u", 55)).join() === "Mum", "A grown-up who aged twenty years was not found.");
  check(names(grown(start, "i", 3), grown(start, "i", 4)).length === 0, "A portrait that was already out of date was found again.");
  check(names(start, start).length === 0, "A book nobody changed has people to draw.");

  const asDog = (project: Project, id: string): Project => ({
    ...project,
    config: {
      ...project.config,
      storyBrief: {
        ...project.config.storyBrief!,
        cast: castOf(project).map((m) => (m.id === id ? { ...m, kind: "animal" as const, species: "dog" } : m)),
      },
    },
  });
  check(names(start, asDog(start, "u")).join() === "Mum", "Somebody who became a dog was not found.");

  const reRole: Project = {
    ...start,
    config: {
      ...start.config,
      storyBrief: {
        ...start.config.storyBrief!,
        cast: castOf(start).map((m) => (m.id === "u" ? { ...m, role: "my aunt" } : m)),
      },
    },
  };
  check(portraitStatus(reRole, "u") === "stale", "A new role left the portrait current (the check is stale).");
  check(names(start, reRole).length === 0, "A new role was drawn without being asked.");

  const locked = withAuthoring(grown(start, "i", 4), { lockedAt: 1 });
  check(names(start, locked).length === 0, "A locked book was redrawn.");

  const fromPhoto = withAuthoring(start, {
    portraits: {
      ...(authoringOf(start).portraits ?? {}),
      i: createVersionTree({
        ...currentPortrait(start, "i")!,
        inputs: { ...currentPortrait(start, "i")!.inputs, sourceKey: '["photo",1]' },
      }),
    },
  });
  check(names(fromPhoto, grown(fromPhoto, "i", 4)).length === 0, "A portrait drawn from a photo that is gone was drawn from words.");

  for (const id of ["setStyle", "describePerson", "choosePersonLook", "editPersonLook"] as const) {
    check(PICTURE_CHOICE_COMMANDS.has(id), `${id} no longer starts the portraits it makes possible.`);
  }
  check(!PICTURE_CHOICE_COMMANDS.has("setPersonAge"), "An age counts as a choice of look.");
}

report.push("Typed picture changes and twins");
report.push("  a stated age is applied before the redraw; a changed person gets a new picture");
report.push("  notes keep only looks; twins move together; a card on screen stays");
notes.push("Redraw: stated ages, identity redraws, note hygiene, twin ages, the reading's twins and on-screen cards checked");

export function checkGuideRedraw(): CheckResult {
  return { failures, notes, report, cases };
}
