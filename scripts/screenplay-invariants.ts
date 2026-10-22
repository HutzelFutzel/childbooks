/**
 * Invariants for the page plan: the words on the pages, who is on them, what
 * the age band allows, and the order of the printed pages.
 *
 * Everything here is arithmetic or a comparison of structure, so it needs no
 * network and no model call. The one model call a plan makes is replaced by a
 * stub that answers with whatever plan a case needs, which is how the repair
 * and the re-cut are exercised: the stub's replies are the "bad" plans.
 */
import assert from "node:assert/strict";
import { fitSpreadsToPages, paginate } from "../books-frontend/src/core/pipeline/pagination";
import {
  generateScreenplay,
  matchAnchorNames,
  pagePlanInput,
} from "../books-frontend/src/core/pipeline/screenplay";
import {
  anchorsNamedOnPage,
  completeScreenplayCast,
  inspectScreenplay,
  wordlessAllowance,
} from "../books-frontend/src/core/pipeline/screenplayCheck";
import {
  firstTextMismatch,
  isVerseBlock,
  splitStoryIntoPages,
  splitVerseBlocks,
  squash,
  verseBlocks,
} from "../books-frontend/src/core/pipeline/screenplayText";
import { inspectScreenplayDensity } from "../books-frontend/src/core/pipeline/screenplayFit";
import { openaiTextProvider } from "../books-frontend/src/core/providers/openai";
import { resolveAudienceOverlays } from "../books-frontend/src/core/prompts/audience";
import { resolveAudienceProfile } from "../books-frontend/src/core/config/audience";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { storyForPages, readManuscript } from "../books-frontend/src/core/story/manuscriptShape";
import { textFromParagraphs, wordParagraphs } from "../books-frontend/src/core/design";
import { buildIllustrationPrompt } from "../books-frontend/src/core/pipeline/illustration";
import { linkAnchorsToCast } from "../books-frontend/src/core/pipeline/analysis";
import { planPageLayout } from "../books-frontend/src/core/book/pageLayout";
import { slotWantsCalmBand } from "../books-frontend/src/core/book/layouts";
import { createDefaultConfig, type Anchor, type BookConfig, type Project, type ScreenplayDoc } from "../books-frontend/src/core/types";

let passed = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function anchor(name: string, type: Anchor["type"] = "character", extra: Partial<Anchor> = {}): Anchor {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    type,
    description: `${name}.`,
    importance: "high",
    mode: "creative",
    include: true,
    ...extra,
  };
}

const MIA = anchor("Mia");
const MOM = anchor("Mia's Mom");
const TEDDY = anchor("Teddy", "object");
const CAST = [MIA, MOM, TEDDY];

// --- Reading the words back -------------------------------------------------------------------------------

{
  const story = "Mia woke up early.\n\nShe looked out of the window. The garden was white with frost.\n\nMia's Mom made cocoa.";
  const pages = ["Mia woke up early.", "She looked out of the window. The garden was white with frost.", "Mia's Mom made cocoa."];
  check(firstTextMismatch(story, pages) === null, "Pages that carry the story are reported as missing words.");
  check(firstTextMismatch(story, ["Mia woke up early.\n\nShe looked   out of the window.", "The garden was white with frost.", "Mia's Mom made cocoa."]) === null, "Whitespace and the page the words fall on are compared.");
  check(firstTextMismatch(story, [pages[0]!, pages[2]!])?.page === 2, "A missing page isn't found where it is missing.");
  // The words stop matching where the dropped sentence should have been: the next page.
  check(firstTextMismatch(story, [pages[0]!, "She looked out of the window.", pages[2]!])?.page === 3, "A dropped sentence goes unnoticed.");
  check(firstTextMismatch(story, [pages[0]!, pages[0]!, pages[1]!, pages[2]!])?.page === 2, "A repeated page goes unnoticed.");
  check(firstTextMismatch(story, [pages[0]!, "She peeked outside. The garden was frosty.", pages[2]!])?.page === 2, "A reworded page goes unnoticed.");
  check(firstTextMismatch(story, [pages[0]!, pages[1]!])?.page === 3, "Words left over after the last page go unnoticed.");
  check(firstTextMismatch(story, [pages[0]!, "", pages[1]!, pages[2]!]) === null, "A wordless page is read as a missing one.");

  const marked = storyForPages(readManuscript("Page 1\nMaya woke up.\n\nPage 2\nShe ran outside."));
  check(marked.includes("--- page break ---"), "The page plan isn't shown where the parent's pages begin.");
  check(firstTextMismatch(marked, ["Maya woke up.", "She ran outside."]) === null, "A break marker counts as story text.");
  check(firstTextMismatch(marked, ["Maya woke up.", "--- page break ---\nShe ran outside."])?.page === 2, "A printed break marker goes unnoticed.");
  check(squash("e\u0301") === squash("\u00e9"), "Accents typed two ways compare as different words.");
}

// --- Verse -----------------------------------------------------------------------------------------------

const VERSE = "Der Mond schien hell,\nder Wind ging schnell.\n\nDie Katze lief fort,\nan einen stillen Ort.\n\nDa kam der Morgen, rosa und weit, und alle Tiere waren bereit für den neuen Tag.";
{
  check(isVerseBlock("Der Mond schien hell,\nder Wind ging schnell."), "A couplet isn't read as verse.");
  check(!isVerseBlock("Mia woke up early."), "A single line is read as verse.");
  const wrapped = "Mia looked out of the window and saw that the whole garden was white with\nfrost, every leaf and every branch, and the little pond had turned into glass.";
  check(!isVerseBlock(wrapped), "A hard-wrapped paragraph is read as verse.");
  check(verseBlocks(VERSE).length === 2, `Expected two stanzas, got ${verseBlocks(VERSE).length}.`);

  const whole = ["Der Mond schien hell,\nder Wind ging schnell.", "Die Katze lief fort,\nan einen stillen Ort.", "Da kam der Morgen, rosa und weit, und alle Tiere waren bereit für den neuen Tag."];
  check(splitVerseBlocks(VERSE, whole).length === 0, "Whole stanzas are reported as cut.");
  const cut = ["Der Mond schien hell,", "der Wind ging schnell.\n\nDie Katze lief fort,\nan einen stillen Ort.", whole[2]!];
  check(firstTextMismatch(VERSE, cut) === null, "A cut stanza changes the words.");
  const found = splitVerseBlocks(VERSE, cut);
  check(found.length === 1 && found[0]!.page === 1, `A stanza cut over two pages isn't found: ${JSON.stringify(found)}.`);
  const together = ["Der Mond schien hell,\nder Wind ging schnell.\n\nDie Katze lief fort,\nan einen stillen Ort.", whole[2]!];
  check(splitVerseBlocks(VERSE, together).length === 0, "Two stanzas on one page are reported as cut.");
}

// --- Cutting the story into pages -------------------------------------------------------------------------

{
  const cuts = splitStoryIntoPages(VERSE, { wordsPerPage: 10 });
  check(firstTextMismatch(VERSE, cuts) === null, `The cut pages don't carry the words: ${JSON.stringify(cuts)}.`);
  check(splitVerseBlocks(VERSE, cuts).length === 0, "The cut divides a stanza.");
  check(cuts.length >= 2, "A story of three blocks is one page.");

  const prose = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} is here.`).join(" ");
  const pagesOfProse = splitStoryIntoPages(prose, { wordsPerPage: 10 });
  check(firstTextMismatch(prose, pagesOfProse) === null, "A long paragraph loses words when it is cut.");
  check(pagesOfProse.length > 1 && pagesOfProse.every((page) => /\.$/.test(page)), "A long paragraph is cut inside a sentence.");

  const own = storyForPages(readManuscript("Page 1\nMaya woke up. She stretched.\n\nPage 2\nShe ran outside."));
  const ownCut = splitStoryIntoPages(own, { wordsPerPage: 40 });
  check(ownCut.length === 2 && ownCut[1] === "She ran outside.", `The parent's pages aren't kept: ${JSON.stringify(ownCut)}.`);

  const japanese = "あさになりました。ミアはおきました。\n\nまどのそとはしろでした。にわにしもがおりていました。";
  const japaneseCut = splitStoryIntoPages(japanese, { wordsPerPage: 6 });
  check(firstTextMismatch(japanese, japaneseCut) === null, "Text without spaces loses words when it is cut.");
  check(splitStoryIntoPages(japanese, { wordsPerPage: 6, pages: 4 }).length >= 2, "A page target isn't read.");
  check(splitStoryIntoPages("", { wordsPerPage: 10 }).length === 0, "An empty story is cut into pages.");
}

// --- Who is on a page -------------------------------------------------------------------------------------

{
  check(matchAnchorNames(["Mia"], CAST).ids[0] === MIA.id, "An exact name isn't matched.");
  check(matchAnchorNames(["mia's mom"], CAST).ids[0] === MOM.id, "A name in other capitals isn't matched.");
  const teddy = matchAnchorNames(["Mia (the girl)"], CAST);
  check(teddy.ids.length === 1 && teddy.ids[0] === MIA.id, "A name with an aside isn't matched to the one person in it.");
  const two = matchAnchorNames(["Mia and Teddy"], CAST);
  check(two.ids.length === 0 && two.unmatched.length === 1, "A name that could be two people is guessed.");
  const nobody = matchAnchorNames(["Grandma"], CAST);
  check(nobody.ids.length === 0 && nobody.unmatched[0] === "Grandma", "A stranger is matched to someone.");
  check(matchAnchorNames(["Mi"], [MIA]).ids.length === 0, "Part of a word is matched to a person.");

  check(anchorsNamedOnPage("Mia's Mom made cocoa.", CAST).map((a) => a.name).join() === "Mia's Mom", "A longer name also names the shorter one inside it.");
  check(anchorsNamedOnPage("Mia hugged Mia's Mom.", CAST).map((a) => a.name).join() === "Mia,Mia's Mom", "Two people named on one page aren't both found.");
  check(anchorsNamedOnPage("The Miami sun was warm.", CAST).length === 0, "Part of a word names someone.");
  check(anchorsNamedOnPage("MIA sat with teddy.", CAST).map((a) => a.name).join() === "Mia,Teddy", "A name in other capitals isn't found.");

  const doc: ScreenplayDoc = {
    notes: "",
    frontCover: { title: "T", illustration: "A cover.", anchorIds: [], anchorNames: [] },
    spreads: [
      { id: "1", kind: "single", text: "Mia woke up.", illustration: "Mia wakes. Teddy sits by her.", layoutNote: "", anchorIds: [], anchorNames: [] },
    ],
  };
  const done = completeScreenplayCast(doc, CAST, ["Mia"]);
  check(done.spreads[0]!.anchorIds.join() === `${MIA.id},${TEDDY.id}`, "Who the words and the brief name isn't put on the page.");
  check(done.spreads[0]!.anchorNames?.join() === "Mia,Teddy", "The names aren't kept beside the ids.");
  check(done.frontCover?.anchorIds.join() === MIA.id, "The hero isn't put on the front cover.");
  check(completeScreenplayCast(done, CAST, ["Mia"]) .spreads[0] === done.spreads[0], "Completing a complete plan changes it.");
}

// --- Checking a plan --------------------------------------------------------------------------------------

const BAND = resolveAudienceProfile("4-5");
const STORY = "Mia woke up early.\n\nShe looked out of the window. The garden was white with frost.\n\nMia's Mom made cocoa.";

function plan(texts: string[], extra: Partial<ScreenplayDoc["spreads"][number]>[] = []): ScreenplayDoc {
  return {
    notes: "",
    frontCover: { title: "T", illustration: "Cover.", anchorIds: [MIA.id], anchorNames: ["Mia"] },
    spreads: texts.map((text, i) => ({
      id: `s${i}`,
      kind: "single" as const,
      text,
      illustration: `Picture ${i + 1}.`,
      layoutNote: "",
      anchorIds: [MIA.id],
      anchorNames: ["Mia"],
      ...(extra[i] ?? {}),
    })),
  };
}

function inspect(doc: ScreenplayDoc, over: Partial<Parameters<typeof inspectScreenplay>[0]> = {}) {
  return inspectScreenplay({
    doc,
    anchors: CAST,
    story: STORY,
    exact: true,
    checkText: true,
    profile: BAND,
    wordFactor: 1,
    names: [],
    wordlessAllowed: 0,
    ...over,
  });
}

{
  const good = plan(["Mia woke up early.", "She looked out of the window. The garden was white with frost.", "Mia's Mom made cocoa."]);
  const clean = inspect(good);
  check(clean.problems.length === 0 && clean.instruction === "", `A good plan has problems: ${JSON.stringify(clean.problems)}.`);

  const reworded = inspect(plan(["Mia woke up early.", "She peeked outside.", "Mia's Mom made cocoa."]));
  check(reworded.problems[0]?.code === "text-mismatch" && reworded.problems[0].page === 2, "A reworded page isn't reported on its page.");
  check(reworded.score >= 100, "Losing the words doesn't outweigh everything else.");
  check(inspect(plan(["Mia woke up early.", "She peeked outside.", "x"]), { checkText: false }).problems.every((p) => p.code !== "text-mismatch"), "Words are measured against the story when an edit asked to change them.");
  check(inspect(plan(["a", "b"]), { exact: false }).problems.every((p) => p.code !== "text-mismatch"), "A plan that may reword is measured against the story.");

  const verseCut = inspectScreenplay({
    doc: plan(["Der Mond schien hell,", "der Wind ging schnell.\n\nDie Katze lief fort,\nan einen stillen Ort.", "Da kam der Morgen, rosa und weit, und alle Tiere waren bereit für den neuen Tag."]),
    anchors: CAST, story: VERSE, exact: true, checkText: true, profile: BAND, wordFactor: 1, names: [], wordlessAllowed: 0,
  });
  check(verseCut.problems.some((p) => p.code === "verse-split" && p.page === 1), "A cut stanza isn't reported.");

  const unknown = inspect(good, { names: [{ page: 2, name: "Grandma", kind: "unknown" }, { page: 3, name: "Mia and Teddy", kind: "ambiguous" }] });
  check(unknown.problems.length === 2 && unknown.instruction.includes("Grandma") && unknown.instruction.includes("Mia's Mom"), "A name that isn't in the cast isn't sent back with the names that are.");

  const crowded = plan(["Mia woke up early.", "She looked out of the window. The garden was white with frost.", "Mia's Mom made cocoa."], [
    {},
    { anchorIds: [MIA.id, MOM.id, TEDDY.id, "x1", "x2"] },
  ]);
  const manyFigures = inspect({ ...crowded, spreads: crowded.spreads.map((s, i) => (i === 1 ? { ...s, anchorIds: ["a", "b", "c", "d", "e"] } : s)) }, {
    anchors: ["a", "b", "c", "d", "e"].map((id) => ({ ...anchor(id.toUpperCase()), id })),
  });
  check(manyFigures.problems.some((p) => p.code === "too-many-figures" && p.page === 2), "Five characters in one picture aren't reported.");

  const noBrief = inspect(plan(["Mia woke up early.", "She looked out of the window. The garden was white with frost.", "Mia's Mom made cocoa."], [{ illustration: "  " }]));
  check(noBrief.problems.some((p) => p.code === "empty-brief" && p.page === 1), "An empty picture brief isn't reported.");

  const spreadFirst = inspect(plan(["Mia woke up early.", "She looked out of the window. The garden was white with frost.", "Mia's Mom made cocoa."], [{ kind: "spread" }]));
  check(spreadFirst.problems.some((p) => p.code === "spread-misplaced" && p.page === 1), "A spread that starts on a right-hand page isn't reported.");

  const empty = inspect(plan(["Mia woke up early.", "", "She looked out of the window. The garden was white with frost. Mia's Mom made cocoa."]));
  check(empty.problems.some((p) => p.code === "empty-text" && p.page === 2), "A page with no words and no reason isn't reported.");
  const wordless = inspect(plan(["Mia woke up early.", "", "She looked out of the window. The garden was white with frost. Mia's Mom made cocoa."], [{}, { wordless: true }]), { wordlessAllowed: 1 });
  check(wordless.problems.length === 0, `A wordless page on purpose is a problem: ${JSON.stringify(wordless.problems)}.`);
  const tooMany = inspect(plan(["Mia woke up early.", "", "She looked out of the window. The garden was white with frost. Mia's Mom made cocoa."], [{}, { wordless: true }]), { wordlessAllowed: 0 });
  check(tooMany.problems.some((p) => p.code === "wordless-misuse"), "A wordless page in a book that allows none isn't reported.");
  const opening = inspect(plan(["", "Mia woke up early. She looked out of the window. The garden was white with frost.", "Mia's Mom made cocoa."], [{ wordless: true }]), { wordlessAllowed: 2 });
  check(opening.problems.some((p) => p.code === "wordless-misuse" && p.page === 1), "A wordless first page isn't reported.");

  check(wordlessAllowance(24, { exact: true, independent: false }) === 0, "The author's own words get a wordless page.");
  check(wordlessAllowance(24, { exact: false, independent: true }) === 0, "A first reader gets a wordless page.");
  check(wordlessAllowance(24, { exact: false, independent: false }) === 3 && wordlessAllowance(7, { exact: false, independent: false }) === 0, "The wordless allowance isn't one in eight.");

  // The author's words are never shortened to fit a limit.
  const long = Array.from({ length: 400 }, () => "word").join(" ");
  const heavy = inspectScreenplay({ ...{ doc: plan([long]), anchors: CAST, story: long, exact: true, checkText: true, profile: BAND, wordFactor: 1, names: [], wordlessAllowed: 0 } });
  check(heavy.problems.some((p) => p.code === "over-density" && !p.repair), "Too many words on a page of the author's own story is sent back for rewriting.");
  const heavyFree = inspectScreenplay({ doc: plan([long]), anchors: CAST, story: long, exact: false, checkText: true, profile: BAND, wordFactor: 1, names: [], wordlessAllowed: 0 });
  check(heavyFree.problems.some((p) => p.code === "over-density" && p.repair), "Too many words on a page of a book that may reword isn't sent back.");
}

// --- The age band's numbers, in the book's language -------------------------------------------------------

{
  const plain = resolveAudienceOverlays("4-5", null, null);
  const targeted = resolveAudienceOverlays("4-5", null, null, { hasPageTarget: true });
  check(plain.density.includes("Plan the book to land between"), "The band's own page range is missing without a page target.");
  check(!targeted.density.includes("Plan the book to land between"), "The plan is given two page counts.");
  const german = resolveAudienceOverlays("4-5", null, null, { wordFactor: 0.5 });
  check(german.density !== plain.density, "The words per page don't change with the language.");
  const target = BAND.density.targetWordsPerPage;
  check(german.density.includes(`about ${Math.max(1, Math.round(target * 0.5))} words`), "The words per page aren't scaled by the language's factor.");
  const reading = resolveAudienceOverlays("6-7", "independent", null);
  const other = resolveAudienceOverlays("6-7", "read-aloud", null);
  check(reading.screenplay !== other.screenplay, "How the book is read doesn't reach the page plan.");
  check(reading.screenplay.includes("HOW THIS BOOK IS READ"), "The reading mode isn't labelled.");
  const long = Array.from({ length: 150 }, () => "word").join(" ");
  const densityDoc = plan([long]);
  check(inspectScreenplayDensity(densityDoc, BAND, 1).overLimit.length === 1, "A page of 150 words isn't over the limit.");
  check(inspectScreenplayDensity(densityDoc, BAND, 100).overLimit.length === 0, "The page limit isn't scaled by the language's factor.");
}

// --- Printing ---------------------------------------------------------------------------------------------

{
  const doc = plan(["a", "b", "c", "d", "e"], [{}, {}, { kind: "spread" }, {}, { kind: "spread" }]);
  check(paginate(doc).issues.length >= 1, "The case has no misplaced spread.");
  const { doc: fixed, changed } = fitSpreadsToPages(doc);
  check(paginate(fixed).valid, "The plan is still not printable.");
  check(fixed.spreads.length === doc.spreads.length, "A page was added to make the plan printable.");
  check(fixed.spreads.every((s) => s.text), "A page lost its words.");
  check(changed.length >= 1 && fixed.spreads[changed[0]!]!.kind === "single", "The misplaced spread didn't become a single page.");
  const ok = plan(["a", "b", "c"], [{}, { kind: "spread" }]);
  check(fitSpreadsToPages(ok).doc === ok, "A printable plan is changed.");
}

// --- Reading the words back from a page -------------------------------------------------------------------

{
  const couplet = "Der Mond schien hell,\nder Wind ging schnell.";
  check(textFromParagraphs(wordParagraphs(couplet)) === couplet, "A line break inside a paragraph doesn't survive a page's text box.");
  check(textFromParagraphs(wordParagraphs("A.\n\nB.")) === "A.\n\nB.", "A blank line doesn't make a paragraph.");
}

// --- The whole thing, with a stubbed model ----------------------------------------------------------------

type Spread = { kind: "single" | "spread"; text: string; illustration: string; layoutNote: string; continuity: string; wardrobe: { anchor: string; outfit: string }[]; wordless: boolean; anchors: string[] };

function reply(texts: string[], over: Partial<Spread>[] = []): unknown {
  return {
    notes: "Soft winter light.",
    frontCover: { title: "Frost", subtitle: "", illustration: "A frosty garden.", anchors: ["Mia"] },
    backCover: { title: "", subtitle: "", illustration: "A quiet window.", anchors: [] },
    spineText: "Frost",
    spreads: texts.map(
      (text, i): Spread => ({
        kind: "single",
        text,
        illustration: `Picture ${i + 1}.`,
        layoutNote: "Wide.",
        continuity: "Morning, indoors.",
        wardrobe: [],
        wordless: false,
        anchors: ["Mia"],
        ...(over[i] ?? {}),
      }),
    ),
  };
}

interface Call {
  system: string;
  user: string;
  temperature?: number;
}

async function run(
  config: Partial<BookConfig>,
  replies: unknown[],
  anchors: Anchor[] = CAST,
  review = false,
): Promise<{ doc: ScreenplayDoc; calls: Call[] }> {
  const calls: Call[] = [];
  const provider = openaiTextProvider as unknown as { generateStructured: (creds: unknown, req: { messages: { content: string }[]; temperature?: number }) => Promise<unknown> };
  const original = provider.generateStructured;
  provider.generateStructured = async (_creds, req) => {
    calls.push({ system: req.messages[0]!.content, user: req.messages[1]!.content, temperature: req.temperature });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    return JSON.parse(JSON.stringify(next));
  };
  try {
    const doc = await generateScreenplay({
      config: { ...createDefaultConfig("en-US"), textModel: { provider: "openai", id: "stub" }, storyBrief: createDefaultStoryBrief("guided"), storyText: STORY, ...config },
      anchors,
      creds: { apiKey: "stub" },
      model: "stub",
      review,
    });
    return { doc, calls };
  } finally {
    provider.generateStructured = original;
  }
}

const PAGES = ["Mia woke up early.", "She looked out of the window. The garden was white with frost.", "Mia's Mom made cocoa."];

{
  const clean = await run({}, [reply(PAGES)]);
  check(clean.calls.length === 1, `A good plan took ${clean.calls.length} calls.`);
  check(clean.doc.spreads.map((s) => s.text).join("|") === PAGES.join("|"), "A good plan's words changed.");
  check(clean.doc.spreads[2]!.anchorIds.includes(MOM.id), "The person the words name isn't on the page.");
  check(clean.doc.spreads.every((s) => s.continuity === "Morning, indoors."), "The continuity note is lost.");
  check(clean.calls[0]!.temperature === 0.2, "The author's words are planned at a high temperature.");
  check(clean.calls[0]!.system.includes("CAST: never add a named"), "The plan isn't told to add nobody.");
  check(clean.calls[0]!.system.includes("NEVER write, show or describe"), "The age band's safety rules don't reach the plan.");
  check(clean.calls[0]!.system.includes("PAGE TURNS") && clean.calls[0]!.system.includes("PICTURES:") && clean.calls[0]!.system.includes("CONTINUITY:"), "The craft rules don't reach the plan.");
  check(clean.calls[0]!.system.includes("Every page carries words"), "The plan may leave a page wordless in the author's own story.");
  check(!clean.calls[0]!.system.includes("VERSE:"), "A story in prose is told it is verse.");
  check(clean.calls[0]!.system.includes("EXACTLY as written"), "The approved story may be reworded.");
}

{
  // The story was reworded: the pages are cut in code, and the model only writes pictures.
  const reworded = reply(["Mia woke up early.", "She peeked outside. The garden was frosty.", "Mia's Mom made cocoa."]);
  const fixed = await run({}, [reworded, reply(["x", "y", "z"], [{ illustration: "Mia wakes." }, { illustration: "The garden." }, { illustration: "Cocoa." }])]);
  check(fixed.calls.length === 2, `A reworded story took ${fixed.calls.length} calls.`);
  check(fixed.calls[1]!.user.includes("THE PAGES ARE ALREADY CUT"), "The second call isn't given the cut pages.");
  check(firstTextMismatch(STORY, fixed.doc.spreads.map((s) => s.text)) === null, `The re-cut plan doesn't carry the story: ${JSON.stringify(fixed.doc.spreads.map((s) => s.text))}.`);
  check(fixed.doc.spreads.length >= 2 && fixed.doc.spreads.every((s) => s.illustration), "A re-cut page has no picture brief.");
}

{
  // A story that is empty gives the words nothing to be held to, so the model's pages stand.
  const none = await run({ storyText: "   " }, [reply(["Something else entirely."])]);
  check(none.calls.length === 1 && none.doc.spreads.length === 1, "A plan for an empty story is not kept as the model wrote it.");
}

{
  // A name that isn't in the cast goes back once, and the better plan wins.
  const stranger = reply(PAGES, [{}, { anchors: ["Mia", "Grandma"] }]);
  const repaired = await run({}, [stranger, reply(PAGES)]);
  check(repaired.calls.length === 2, `A stranger in the plan took ${repaired.calls.length} calls.`);
  check(repaired.calls[1]!.user.includes("Grandma") && repaired.calls[1]!.user.includes("REVISION REQUEST"), "The repair isn't told who was wrong.");
  check(repaired.calls[1]!.temperature === 0.2, "The repair is planned at a high temperature.");

  const stays = await run({}, [stranger, stranger]);
  check(stays.calls.length === 2, "A repair is repeated.");
  check(stays.doc.spreads.map((s) => s.text).join("|") === PAGES.join("|"), "A plan with a stranger lost its words.");
  check(stays.doc.spreads[1]!.anchorIds.join() === MIA.id, "A stranger is given a reference sheet.");

  // A repair that loses the words never wins.
  const worse = await run({}, [stranger, reply(["Mia woke up early.", "Something else.", "Mia's Mom made cocoa."])]);
  check(worse.doc.spreads.map((s) => s.text).join("|") === PAGES.join("|"), "A repair that lost the words was kept.");
}

{
  // A stanza cut across two pages is sent back; the repair keeps it whole.
  const cut = reply(["Der Mond schien hell,", "der Wind ging schnell.\n\nDie Katze lief fort,\nan einen stillen Ort.", "Da kam der Morgen, rosa und weit, und alle Tiere waren bereit für den neuen Tag."]);
  const whole = reply(["Der Mond schien hell,\nder Wind ging schnell.", "Die Katze lief fort,\nan einen stillen Ort.", "Da kam der Morgen, rosa und weit, und alle Tiere waren bereit für den neuen Tag."]);
  const verse = await run({ storyText: VERSE, contentLocale: "de-DE" }, [cut, whole]);
  check(verse.calls.length === 2 && verse.calls[0]!.system.includes("VERSE:"), "Verse isn't told to the plan, or a cut stanza isn't repaired.");
  check(verse.doc.spreads[0]!.text === "Der Mond schien hell,\nder Wind ging schnell.", "The stanza was cut in the end.");

  // A model that writes the line break as two characters still gives a line break.
  const escaped = reply(["Der Mond schien hell,\\nder Wind ging schnell.", "Die Katze lief fort,\\nan einen stillen Ort.", "Da kam der Morgen, rosa und weit, und alle Tiere waren bereit für den neuen Tag."]);
  const fixed = await run({ storyText: VERSE, contentLocale: "de-DE" }, [escaped]);
  check(fixed.calls.length === 1 && fixed.doc.spreads[0]!.text.includes("\n"), "A line break written as \\n is printed as two characters.");
}

{
  // A spread that would start on a right-hand page becomes a single page, with no page added.
  const misplaced = reply(PAGES, [{ kind: "spread" }]);
  const printable = await run({}, [misplaced, misplaced]);
  check(printable.doc.spreads.length === 3 && !printable.doc.spreads.some((s) => s.placeholder), "A blank page was added.");
  check(paginate(printable.doc).valid, "The plan can't be printed.");
}

{
  // Studio books keep their choice: the words may be tightened, and wordless pages may be planned.
  const studio = await run({ storyBrief: undefined, textHandling: "creative", pageTarget: { pages: 24, wordsPerPage: 20, case: "natural" } }, [reply(["Mia woke early.", "She looked out at the frost.", "Mom made cocoa."])]);
  check(studio.calls[0]!.temperature === 0.6, "A studio book isn't planned at the creative temperature.");
  check(studio.calls[0]!.system.includes("You may adapt and tighten"), "A studio book isn't told it may adapt.");
  check(studio.calls[0]!.system.includes("WORDLESS PAGES") && studio.calls[0]!.system.includes("at most 3"), "A studio book isn't told how many wordless pages it may have.");
  check(!studio.calls[0]!.system.includes("Plan the book to land between"), "The plan is given two page counts.");
  check(studio.doc.spreads[1]!.text === "She looked out at the frost.", "A studio plan's own words were replaced.");
}

{
  // The second reading: a sound plan costs one more call; a found problem is fixed once.
  const sound = await run({}, [reply(PAGES), { issues: [] }], CAST, true);
  check(sound.calls.length === 2 && sound.calls[1]!.system.includes("editor who reads"), "A sound plan isn't reviewed once.");
  check(sound.calls[1]!.user.includes("Page 2 (single)") && sound.calls[1]!.user.includes("Picture: Picture 2."), "The reviewer isn't given the page plan.");

  const issue = { issues: [{ page: 2, kind: "invented", problem: "A dragon is drawn.", fix: "Draw only the garden." }, { page: 9, kind: "age", problem: "No such page.", fix: "" }] };
  const fixed = await run({}, [reply(PAGES), issue, reply(PAGES, [{}, { illustration: "Only the garden." }])], CAST, true);
  check(fixed.calls.length === 3 && fixed.calls[2]!.user.includes("Page 2: A dragon is drawn."), "A found problem isn't sent back as one request.");
  check(!fixed.calls[2]!.user.includes("No such page"), "A problem on a page that doesn't exist is sent back.");
  check(fixed.doc.spreads[1]!.illustration === "Only the garden.", "The fixed picture brief isn't taken.");
  check(fixed.doc.spreads.map((s) => s.text).join("|") === PAGES.join("|"), "A review's fix changed the words.");

  // A fix that loses the words is never taken, and a reviewer that fails never fails the plan.
  const lost = await run({}, [reply(PAGES), issue, reply(["Mia woke up early.", "Something else.", "Mia's Mom made cocoa."])], CAST, true);
  check(lost.doc.spreads.map((s) => s.text).join("|") === PAGES.join("|"), "A review's fix that lost the words was kept.");
  const broken = await run({}, [reply(PAGES), {}], CAST, true);
  check(broken.calls.length === 2 && broken.doc.spreads.length === 3, "A failed review changed the plan.");

  // Never on a plan the reader's own request is changing, and never unless asked for.
  check((await run({}, [reply(PAGES)])).calls.length === 1, "A plan is reviewed without being asked.");
}

// --- What the illustrator is told ------------------------------------------------------------------------

{
  const config = { ...createDefaultConfig("en-US"), ageRangeId: "3-5" };
  const spread = {
    id: "p1",
    kind: "single" as const,
    text: "Mia looked out of the window.",
    illustration: "Mia at the window.",
    layoutNote: "",
    anchorIds: [MIA.id],
    continuity: "The kitchen, early morning, frost outside.",
    wardrobe: [{ anchorId: MIA.id, outfit: "blue pyjamas with stars" }, { anchorId: "nobody", outfit: "a crown" }],
  };
  const prompt = buildIllustrationPrompt({ spread, config, referencedAnchors: [MIA], artDirection: "Soft winter light." });
  check(prompt.includes("Mia looked out of the window.") && prompt.includes("Never write these words"), "The illustrator isn't given the page's words, or isn't told not to print them.");
  check(prompt.includes("The kitchen, early morning, frost outside."), "The illustrator isn't given the page's setting and time.");
  check(prompt.includes("Mia wears blue pyjamas with stars") && !prompt.includes("a crown"), "The outfit change isn't given, or one for someone not on the page is.");
  check(prompt.includes("Soft winter light."), "The illustrator isn't given the book's art direction.");
  check(prompt.includes("Nothing in the picture may show or suggest"), "The age band's limits don't reach the picture.");

  const cover = buildIllustrationPrompt({ spread, config, referencedAnchors: [MIA], isCover: true, artDirection: "Soft winter light." });
  check(!cover.includes("Never write these words") && !cover.includes("Mia wears"), "A cover is given a page's words or outfit.");
  const kept = buildIllustrationPrompt({ spread, config, referencedAnchors: [MIA], hasCompositionRef: true, edit: "Make it night." });
  check(!kept.includes("Never write these words"), "A picture that keeps its composition is given the page's words.");
}

// --- A page without words ----------------------------------------------------------------------------------

{
  const project = { id: "x", config: createDefaultConfig("en-US") } as unknown as Project;
  for (const side of ["left", "right", "spread"] as const) {
    const withWords = planPageLayout(project, { side, textLength: 40 });
    const without = planPageLayout(project, { side, textLength: 0, wordless: true });
    check(withWords.slots.some((s) => s.role === "text"), `A page with words has no text slot on the ${side}.`);
    check(!without.slots.some((s) => s.role === "text"), `A wordless page keeps a text slot on the ${side}.`);
    check(without.mode === "full-bleed" && without.artRect.w === 1 && without.artRect.h === 1, `A wordless page's picture doesn't fill the ${side}.`);
    check(!without.slots.some(slotWantsCalmBand), `A wordless page keeps a calm band on the ${side}.`);
  }
  const cover = planPageLayout(project, { side: "right", isCover: true, wordless: true });
  check(cover.layoutId === planPageLayout(project, { side: "right", isCover: true }).layoutId, "A cover is planned as a wordless page.");
}

// --- The cast the pictures are drawn from -------------------------------------------------------------------

{
  const config: BookConfig = {
    ...createDefaultConfig("en-US"),
    storyBrief: { ...createDefaultStoryBrief("guided"), cast: [{ id: "cast-1", name: "Mia", kind: "child" }, { id: "cast-2", name: "Opa", kind: "adult" }] as never },
  };
  const linked = linkAnchorsToCast(
    [anchor("Mia"), anchor("Grandpa", "character", { aliasNames: ["Opa"] }), anchor("Opa", "character", { castId: "cast-1" }), anchor("Garden", "place")],
    config,
  );
  check(linked[0]!.castId === "cast-1", "A character with the cast member's name isn't linked.");
  check(linked[1]!.castId === "cast-2", "A character is not linked by an alias.");
  check(linked[2]!.castId === "cast-1", "A link already made is replaced by the name.");
  check(linked[3]!.castId === undefined, "A place is linked to a person.");
  check(linkAnchorsToCast([anchor("Mia")], createDefaultConfig("en-US"))[0]!.castId === undefined, "A book with no cast links someone.");
}

{
  const own = pagePlanInput({ ...createDefaultConfig("en-US"), storyBrief: createDefaultStoryBrief("guided"), storyText: STORY });
  check(own.exact && own.config.textHandling === "exact", "A story the parent approved in the chat may be reworded.");
  check(!pagePlanInput({ ...createDefaultConfig("en-US"), storyText: STORY }).exact, "A book made without a brief is held to the exact words.");
}

console.log(`Screenplay invariants passed (${passed} checks).`);
