/**
 * Invariants for keeping one subject one subject when the story's words change.
 *
 * A book's people, places and things are found again by name, and a name changes
 * when the story is translated or rewritten. What decides that "die Lampe" is the
 * lamp is a model's judgment; what this checks is everything the code does with
 * that judgment: only names the book has are believed, only ids the book has, for
 * the same kind of subject, once; a left-out subject stays left out, a person the
 * cast names stays that person, and a name the reader chose stays theirs.
 *
 * The model calls are replaced by a stub that answers what a case needs, so what
 * runs is the shipped prompt and the shipped checks, not a copy.
 */
import assert from "node:assert/strict";
import { acceptedClaims, carryNames, existingSubjectLines, knownNameKeys, knownNameLines, validNamePairs } from "../books-frontend/src/core/book/anchorIdentity";
import { ALIAS_LIMIT, anchorNameKeys, reconcileAnchorIds } from "../books-frontend/src/core/book/anchorRefs";
import { castMissingFromStory } from "../books-frontend/src/core/guide/agent/commands/relevance";
import { hardcoverCheck } from "../books-frontend/src/core/guide/hardcover";
import { withAnalysisCharacters } from "../books-frontend/src/core/guide/ownWords";
import { isOlderBasis, legacyPlanBasis, planBasis, planBasisMatches, storyPlanBasis } from "../books-frontend/src/core/guide/planBasis";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { withTranslatedStory } from "../books-frontend/src/core/guide/storyLanguage";
import {
  languageOf,
  languageStatus,
  normalizeStoryLanguages,
  withLanguageRemembered,
  withTranslationKept,
  withVersionRestored,
} from "../books-frontend/src/core/guide/storyVersions";
import { renamePersonEverywhere } from "../books-frontend/src/core/guide/rename";
import { manuscriptHash } from "../books-frontend/src/core/guide/ownWords";
import { applyRestore, RESTORE_FIELDS, snapshotForChange } from "../books-frontend/src/core/guide/agent/restore";
import { slimProjectForRender } from "../books-frontend/src/core/book/slimProject";
import { analyzeStory } from "../books-frontend/src/core/pipeline/analysis";
import { generateScreenplay } from "../books-frontend/src/core/pipeline/screenplay";
import { translateStory } from "../books-frontend/src/core/pipeline/storyTranslate";
import { inspectTranslation } from "../books-frontend/src/core/pipeline/storyValidate";
import { openaiTextProvider } from "../books-frontend/src/core/providers/openai";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { createDefaultConfig, type Anchor, type BookConfig, type Project } from "../books-frontend/src/core/types";

let passed = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function anchor(id: string, name: string, type: Anchor["type"] = "character", extra: Partial<Anchor> = {}): Anchor {
  return { id, name, type, description: `${name}.`, importance: "high", mode: "creative", include: true, source: "analysis", ...extra };
}

const LAMP = anchor("lamp", "the lamp", "object", { include: false });
const MOM = anchor("mom", "Mia's Mom", "character", { castId: "c-mom" });
const KITE = anchor("kite", "kite", "object", { nameEdited: true });
const BOOK_ANCHORS = [LAMP, MOM, KITE];

function config(over: Partial<BookConfig> = {}): BookConfig {
  return {
    ...createDefaultConfig("en-US"),
    textModel: { provider: "openai", id: "stub" },
    storyBrief: { ...createDefaultStoryBrief("guided"), cast: [{ id: "c-mom", name: "Mia's Mom" }] as never },
    storyText: "Mia's Mom switched on the lamp. Mia flew the kite.",
    ...over,
  };
}

function book(over: Partial<Project> = {}, cfg: Partial<BookConfig> = {}): Project {
  return {
    id: "book",
    title: "Mia",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: config(cfg),
    anchors: BOOK_ANCHORS,
    ...over,
  };
}

interface Call {
  system: string;
  user: string;
}

/** Answer the model calls of `body` with the given replies, in order (the last repeats), and report them. */
async function stubbed<T>(replies: unknown[], body: () => Promise<T>): Promise<{ value: T; calls: Call[] }> {
  const calls: Call[] = [];
  const provider = openaiTextProvider as unknown as {
    generateStructured: (creds: unknown, req: { messages: { content: string }[] }) => Promise<unknown>;
  };
  const original = provider.generateStructured;
  provider.generateStructured = async (_creds, req) => {
    calls.push({ system: req.messages[0]!.content, user: req.messages[1]!.content });
    return JSON.parse(JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]));
  };
  try {
    return { value: await body(), calls };
  } finally {
    provider.generateStructured = original;
  }
}

// --- What the translation reports -----------------------------------------------------------------------

{
  const cast = [{ id: "c-mom", name: "Mia's Mom" }];
  const known = knownNameKeys(BOOK_ANCHORS, cast);
  const lines = knownNameLines(BOOK_ANCHORS, cast);
  check(lines.includes("- the lamp [object]") && lines.includes("- Mia's Mom [character]"), `The book's names aren't listed for the translation: ${lines}.`);
  check(!lines.includes("Mia's Mom [character]\n- Mia's Mom"), "A cast member who already has an anchor is listed twice.");
  check(knownNameLines(undefined, [{ name: "Opa" }]) === "- Opa [character]", "A cast member with no anchor yet isn't listed.");

  const pairs = validNamePairs(
    [
      { from: "the lamp", to: "die Lampe" },
      { from: "The Lamp", to: "die Lampe 2" },
      { from: "the sofa", to: "das Sofa" },
      { from: "kite", to: "kite" },
      { from: "kite", to: "  " },
      { from: "Mia's Mom", to: "Mias Mama" },
    ],
    known,
  );
  check(pairs.length === 2, `Expected two believable renames, got ${JSON.stringify(pairs)}.`);
  check(pairs[0]!.to === "die Lampe" && pairs[1]!.from === "Mia's Mom", "The renames kept are not the first of each name.");
  check(validNamePairs(null, known).length === 0 && validNamePairs(undefined, known).length === 0, "No report is read as renames.");
}

{
  const reply = {
    title: "Mia",
    subtitle: "",
    story: "Mias Mama machte die Lampe an. Mia ließ den Drachen steigen.",
    names: [
      { from: "the lamp", to: "die Lampe" },
      { from: "Mia's Mom", to: "Mias Mama" },
      { from: "the sofa", to: "das Sofa" },
    ],
  };
  const { value, calls } = await stubbed([reply], () =>
    translateStory({ config: config({ contentLocale: "de-DE" }), story: "Mia's Mom switched on the lamp.", anchors: BOOK_ANCHORS, creds: { apiKey: "x" }, model: "stub" }),
  );
  check(value.names.length === 2 && value.names.every((pair) => pair.from !== "the sofa"), `A name the book doesn't have was believed: ${JSON.stringify(value.names)}.`);
  check(calls[0]!.system.includes("NAMES:"), "The translation isn't asked which names it changed.");
  check(calls[0]!.user.includes("- the lamp [object]") && calls[0]!.user.includes("- Mia's Mom [character]"), "The translation isn't shown the book's names.");

  const without = await stubbed([reply], () =>
    translateStory({ config: { ...config({ contentLocale: "de-DE" }), storyBrief: createDefaultStoryBrief("guided") }, story: "A story with nobody named in it.", creds: { apiKey: "x" }, model: "stub" }),
  );
  check(without.value.names.length === 0, "A book with no names took renames from the model.");
  check(!without.calls[0]!.system.includes("NAMES:") && !without.calls[0]!.user.includes("list of people"), "A book with no names is asked about names.");
}

// --- What the book does with it ------------------------------------------------------------------------

{
  const moved = withTranslatedStory(
    book(),
    {
      title: "Mia",
      subtitle: "",
      story: "Mias Mama machte die Lampe an. Mia ließ den Drachen steigen.",
      names: [
        { from: "the lamp", to: "die Lampe" },
        { from: "Mia's Mom", to: "Mias Mama" },
        { from: "kite", to: "Drachen" },
        { from: "the sofa", to: "das Sofa" },
      ],
    },
    "de-DE",
  );
  const [lamp, mom, kite] = moved.anchors!;
  check(lamp!.id === "lamp" && lamp!.name === "die Lampe", `The story's own name did not follow the story: ${lamp!.name}.`);
  check(lamp!.aliasNames?.includes("the lamp"), "The old name of a renamed thing isn't kept to find it by.");
  check(lamp!.include === false, "A subject the author left out came back when the story was translated.");
  check(mom!.name === "Mia's Mom" && mom!.aliasNames?.includes("Mias Mama"), "A person the cast names changed name, or isn't found by the new one.");
  check(mom!.castId === "c-mom", "The person lost the cast member they are.");
  check(kite!.name === "kite" && kite!.aliasNames?.includes("Drachen"), "A name the reader chose was changed by the translation.");
  check(moved.anchors!.length === 3, "Translating added or removed a subject.");
  check(JSON.stringify(book().anchors) === JSON.stringify(BOOK_ANCHORS), "Translating changed the book it was given.");

  const plain = withTranslatedStory(book(), { title: "Mia", subtitle: "", story: "Eine Geschichte." }, "de-DE");
  check(JSON.stringify(plain.anchors) === JSON.stringify(BOOK_ANCHORS), "A translation that reported nothing changed the anchors.");

  // The renames from a model that is not to be believed.
  const cast = [{ id: "c-mom", name: "Mia's Mom" }];
  const collide = carryNames([LAMP, KITE], cast, [
    { from: "the lamp", to: "Drachen" },
    { from: "kite", to: "Drachen" },
  ]);
  check(collide.map((a) => a.name).join("|") === "Drachen|kite", `Two subjects ended up with one name: ${collide.map((a) => a.name)}.`);
  const twice = carryNames([anchor("a", "ball", "object"), anchor("b", "ball", "object")], cast, [{ from: "ball", to: "Ball" }, { from: "ball", to: "Kugel" }]);
  check(twice.every((a) => a.name === "ball"), "A name that fits two subjects was given to one of them.");
  const alias = carryNames([anchor("c", "Teddy", "object", { aliasNames: ["the bear"] })], cast, [{ from: "the bear", to: "der Bär" }]);
  check(alias[0]!.name === "der Bär" && alias[0]!.aliasNames?.includes("Teddy") && alias[0]!.aliasNames?.includes("the bear"), "A rename from a name the thing was also called isn't carried.");

  let heap = [anchor("d", "moon", "place")];
  for (let i = 0; i < 20; i += 1) heap = carryNames(heap, cast, [{ from: heap[0]!.name, to: `mond ${i}` }]);
  check((heap[0]!.aliasNames?.length ?? 0) <= ALIAS_LIMIT, `A book moved between languages keeps ${heap[0]!.aliasNames?.length} names for one thing.`);
  check(heap[0]!.aliasNames?.includes("mond 18"), "The newest old names are the ones forgotten.");
}

// --- Reading the story again ------------------------------------------------------------------------------

function analysisReply(anchors: unknown[]): unknown {
  return { summary: "A room.", title: "Mia", subtitles: [], anchors, embeddings: [] };
}
const item = (name: string, type: string, sameAs: string | null, extra: object = {}) => ({
  name,
  type,
  description: `${name}, drawn.`,
  importance: "high",
  sameAs,
  ...extra,
});

{
  check(acceptedClaims([{ type: "object", sameAs: "lamp" }, { type: "object", sameAs: "lamp" }], BOOK_ANCHORS).map((a) => a?.id).join() === "lamp,", "A subject claimed twice was given to both.");
  check(acceptedClaims([{ type: "character", sameAs: "lamp" }], BOOK_ANCHORS)[0] === undefined, "A subject was matched to a different kind of subject.");
  check(acceptedClaims([{ type: "object", sameAs: "nope" }, { type: "object", sameAs: null }, { type: "object" }], BOOK_ANCHORS).every((a) => a === undefined), "An id the book doesn't have was believed.");
  check(existingSubjectLines(BOOK_ANCHORS).split("\n").length === 3 && existingSubjectLines(BOOK_ANCHORS).includes("id lamp | object | the lamp"), "The book's subjects aren't listed with their ids.");

  const reading = [
    item("die Lampe", "object", "lamp"),
    item("Mias Mama", "character", "mom"),
    item("Tisch", "object", "lamp"),
    item("Drache", "place", "kite"),
    item("Fremder", "character", "nope"),
  ];
  const german = config({ contentLocale: "de-DE", storyText: "Mias Mama machte die Lampe an. Der Tisch war alt." });
  const run = (previousAnchors: Anchor[] | undefined, missing?: string[]) =>
    stubbed([analysisReply(reading)], () =>
      analyzeStory({ story: german.storyText, config: german, creds: { apiKey: "x" }, model: "stub", previousAnchors, missing }),
    );
  const { value, calls } = await run(BOOK_ANCHORS);
  const byName = new Map(value.anchors.map((a) => [a.name, a]));
  check(byName.get("die Lampe")!.id === "lamp", "The lamp the story now calls 'die Lampe' is a new subject.");
  check(byName.get("Mias Mama")!.id === "mom" && byName.get("Mias Mama")!.castId === "c-mom", "A person the story words differently isn't the same person.");
  check(byName.get("Tisch")!.id !== "lamp" && byName.get("Drache")!.id !== "kite" && byName.get("Fremder")!.id !== "nope", "A claim that didn't check out was kept.");
  check(new Set(value.anchors.map((a) => a.id)).size === value.anchors.length, "Two subjects have one id.");
  check(value.anchors.filter((a) => a.type === "character" && a.castId === "c-mom").length === 1, "A person the cast names is in the book twice.");
  check(!value.anchors.some((a) => a.name === "Mia's Mom"), "The cast's own name was added beside the person the story already has.");
  check(calls[0]!.system.includes("EXISTING SUBJECTS") && calls[0]!.user.includes("id mom | character | Mia's Mom"), "The reading isn't shown what the book has.");
  check(!calls[0]!.user.includes("recurring in the story with no subject"), "A reading with nothing missing is told something is.");

  // Without the book's own anchors the cast's person is added again: the check above is not vacuous.
  const blind = await run(undefined);
  check(blind.value.anchors.some((a) => a.name === "Mia's Mom"), "The control reading didn't add the cast's person.");
  check(!blind.calls[0]!.system.includes("EXISTING SUBJECTS") && !blind.calls[0]!.user.includes("EXISTING SUBJECTS"), "A book with no anchors is shown a list of them.");

  const asked = await run(BOOK_ANCHORS, ["the red kite", " ", "x".repeat(200)]);
  check(asked.calls[0]!.user.includes("- the red kite") && asked.calls[0]!.user.includes("recurring in the story with no subject"), "The missing things aren't named to the reading.");
  check(!asked.calls[0]!.user.includes("x".repeat(100)), "A name the reading is asked for isn't bounded.");

  // The client then matches them to the book by id, keeping what the book had.
  const merged = reconcileAnchorIds(value.anchors, BOOK_ANCHORS);
  const lamp = merged.find((a) => a.id === "lamp")!;
  const mom = merged.find((a) => a.id === "mom")!;
  check(lamp.include === false, "The lamp the author left out came back with the new reading.");
  check(lamp.name === "die Lampe" && lamp.aliasNames?.includes("the lamp"), `The lamp's name did not follow the story: ${lamp.name}.`);
  check(mom.name === "Mia's Mom" && mom.aliasNames?.includes("Mias Mama") && mom.castId === "c-mom", "The cast's person lost their name, their other name or their cast member.");
  check(new Set(merged.map((a) => a.id)).size === merged.length, "The merged book has two subjects with one id.");
  check(merged.filter((a) => anchorNameKeys(a).includes("mias mama")).length === 1, "The same person is in the merged book twice.");

  const typed = reconcileAnchorIds([anchor("lamp", "Lampe", "object", { nameEdited: false })], [anchor("lamp", "my lamp", "object", { nameEdited: true })]);
  check(typed[0]!.name === "my lamp" && typed[0]!.nameEdited === true, "A name the reader chose followed the story.");
  const clash = reconcileAnchorIds([anchor("lamp", "Hund", "character")], [anchor("lamp", "the lamp", "object", { versions: {} as never })]);
  check(clash.length === 2 && new Set(clash.map((a) => a.id)).size === 2, "An id that couldn't be honoured stood twice.");
  const stay = reconcileAnchorIds([anchor("new-id", "the lamp", "object")], [LAMP]);
  check(stay[0]!.id === "lamp" && stay[0]!.name === "the lamp", "Matching by name stopped working.");
}

// --- Who the cast says is in the story -------------------------------------------------------------------

{
  const story = "Mias Mama machte die Lampe an. Es war ein ruhiger Abend zu Hause.";
  const unread = book({ anchors: undefined }, { storyText: story });
  check(castMissingFromStory(unread).some((m) => m.id === "c-mom"), "Someone the story doesn't name is not offered to the story.");
  const named = book({ anchors: [{ ...MOM, aliasNames: ["Mias Mama"] }] }, { storyText: story });
  check(castMissingFromStory(named).length === 0, "A person the translated story names by its own words is offered to the story.");
  const strangers = book({ anchors: [{ ...MOM, aliasNames: ["Oma"] }] }, { storyText: story });
  check(castMissingFromStory(strangers).length === 1, "A person the book knows by another name is counted as named.");

  const doctor = book({ anchors: undefined }, { storyText: "A doctor arrived and the nurse laughed a lot all day.", storyBrief: { ...createDefaultStoryBrief("guided"), cast: [{ id: "c-doc", name: "The Doctor" }] as never } });
  check(castMissingFromStory(doctor).length === 1, "A common word at the start of a name counts as the person being named.");
  const surname = book({ anchors: undefined }, { storyText: "Mia ran home through the rain, all the way.", storyBrief: { ...createDefaultStoryBrief("guided"), cast: [{ id: "c-mia", name: "Mia Schmidt" }] as never } });
  check(castMissingFromStory(surname).length === 0, "A first name no longer stands for the whole name.");

  const cast = withAnalysisCharacters(book({ anchors: undefined }), [{ name: "Mias Mama", type: "character", castId: "c-mom" }]);
  check((cast.config.storyBrief?.cast?.length ?? 0) === 1, "A person the cast already has was added to the cast again.");
  const added = withAnalysisCharacters(book({ anchors: undefined }), [{ name: "Mias Mama", type: "character" }]);
  check((added.config.storyBrief?.cast?.length ?? 0) === 2, "A new person the story names isn't added to the cast.");
}

// --- When the plan is made again -------------------------------------------------------------------------

{
  const project = book();
  const hardcover = hardcoverCheck(project.config, { targetWordsPerPage: 30 });
  const legacy = withAuthoring(project, { planBasis: legacyPlanBasis(project, hardcover) });
  check(planBasisMatches(legacy, hardcover) && isOlderBasis(legacy, hardcover), "A plan made before the words counted is made again.");
  const withWords = withAuthoring(project, { planBasis: storyPlanBasis(project, hardcover) });
  check(planBasisMatches(withWords, hardcover) && isOlderBasis(withWords, hardcover), "A plan made before who is in the book counted is made again.");
  const changedWords = { ...withWords, config: { ...withWords.config, storyText: `${withWords.config.storyText} More.` } };
  check(!planBasisMatches(changedWords, hardcover), "A plan made from other words is current.");

  const current = withAuthoring(project, { planBasis: planBasis(project, hardcover) });
  check(planBasisMatches(current, hardcover) && !isOlderBasis(current, hardcover), "A plan made now isn't current.");
  check((authoringOf(current).planBasis ?? "").length < 200, "The basis is too long to be stored.");
  const added = { ...current, anchors: [...current.anchors!, anchor("new", "Grandpa")] };
  check(!planBasisMatches(added, hardcover), "A person added after the plan was made is not in it, and it is current.");
  const left = { ...current, anchors: current.anchors!.map((a) => (a.id === "mom" ? { ...a, include: false } : a)) };
  check(!planBasisMatches(left, hardcover), "A person left out after the plan was made is still on its pages, and it is current.");
  const renamed = { ...current, anchors: current.anchors!.map((a) => (a.id === "mom" ? { ...a, name: "Mama", description: "Taller." } : a)) };
  check(planBasisMatches(renamed, hardcover), "A rename or a new look planned the pages again.");
  const painted = { ...current, anchors: current.anchors!.map((a) => (a.id === "lamp" ? { ...a, include: false } : a)) };
  check(planBasisMatches(painted, hardcover), "Something already left out is counted again.");
}

// --- The plan's own report ----------------------------------------------------------------------------------

{
  const MIA = anchor("mia", "Mia", "character", { aliasNames: ["Mommy's girl"] });
  const TEDDY = anchor("teddy", "Teddy", "object", { include: false });
  const reply = (unlisted: unknown) => ({
    notes: "",
    frontCover: { title: "Mia", subtitle: "", illustration: "A room.", anchors: ["Mia"] },
    backCover: { title: "", subtitle: "", illustration: "A room.", anchors: [] },
    spineText: "Mia",
    spreads: [{ kind: "single", text: "Mia woke up early.", illustration: "Mia wakes.", layoutNote: "Wide.", continuity: "Morning.", wardrobe: [], wordless: false, anchors: ["Mia"] }],
    ...(unlisted === undefined ? {} : { unlisted }),
  });
  const plan = (unlisted: unknown) =>
    stubbed([reply(unlisted)], () =>
      generateScreenplay({ config: config({ storyText: "Mia woke up early." }), anchors: [MIA, TEDDY], creds: { apiKey: "x" }, model: "stub" }),
    );
  const { value, calls } = await plan(["the red kite", "Teddy", "Mia", "the red kite", " ", "a", "b", "c", "d", "e", "f"]);
  check(value.unlisted?.[0] === "the red kite", `The plan's report isn't kept: ${JSON.stringify(value.unlisted)}.`);
  check(!value.unlisted?.includes("Teddy"), "Something the author left out is reported as missing.");
  check(!value.unlisted?.includes("Mia"), "Someone the book has is reported as missing.");
  check(value.unlisted?.filter((name) => name === "the red kite").length === 1, "A thing is reported twice.");
  check((value.unlisted?.length ?? 0) <= 5, "A plan reported more than five missing things.");
  check(calls[0]!.system.includes("UNLISTED:") && calls[0]!.user.includes("- Mia [character] (also called: Mommy's girl)"), "The plan isn't asked for what is missing, or isn't shown who is called what.");
  check((await plan([])).value.unlisted === undefined, "A plan that is missing nothing carries an empty list.");
  check((await plan(undefined)).value.unlisted === undefined, "A plan from a prompt that doesn't ask carries a list.");
}

// --- The story in every language it has been written in ------------------------------------------------------

{
  const EN =
    "Amanda and Arthur walked to the sea. Arthur found a shiny shell on the sand and gave it to Amanda. They built a castle, watched the waves, and waved goodbye to the sunset before walking home together.";
  const DE =
    "Amanda und Arthur gingen zum Meer. Arthur fand eine glänzende Muschel im Sand und schenkte sie Amanda. Sie bauten eine Burg, schauten den Wellen zu und winkten dem Sonnenuntergang zum Abschied, bevor sie zusammen nach Hause gingen.";
  const OTHER =
    "Amanda and Arthur flew a red kite over the green hill. A storm came, so they ran inside to drink hot cocoa with Grandma and tell old stories.";
  const words = { title: "Amanda und das Meer", subtitle: "", story: DE, names: [{ from: "the lamp", to: "die Lampe" }] };
  const withText = (project: Project, text: string): Project => ({ ...project, config: { ...project.config, storyText: text } });
  const kept = (project: Project, locale: "en-US" | "de-DE" | "es-ES") => project.storyLanguages?.[locale];

  const start = book({ title: "Amanda and the Sea" }, { storyText: EN });
  check(languageStatus(start, "de-DE") === "none" && languageStatus(start, "en-US") === "here", "A book never translated has a language kept, or isn't in its own.");
  check(withLanguageRemembered(withText(start, "")).storyLanguages === undefined, "An empty story was kept as a language.");

  // English → German keeps the English, and the German as the same story.
  const remembered = withLanguageRemembered(start);
  const inGerman = withTranslationKept(remembered, withTranslatedStory(remembered, words, "de-DE"), words, "en-US");
  check(languageOf(inGerman) === "de-DE" && inGerman.config.storyText === DE, "The translation is not in the book.");
  check(kept(inGerman, "en-US")?.storyText === EN && kept(inGerman, "en-US")?.title === "Amanda and the Sea", "The English story and title weren't kept.");
  check(kept(inGerman, "en-US")?.names.lamp === "the lamp", "The English name of a thing wasn't kept.");
  check(kept(inGerman, "de-DE")?.names.lamp === "die Lampe" && kept(inGerman, "de-DE")?.translatedFrom === "en-US", "The German words weren't kept as a translation.");
  check(kept(inGerman, "de-DE")?.syncId === kept(inGerman, "en-US")?.syncId, "The two languages aren't one story.");
  check(languageStatus(inGerman, "en-US") === "current" && languageStatus(inGerman, "de-DE") === "here", "The English isn't ready to switch back to.");
  check(languageStatus(inGerman, "es-ES") === "none", "A language never written is kept.");

  // Back to English is a lookup: the same story, title and names.
  const back = withVersionRestored(inGerman, "en-US")!;
  check(Boolean(back) && languageOf(back) === "en-US" && back.config.storyText === EN, "Switching back did not bring the English story back.");
  check(back.title === "Amanda and the Sea" && back.anchors!.find((a) => a.id === "lamp")!.name === "the lamp", "Switching back did not bring the title and names back.");
  check(back.anchors!.length === inGerman.anchors!.length && back.anchors!.find((a) => a.id === "lamp")!.include === false, "Switching back changed who is in the book.");
  check(languageStatus(back, "de-DE") === "current", "The German is no longer ready after a round trip.");
  check(withVersionRestored(back, "de-DE")!.config.storyText === DE, "A second trip did not bring the German back.");
  check(withVersionRestored(inGerman, "es-ES") === null && withVersionRestored(inGerman, "de-DE") === null, "A language that isn't kept, or the one the book is in, was restored.");

  // A small edit leaves the other language current; the edit is kept for the language it was made in.
  const small = withText(inGerman, DE.replace("glänzende", "winzige"));
  check(languageStatus(small, "en-US") === "current", "A small edit made the other language out of date.");
  const smallBack = withVersionRestored(small, "en-US")!;
  check(smallBack.config.storyText === EN && kept(smallBack, "de-DE")?.storyText === small.config.storyText, "The small edit was lost when the language was left.");
  check(withVersionRestored(smallBack, "de-DE")!.config.storyText === small.config.storyText, "The edited German did not come back.");
  check(kept(smallBack, "en-US")?.syncId === kept(inGerman, "en-US")?.syncId, "A small edit made a new story.");

  // A real edit makes the other language stale, not gone; editing back makes it current again.
  const drifted = withText(inGerman, OTHER);
  check(languageStatus(drifted, "en-US") === "stale" && withVersionRestored(drifted, "en-US") === null, "A real edit left the other language current.");
  check(kept(drifted, "en-US")?.storyText === EN, "A real edit deleted the other language.");
  check(languageStatus(withText(drifted, DE.replace("glänzende", "kleine")), "en-US") === "current", "Editing back to what it was did not make the other language current.");

  // Leaving a language that moved away starts a new story, so the older ones stay behind for good.
  const left = withLanguageRemembered(drifted);
  check(kept(left, "de-DE")?.syncId !== kept(left, "en-US")?.syncId && kept(left, "de-DE")?.storyText === OTHER, "Leaving a changed language kept it as the old story.");
  check(languageStatus(withText(left, DE), "en-US") === "stale", "A story that was left changed became current again when it was typed back.");
  const again = { ...words, story: "Amanda and Arthur flew a red kite.", title: "Amanda and the Kite" };
  const retranslated = withTranslationKept(left, withTranslatedStory(left, again, "en-US"), again, "de-DE");
  check(kept(retranslated, "en-US")?.syncId === kept(retranslated, "de-DE")?.syncId && kept(retranslated, "en-US")?.storyText === again.story, "A new translation isn't kept as part of the story it came from.");
  check(languageStatus(retranslated, "de-DE") === "current", "The language a translation came from isn't current.");

  // Three languages: all made from one story stay switchable, and a real edit leaves them all behind.
  const intoSpanish = (project: Project, story: string) => {
    const remembered = withLanguageRemembered(project);
    const spanish = { title: "Amanda y el mar", subtitle: "", story, names: [] };
    return withTranslationKept(remembered, withTranslatedStory(remembered, spanish, "es-ES"), spanish, languageOf(project));
  };
  const spanishBook = intoSpanish(inGerman, "Amanda y Arturo fueron al mar. Arturo encontró una concha brillante y se la dio a Amanda.");
  check(languageStatus(spanishBook, "en-US") === "current" && languageStatus(spanishBook, "de-DE") === "current", "Three languages of one story aren't all ready.");
  const viaEnglish = withVersionRestored(spanishBook, "en-US")!;
  check(languageStatus(viaEnglish, "es-ES") === "current" && languageStatus(viaEnglish, "de-DE") === "current", "Switching between kept languages made one out of date.");
  const rewritten = withText(viaEnglish, OTHER);
  check(languageStatus(rewritten, "es-ES") === "stale" && languageStatus(rewritten, "de-DE") === "stale", "A real edit left a language current.");

  // The kept words never reach the model, and never count against what Undo can hold.
  check(!("storyLanguages" in slimProjectForRender(inGerman, {})), "The kept languages were sent to the model.");
  check(!(RESTORE_FIELDS as readonly string[]).includes("storyLanguages"), "The kept languages are among the fields Undo stores.");
  check(JSON.stringify(start.config) === JSON.stringify(book({ title: "Amanda and the Sea" }, { storyText: EN }).config), "Keeping a language changed the book it was given.");

  // Undo of a translation keeps the translated language ready in the background.
  const snap = snapshotForChange(start, inGerman);
  const undone = applyRestore(inGerman, snap);
  check(languageOf(undone) === "en-US" && undone.config.storyText === EN, "Undo did not restore the English story.");
  check(languageStatus(undone, "de-DE") === "current" && withVersionRestored(undone, "de-DE")?.config.storyText === DE, "Undo lost the translated German version.");

  // Renaming a person updates the kept versions so switching back keeps the new name.
  const withCast: Project = {
    ...inGerman,
    config: {
      ...inGerman.config,
      storyBrief: { ...createDefaultStoryBrief("guided"), cast: [{ id: "c-amanda", name: "Amanda" }] as never },
    },
  };
  const renamed = renamePersonEverywhere(withCast, "c-amanda", "Clara");
  check(!("refused" in renamed), "Rename was refused.");
  if (!("refused" in renamed)) {
    const backAfterRename = withVersionRestored(renamed.project, "en-US")!;
    check(backAfterRename.config.storyText.includes("Clara") && !backAfterRename.config.storyText.includes("Amanda"), "Switching back after a rename brought back the old name.");
    check(backAfterRename.title === "Clara and the Sea", "Switching back after a rename brought back the old title.");
  }

  // Own-words extraction hash follows a restored version so cast extraction does not rerun.
  const withExtraction = withAuthoring(inGerman, {
    extraction: { storyHash: manuscriptHash(DE), at: 1, names: ["Amanda"], unresolved: [] },
  });
  const restoredOwn = withVersionRestored(withExtraction, "en-US")!;
  check(authoringOf(restoredOwn).extraction?.storyHash === manuscriptHash(EN), "Restoring an own-words version left a stale extraction hash.");

  // Normalization drops malformed entries and keeps valid ones.
  check(normalizeStoryLanguages(null) === undefined && normalizeStoryLanguages("bad") === undefined, "Malformed storyLanguages was not dropped.");
  const cleaned = normalizeStoryLanguages({
    "en-US": kept(inGerman, "en-US"),
    "not-a-locale": kept(inGerman, "en-US"),
    "de-DE": { storyText: "   ", syncId: "s1", syncText: "x" },
  });
  check(Boolean(cleaned?.["en-US"]) && !cleaned?.["de-DE"] && Object.keys(cleaned ?? {}).length === 1, "Invalid language entries survived normalization.");
}

// --- Translation quality checks & repair pass ----------------------------------------------------------------

{
  const VERSE_EN = [
    "Little star up in the sky,\nShining softly way up high,\nWatching over sleepy heads,\nTucked inside their cozy beds.",
    "Moonbeams dance upon the floor,\nQuietly behind the door,\nClose your eyes and drift away,\nTill the dawning of the day.",
  ].join("\n\n");
  const VERSE_FLAT_DE =
    "Kleiner Stern oben am Himmel, du scheinst sanft hoch oben und wachst über schläfrige Köpfe in ihren gemütlichen Betten. Mondstrahlen tanzen auf dem Boden leise hinter der Tür, schließ deine Augen und träume bis zum neuen Tag.";
  const VERSE_GOOD_DE = [
    "Kleiner Stern am Himmelszelt,\nLeuchtest sanft auf diese Welt,\nWachst bei Nacht mit mildem Schein,\nÜber alle, groß und klein.",
    "Mondlicht tanzt im stillen Raum,\nTrägt dich leis in deinen Traum,\nSchließ die Augen, schlaf nun sacht,\nBis der neue Tag erwacht.",
  ].join("\n\n");

  const flatIssues = inspectTranslation({
    sourceStory: VERSE_EN,
    translatedStory: VERSE_FLAT_DE,
    structure: { minWords: 20, maxWords: 120, beats: 2, maxSentenceWords: 18 },
    checkLength: true,
  });
  check(flatIssues.stanzaMiss === 2 && flatIssues.repairInstruction.includes("verse in 2 stanzas"), "Flattened verse stanzas were not caught.");

  const repairedVerse = await stubbed(
    [
      { title: "Kleiner Stern", subtitle: "", story: VERSE_FLAT_DE, names: [] },
      { title: "Kleiner Stern", subtitle: "", story: VERSE_GOOD_DE, names: [] },
    ],
    () =>
      translateStory({
        config: config({ contentLocale: "de-DE" }),
        story: VERSE_EN,
        title: "Little Star",
        sourceLocale: "en-US",
        targetLocale: "de-DE",
        creds: { apiKey: "x" },
        model: "stub",
      }),
  );
  check(repairedVerse.calls.length === 2, `A flattened verse translation did not trigger a repair pass (${repairedVerse.calls.length} calls).`);
  check(repairedVerse.calls[1]!.user.includes("previous attempt was rejected"), "The repair prompt did not explain why the first translation was rejected.");
  check(repairedVerse.value.story === VERSE_GOOD_DE, "The repaired verse translation was not kept.");
}

console.log(`Identity invariants passed (${passed} checks).`);
