/**
 * Invariants for people the parent names who are not in the book yet.
 *
 * What a parent would notice, and what these hold:
 *
 * - "our friends Luca and Nile" and "our dog Rex" are people to add, found without asking anyone;
 * - whoever the interpreter reports is believed only with the words that name them;
 * - nobody is added twice (a nickname counts), against the parent's word (removed, or removed this turn),
 *   to an empty or a finished book, or past the cap;
 * - the story is rewritten only for people it does not speak of, and "Lucas Mama" speaks of Luca;
 * - an up-to-date story stays up to date when it already speaks of the people added;
 * - twins who are a boy and a girl are not asked whether they are identical, and the question reads plainly.
 *
 * Offline and deterministic.
 */
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import { resolvePerson } from "../books-frontend/src/core/guide/agent/resolve";
import { DEFAULT_GUIDE_COPY, GUIDE_COPY_HELP } from "../books-frontend/src/core/guide/copy";
import { namedExtras } from "../books-frontend/src/core/guide/mentions";
import {
  MAX_BOOK_CAST,
  addPeopleInstruction,
  joinedPeople,
  keepDraftCurrent,
  missingFromStory,
  peopleToAdd,
  sanitizeMentioned,
  storyOwedStatus,
  textMentions,
  withStoryOwed,
  roleOfMember,
  withAnchorsLinked,
  wordsMentioned,
} from "../books-frontend/src/core/guide/people";
import { addMentionedPeople } from "../books-frontend/src/core/guide/peopleAdd";
import { guidePatchContext, applyGuidePatch } from "../books-frontend/src/core/guide/patch";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { applyRestore, snapshotForFields } from "../books-frontend/src/core/guide/agent/restore";
import { createDefaultGuidePlaylist, resolveGuidePlaylist } from "../books-frontend/src/core/guide/playlist";
import { interpretGuideTurn } from "../books-frontend/src/core/pipeline/guideInterpret";
import { openaiTextProvider } from "../books-frontend/src/core/providers/openai";
import { briefOf, createDefaultStoryBrief, isDraftStale, namedCast, storyBriefSignature } from "../books-frontend/src/core/story/brief";
import { twinsToAsk } from "../books-frontend/src/core/story/relations";
import { createDefaultConfig, type Project, type StoryCastMember } from "../books-frontend/src/core/types";
import type { CommandContext } from "../books-frontend/src/core/guide/agent/types";
import { analyzeStory } from "../books-frontend/src/core/pipeline/analysis";
import { anchorsNamedIn } from "../books-frontend/src/core/book/pageCast";
import { withCastCharacters } from "../books-frontend/src/core/guide/castCharacters";
import { reconcileAnchorIds } from "../books-frontend/src/core/book/anchorRefs";
import { anchorsToPrepare } from "../books-frontend/src/core/book/anchorFreshness";
import { deriveJourney } from "../books-frontend/src/core/guide/journey";
import { createDefaultGuideFactPolicies } from "../books-frontend/src/core/guide/factPolicy";
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
const member = (id: string, name: string, extra: Partial<StoryCastMember> = {}): StoryCastMember => ({ id, name, ...extra });

function book(cast: StoryCastMember[], extra: { storyText?: string; removed?: string[]; locked?: boolean; sourceText?: string } = {}): Project {
  const base: Project = {
    id: "mentions-book",
    title: "",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: {
      ...createDefaultConfig(),
      storyText: extra.storyText ?? "",
      styleReady: false,
      storyBrief: { ...createDefaultStoryBrief("guided"), cast, ...(extra.sourceText ? { sourceText: extra.sourceText } : {}) },
    },
  };
  return withAuthoring(base, {
    entry: "guided",
    ...(extra.removed ? { removedNames: extra.removed } : {}),
    ...(extra.locked ? { lockedAt: 1 } : {}),
  });
}

const family = [member("a", "Aren", { age: 2 }), member("m", "Amira", { age: 2 }), member("p", "Papa"), member("n", "Anne")];

{
  // --- Friends and pets, in the one shape that cannot be mistaken -----------------------
  const extras = namedExtras("saying goodbye to our friends Luca and Nile, and our dog Rex waits");
  check(extras.map((e) => e.name).join(",") === "Luca,Nile,Rex", `The extras were ${extras.map((e) => e.name).join(",")}.`);
  check(extras.find((e) => e.name === "Rex")?.kind === "animal" && extras.find((e) => e.name === "Rex")?.species === "dog", "A dog was not a dog.");
  check(extras.find((e) => e.name === "Luca")?.kind === "person", "A friend was not a person.");
  check(namedExtras("we fly to Berlin on Monday with our friends from daycare").length === 0, "A place or a day was taken for a friend.");
  check(namedExtras("we have friends and a dog").length === 0, "Nouns without names were taken for people.");
  check(wordsMentioned(["our friends Luca and Nile", "our friend Luca"]).length === 2, "A name said twice was listed twice.");

  // --- The interpreter is believed only with the words that name them ------------------
  const said = "i also need to provide styles for nile and luca";
  const kept = sanitizeMentioned(
    [
      { name: "nile", role: "friend", evidence: "styles for nile and luca" },
      { name: "Luca", role: "friend", evidence: "nile and luca" },
      { name: "Zoe", role: "friend", evidence: "and my friend Zoe" },
      { name: "Max", role: "pet", evidence: "styles for nile" },
    ],
    said,
  );
  check(kept.map((p) => p.name).join(",") === "Nile,Luca", `The reported people were ${kept.map((p) => p.name).join(",")}.`);
  check(kept.every((p) => p.source === "interpreter" && p.kind === "person"), "A reported friend was not a person from the interpreter.");

  // --- Who is added ---------------------------------------------------------------------
  const friends = wordsMentioned(["our friends Luca and Nile, our dog Rex"]);
  check(peopleToAdd(book([]), friends).length === 0, "Somebody was added to a book with nobody in it.");
  check(peopleToAdd(book(family, { locked: true }), friends).length === 0, "Somebody was added to a finished book.");
  check(peopleToAdd(book(family), friends).map((p) => p.name).join(",") === "Luca,Nile,Rex", "The three people were not all to be added.");
  check(peopleToAdd(book(family, { removed: ["Luca"] }), friends).map((p) => p.name).join(",") === "Nile,Rex", "Somebody the parent took out came back.");
  check(
    peopleToAdd(book(family), friends, { removing: ["luca"] }).map((p) => p.name).join(",") === "Nile,Rex",
    "Somebody a request in this very turn removes was added.",
  );
  const nicknamed = [...family, member("l", "Luca", { aliases: ["Lu"] })];
  check(peopleToAdd(book(nicknamed), friends).map((p) => p.name).join(",") === "Nile,Rex", "Somebody already in the book was added again.");
  const crowded = Array.from({ length: MAX_BOOK_CAST - 1 }, (_, i) => member(`c${i}`, `Kid${String.fromCharCode(97 + i)}`));
  check(peopleToAdd(book(crowded), friends).length === 1, "People were added past the cap.");

  // --- Adding goes through the skill ----------------------------------------------------
  const added = addMentionedPeople(book(family), friends, ctx);
  check(added.names.join(",") === "Luca,Nile,Rex", "Not everybody was added.");
  const cast = namedCast(briefOf(added.project.config));
  check(cast.length === 7, `The book holds ${cast.length} people.`);
  check(cast.find((m) => m.name === "Rex")?.kind === "animal" && cast.find((m) => m.name === "Rex")?.species === "dog", "The dog lost its kind.");
  check(cast.find((m) => m.name === "Luca")?.role === "friend", "A friend lost the word.");
  check(addMentionedPeople(added.project, friends, ctx).names.length === 0 || peopleToAdd(added.project, friends).length === 0, "The same people were added twice.");
  check(peopleToAdd(added.project, friends).length === 0, "People already in the book were offered again.");
  check(resolvePerson(added.project, "luca").kind === "one", "An added person cannot be found by name.");
  check(!GUIDE_COMMANDS.addPerson.requires?.includes("hasCast"), "Adding a person should not need one already.");
}

{
  // --- The story speaks of them, or it does not ------------------------------------------
  check(textMentions("Lucas Mama winkte.", ["Luca"]), "A name with a German ending was not found.");
  check(textMentions("They waved to Nile's boat.", ["Nile"]), "A possessive was not found.");
  check(!textMentions("They waved to Nilesh.", ["Nile"]), "A longer name was taken for a shorter one.");
  check(textMentions("Aren said bye to Papa.", ["Dad", "Papa"]), "A nickname was not found in the story.");

  const story = "Aren and Amira said goodbye to Luca at the old daycare.";
  const withStory = book([...family, member("l", "Luca"), member("x", "Nile")], { storyText: story });
  check(missingFromStory(withStory, ["Luca", "Nile"]).join(",") === "Nile", "The story's people were not told apart.");
  check(missingFromStory(book(family), ["Luca"]).length === 0, "A book with no story asked for a rewrite.");
  const instruction = addPeopleInstruction(wordsMentioned(["our friends Luca and Nile and our dog Rex"]), ["Nile", "Rex"]);
  check(/Nile \(a friend\) and Rex \(their dog\)/.test(instruction) && /do not change anything else/.test(instruction), "The rewrite instruction lost who they are.");

  // --- A draft that was current stays current when the story already holds the people ---
  const brief = briefOf(withStory.config);
  const stamped: Project = {
    ...withStory,
    config: {
      ...withStory.config,
      storyBrief: { ...brief, generatedSignature: storyBriefSignature(brief, withStory.config.ageRangeId, withStory.config.readingModeId, undefined) },
    },
  };
  const before = { ...stamped, config: { ...stamped.config, storyBrief: { ...briefOf(stamped.config), cast: briefOf(stamped.config).cast!.filter((m) => m.name !== "Nile") } } };
  const sign = (p: Project) => ({
    ...p,
    config: { ...p.config, storyBrief: { ...briefOf(p.config), generatedSignature: storyBriefSignature(briefOf(p.config), p.config.ageRangeId, p.config.readingModeId, undefined) } },
  });
  const currentBefore = sign(before);
  const grown = addMentionedPeople(currentBefore, wordsMentioned(["our friend Nile"]), ctx).project;
  const staleNow = isDraftStale(briefOf(grown.config), grown.config.storyText, grown.config.ageRangeId, grown.config.readingModeId, undefined);
  check(staleNow, "Adding a person did not change the story's signature, so the test below proves nothing.");
  const kept = keepDraftCurrent(currentBefore, grown);
  check(!isDraftStale(briefOf(kept.config), kept.config.storyText, kept.config.ageRangeId, kept.config.readingModeId, undefined), "A current story was left called out of date.");
  const wasStale = { ...currentBefore, config: { ...currentBefore.config, storyBrief: { ...briefOf(currentBefore.config), generatedSignature: "older" } } };
  const stillStale = keepDraftCurrent(wasStale, { ...grown, config: { ...grown.config, storyBrief: { ...briefOf(grown.config), generatedSignature: "older" } } });
  check(isDraftStale(briefOf(stillStale.config), stillStale.config.storyText, stillStale.config.ageRangeId, stillStale.config.readingModeId, undefined), "A story that was already out of date was marked current.");
}

{
  // --- The story waits for what it needs of the people it owes a place -----------------------
  const story = "Aren and Amira said goodbye at the old daycare.";
  const base = book(family, { storyText: story });
  const said = "our friends Luca and Nile";
  const grown = addMentionedPeople(base, wordsMentioned([said]), ctx, said).project;
  const joined = joinedPeople(base, grown);
  check(joined.map((m) => m.name).join(",") === "Luca,Nile", `The people who joined were ${joined.map((m) => m.name).join(",")}.`);
  const owed = withStoryOwed(grown, joined, true);
  check((authoringOf(owed).storyOwes?.ids ?? []).length === 2 && authoringOf(owed).storyOwes?.current === true, "Who the story owes was not written down.");
  const first = storyOwedStatus(owed);
  check(first.state === "waiting" && first.names.join(",") === "Luca,Nile", `The story did not wait for the ages: ${JSON.stringify(first)}.`);

  const ageOf = (project: Project, name: string, age: string): Project => {
    const set = GUIDE_COMMANDS.setPersonAge;
    const args = { person: name, age };
    const result = set.run(project, set.prepare ? set.prepare(args) : args, ctx);
    return result.kind === "write" ? result.project : project;
  };
  const oneAge = ageOf(owed, "Luca", "4");
  const second = storyOwedStatus(oneAge);
  check(second.state === "waiting" && second.names.join(",") === "Nile", "One person's age ended the wait for both.");
  const both = ageOf(oneAge, "Nile", "5");
  const third = storyOwedStatus(both);
  check(third.state === "ready" && third.names.join(",") === "Luca,Nile" && third.current, `The story did not go on once the ages were known: ${JSON.stringify(third)}.`);
  if (third.state === "ready") {
    const text = addPeopleInstruction(third.members.map(roleOfMember), third.names);
    check(/Luca \(a friend, 4 years old\)/.test(text) && /Nile \(a friend, 5 years old\)/.test(text), `The rewrite did not carry the ages: ${text}`);
  }

  // An age said with the names is never asked for again.
  const told = "our friends Luca and Nile, Luca is 4 years old";
  const stated = addMentionedPeople(base, wordsMentioned([told]), ctx, told).project;
  check(namedCast(briefOf(stated.config)).find((m) => m.name === "Luca")?.age === 4, "An age said with the name was not kept.");
  const statedStatus = storyOwedStatus(withStoryOwed(stated, joinedPeople(base, stated), true));
  check(statedStatus.state === "waiting" && statedStatus.names.join(",") === "Nile", "Somebody whose age was said was waited on.");
  const everyone = "our friends Luca and Nile. Luca is 4 years old and Nile is 5 years old";
  const knownAll = addMentionedPeople(base, wordsMentioned([everyone]), ctx, everyone).project;
  check(storyOwedStatus(withStoryOwed(knownAll, joinedPeople(base, knownAll), true)).state === "ready", "Ages said in the message still made the story wait.");

  // A dog has no age to wait for.
  const dog = addMentionedPeople(base, wordsMentioned(["our dog Rex"]), ctx, "our dog Rex").project;
  check(storyOwedStatus(withStoryOwed(dog, joinedPeople(base, dog), true)).state === "ready", "The story waited for a dog's age.");

  // Nothing waits forever.
  check(storyOwedStatus(grown).state === "none", "A story owed nothing was said to owe something.");
  const gone = { ...owed, config: { ...owed.config, storyBrief: { ...briefOf(owed.config), cast: family } } };
  check(storyOwedStatus(gone).state === "settled", "The story kept waiting for people who left the book.");
  const finished = withAuthoring(owed, { lockedAt: 5 });
  check(storyOwedStatus(finished).state === "settled", "The story kept waiting in a finished book.");
  const covered = { ...owed, config: { ...owed.config, storyText: `${story} Luca and Nile waved.` } };
  const coveredStatus = storyOwedStatus(covered);
  check(coveredStatus.state === "settled" && coveredStatus.covered, "A story that speaks of them still owed a rewrite.");
  const running = withAuthoring(both, { storyRun: { status: "running", signature: "x", startedAt: 1 } });
  check(storyOwedStatus(running).state === "busy", "A story being written was rewritten at the same time.");
  const outsideStory = { ...owed, config: { ...owed.config, storyText: "" } };
  check(storyOwedStatus(outsideStory).state === "settled", "A book without a story owed one.");

  // A character the story reading already found is that person at once; one left out comes back with them.
  const anchor = (id: string, name: string, extra: Partial<Project["anchors"] extends (infer A)[] | undefined ? A : never> = {}) =>
    ({ id, name, type: "character", description: "", importance: "high", mode: "creative", include: true, ...extra }) as NonNullable<Project["anchors"]>[number];
  const known = { ...grown, anchors: [anchor("k1", "Luca"), anchor("k2", "Nile", { include: false }), anchor("k3", "Zed")] };
  const linkedNow = withAnchorsLinked(known, joined);
  const byName = (name: string) => linkedNow.anchors!.find((a) => a.name === name)!;
  check(byName("Luca").castId === joined.find((m) => m.name === "Luca")!.id, "A character the story already knew was not tied to the new person.");
  check(byName("Nile").include === true && byName("Nile").castId !== undefined, "A character left out earlier did not come back with the person.");
  check(byName("Zed").castId === undefined && byName("Zed").include, "A character nobody joined for was touched.");
  check(withAnchorsLinked(linkedNow, joined) === linkedNow, "Linking twice changed the book again.");
  check(withAnchorsLinked(grown, joined) === grown, "A book with no characters yet was changed.");

  // Nobody is drawn while the story is still being worked around them.
  const aged = (project: Project): Project => ageOf(ageOf(project, "Luca", "4"), "Nile", "5");
  const open = (project: Project) => deriveJourney(project, createDefaultGuideFactPolicies()).open.map((item) => item.kind);
  const asked = aged(withStoryOwed(grown, joined, true));
  check(!open(asked).includes("portraits") && !open(asked).includes("castLooks"), `A portrait was offered while the story owed people: ${open(asked).join(",")}.`);
  const unowed = aged(grown);
  check(open(unowed).includes("portraits") || open(unowed).includes("castLooks"), `Nothing was offered once nothing was owed: ${open(unowed).join(",")}.`);

  // Undo takes the people and what they owe back together.
  const snapshot = snapshotForFields(base, owed);
  const undone = snapshot ? applyRestore(owed, snapshot) : owed;
  check(namedCast(briefOf(undone.config)).length === family.length && storyOwedStatus(undone).state === "none", "Undo left people or an owed story behind.");
}

{
  // --- Twins ------------------------------------------------------------------------------
  const twins = book([member("a", "Aren"), member("m", "Amira")]);
  check(twinsToAsk(briefOf(twins.config)).length === 0, "Two people with no relation were asked about.");
  const related = applyGuidePatch(twins, { relations: [{ names: ["Aren", "Amira"], type: "twins" }] }, guidePatchContext({}));
  check(twinsToAsk(briefOf(related.project.config)).length === 1, "Twins nobody described were not asked about.");
  const said = applyGuidePatch(twins, { relations: [{ names: ["Aren", "Amira"], type: "twins", lookAlike: "different" }] }, guidePatchContext({}));
  check(twinsToAsk(briefOf(said.project.config)).length === 0, "Twins said to look different were asked about.");
  check(/identical/.test(DEFAULT_GUIDE_COPY.askLookAlike) && !/look alike/i.test(DEFAULT_GUIDE_COPY.askLookAlike), "The twins question does not read as 'identical twins'.");
  check(/identical/i.test(GUIDE_COPY_HELP.askLookAlike), "The twins question's help does not say what it decides.");
}

{
  // --- A recorded answer through the interpreter -----------------------------------------------
  const provider = openaiTextProvider as unknown as { generateStructured: (creds: unknown, req: unknown) => Promise<unknown> };
  const original = provider.generateStructured;
  const message = "i also need to provide styles for nile and luca";
  provider.generateStructured = async () => ({
    intent: "other",
    route: "guided",
    claims: [],
    reply: "I noted that you would like looks for Nile and Luca.",
    confidence: 0.7,
    people: [
      { name: "Nile", role: "friend", evidence: "styles for nile and luca" },
      { name: "Luca", role: "friend", evidence: "nile and luca" },
      { name: "Ghost", role: "friend", evidence: "never said" },
    ],
  });
  try {
    const result = await interpretGuideTurn({
      project: book(family),
      message,
      playlist: resolveGuidePlaylist(createDefaultGuidePlaylist()),
      patchContext: guidePatchContext({}),
      creds: { apiKey: "test" },
      model: "test-model",
      providerId: "openai",
      repairAttempts: 0,
    });
    check((result.mentioned ?? []).map((p) => p.name).join(",") === "Nile,Luca", `The interpreter's people were ${(result.mentioned ?? []).map((p) => p.name).join(",")}.`);
    const toAdd = peopleToAdd(book(family), result.mentioned ?? []);
    const grown = addMentionedPeople(book(family), toAdd, ctx);
    check(namedCast(briefOf(grown.project.config)).length === 6, "The conversation that lost Nile and Luca still loses them.");
  } finally {
    provider.generateStructured = original;
  }
}

{
  // --- From the cast to the pages: the story reading must hold the new people --------------------------
  const provider = openaiTextProvider as unknown as { generateStructured: (creds: unknown, req: unknown) => Promise<unknown> };
  const original = provider.generateStructured;
  const story = "Aren and Amira said goodbye at the old daycare. Luca and Nile waved from the gate.";
  const said = "our friends Luca and Nile. Luca is 4 years old and Nile is 5 years old";
  const grown = addMentionedPeople(book(family, { storyText: story }), wordsMentioned([said]), ctx, said).project;
  const config = { ...grown.config, textModel: { provider: "openai", model: "test-model" } } as typeof grown.config;
  // The reading names only the first two children and misses the new people altogether.
  provider.generateStructured = async () => ({
    summary: "A goodbye.",
    title: "Goodbye",
    subtitles: [],
    anchors: [
      { name: "Aren", type: "character", description: "a toddler", importance: "high", ageYears: 2 },
      { name: "Amira", type: "character", description: "a toddler", importance: "high", ageYears: 2 },
    ],
    embeddings: [],
  });
  try {
    const read = await analyzeStory({ story, config, creds: { apiKey: "test" }, model: "test-model", previousAnchors: [] });
    const people = namedCast(briefOf(grown.config));
    for (const [name, years] of [["Luca", 4], ["Nile", 5]] as const) {
      const found = read.anchors.find((a) => a.name === name);
      const person = people.find((m) => m.name === name);
      check(Boolean(found) && found!.type === "character" && found!.include, `${name} was not made a character of the story.`);
      check(found?.castId === person?.id, `${name}'s character is not tied to the person in the cast.`);
      check(found?.ageYears === years && found?.ageSource === "author", `${name}'s age did not reach the character: ${found?.ageYears}.`);
    }
    check(anchorsNamedIn("Luca waves at Nile.", read.anchors).map((a) => a.name).join(",") === "Luca,Nile", "A page that says their names does not list them.");
  } finally {
    provider.generateStructured = original;
  }
}

{
  // --- Everyone the story names has a character to be drawn from --------------------------------------
  const story = "Aren and Amira said goodbye at the old daycare. Luca waved from the gate.";
  const mk = (id: string, name: string, extra: object = {}) =>
    ({ id, name, type: "character", description: "", importance: "high", mode: "creative", include: true, source: "analysis", ageYears: 2, ...extra }) as NonNullable<Project["anchors"]>[number];
  const base = book([...family, member("l", "Luca", { age: 4 }), member("x", "Nile", { age: 5 })], { storyText: story });
  const read: Project = {
    ...base,
    analysis: { summary: "", generatedAt: 1, model: "m", sourceStoryText: story },
    anchors: [mk("a1", "Aren", { castId: "a" }), mk("a2", "Amira", { castId: "m" })],
  };
  const fixed = withCastCharacters(read);
  check(fixed.added.join(",") === "Luca", `The characters made were ${fixed.added.join(",")}.`);
  check(fixed.unnamed.sort().join(",") === "Anne,Nile,Papa", `The people left alone were ${fixed.unnamed.join(",")}.`);
  const luca = fixed.project.anchors!.find((a) => a.name === "Luca");
  check(luca?.type === "character" && luca.include && luca.castId === "l" && luca.ageYears === 4 && luca.ageSource === "author", `Luca's character was ${JSON.stringify(luca)}.`);
  check(!fixed.project.anchors!.some((a) => a.name === "Nile"), "A person the story does not name got a character.");
  check(anchorsToPrepare(fixed.project).some((a) => a.name === "Luca"), "Drawing the book would not prepare the new character.");
  const again = withCastCharacters(fixed.project);
  check(again.added.length === 0 && again.project === fixed.project, "Making the characters twice changed the book again.");
  check(withCastCharacters({ ...read, analysis: undefined }).added.length === 0, "A story nobody has read yet got characters made for it.");
  const left = { ...read, anchors: [...read.anchors!, mk("a3", "Luca", { include: false, castId: "l" })] };
  const stays = withCastCharacters(left);
  check(stays.added.length === 0 && stays.project.anchors!.find((a) => a.name === "Luca")!.include === false, "A character the parent left out came back.");
  const nicknamed = { ...read, anchors: [...read.anchors!, mk("a4", "Lu", { aliasNames: ["Luca"] })] };
  check(withCastCharacters(nicknamed).added.length === 0, "A person known under another name got a second character.");
  // A later reading finds the same character by name and keeps it: no duplicate, same id.
  const reread = reconcileAnchorIds([mk("fresh1", "Aren"), mk("fresh2", "Amira"), mk("fresh3", "Luca", { source: "analysis" })], fixed.project.anchors!);
  check(reread.filter((a) => a.name === "Luca").length === 1 && reread.find((a) => a.name === "Luca")!.id === luca!.id, "A later reading made a second Luca or lost the first.");
  check(reread.find((a) => a.name === "Luca")!.castId === "l", "A later reading dropped the link to the person.");
}

report.push("Mentions: friends and pets, believed only with their words, added once and never against the parent");
notes.push("Mentions: named people are found, believed on evidence, added through the skill, and the story is rewritten only for those it lacks; twins are asked plainly");

export function checkGuideMentions(): CheckResult {
  return { failures, notes, report, cases };
}
