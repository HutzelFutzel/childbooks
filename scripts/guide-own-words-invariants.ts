/**
 * Invariants for a book in the parent's own words, from "My story is ready"
 * to the cover and the page plan.
 *
 * The claims worth checking are the ones a parent would notice:
 *
 * - nothing is read, asked or drawn before they say the story is done, and
 *   the chat carries on in one place once they do;
 * - who the pages are for is asked before they finish, and again only when a
 *   stated age disagrees; a missing age is asked before any portrait;
 * - a title, subtitle and "by …" written atop the story go on the cover, not
 *   on page 1, and a line of story is never mistaken for a title;
 * - the pages and sections they marked stay theirs, and the markers are never
 *   printed;
 * - the people are read as the story says they are: a dog is a dog, a brother
 *   a brother, and nothing the text doesn't say is added;
 * - their own name is the first author idea, and a note for the pictures is
 *   asked once, optional, and never printed.
 *
 * Offline and deterministic: pure functions over synthesized books.
 */
import { authorIdeas } from "../books-frontend/src/core/guide/coverWords";
import { createDefaultGuideFactPolicies } from "../books-frontend/src/core/guide/factPolicy";
import { composerForChoice } from "../books-frontend/src/core/guide/activity";
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import { firstUnmet } from "../books-frontend/src/core/guide/agent/requirements";
import type { CommandContext } from "../books-frontend/src/core/guide/agent/types";
import { BOOK_CHOICE_KINDS, deriveJourney, type Journey } from "../books-frontend/src/core/guide/journey";
import { cardId, deckStep, EMPTY_DECK, placeCard } from "../books-frontend/src/core/guide/cardDeck";
import {
  manuscriptHash,
  sanitizeManuscriptCast,
  storyHandedOver,
  withManuscriptCast,
  type ManuscriptCast,
} from "../books-frontend/src/core/guide/ownWords";
import { authoringOf, withAuthoring, withFactMarks } from "../books-frontend/src/core/guide/projectState";
import { audienceProfileForMonths } from "../books-frontend/src/core/config/audience";
import { peopleNeedingStatedAge } from "../books-frontend/src/core/guide/agent/requirements";
import { ownAudienceQuestion, readingAgeAskLine, statedReaderMonths } from "../books-frontend/src/core/guide/readingAge";
import { pagePlanInput } from "../books-frontend/src/core/pipeline/screenplay";
import { briefOf, createDefaultStoryBrief, namedCast, newCastMember } from "../books-frontend/src/core/story/brief";
import {
  manuscriptHeading,
  readManuscript,
  storyForPages,
  withoutHeading,
} from "../books-frontend/src/core/story/manuscriptShape";
import { createDefaultConfig, type Project, type StoryCastMember } from "../books-frontend/src/core/types";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import { withManuscriptHeading } from "../books-frontend/src/ui/guide/bookTitle";
import type { CheckResult } from "./guide-agent-invariants";

/** The first open card about the people, past the book's own choices (format, layout, cover words). */
const askedAboutPeople = (journey: Pick<Journey, "open">) =>
  journey.open.find((item) => !BOOK_CHOICE_KINDS.has(item.kind));


const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

const ctx: CommandContext = { now: 1, guest: false, styles: [], languages: [] };
const policies = createDefaultGuideFactPolicies();

const BODY =
  "Maya woke up before the sun. She tiptoed past her little brother Leo and their dog Rex, who thumped his tail twice. " +
  "Outside, the garden was silver with frost, and somewhere a blackbird was already singing the first song of the day.";

function maya(): StoryCastMember {
  return { ...newCastMember(), name: "Maya", age: 5 };
}

function ownBook(storyText: string, options: { handedOver?: boolean; read?: boolean; cast?: StoryCastMember[] } = {}): Project {
  const project: Project = {
    id: "own-book",
    title: "",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: {
      ...createDefaultConfig(),
      storyText,
      contentLocale: "en-US",
      storyBrief: { ...createDefaultStoryBrief("own"), cast: options.cast ?? [maya()] },
    },
  };
  return withAuthoring(project, {
    entry: "own",
    ...(options.handedOver ? { manuscriptReadyAt: 2 } : {}),
    ...(options.read
      ? { extraction: { storyHash: manuscriptHash(storyText), at: 3, names: ["Maya"], unresolved: [] } }
      : {}),
  });
}

// --- My story is ready -----------------------------------------------------------------------------------

{
  const writing = ownBook(BODY);
  const journey = deriveJourney(writing, policies, {});
  check(!storyHandedOver(writing), "An own-words story counts as handed over before the parent said so.");
  check(
    journey.well?.kind === "audienceConfirm" && journey.well.own === true,
    `While the audience is unset, the well offers ${journey.well?.kind ?? "nothing"} instead of who the book is for.`,
  );
  const blank = ownBook("", { cast: [] });
  const early = deriveJourney(blank, policies, {}).well;
  check(
    early?.kind === "audienceConfirm" && early.optional === true && readingAgeAskLine(early).key === "readingAgeAskOwnEarly",
    "A new own-words book doesn't ask who it's for before anything is written.",
  );
  const audienceSettled = withFactMarks(writing, "answeredFacts", ["readingAge"]);
  check(
    deriveJourney(audienceSettled, policies, {}).well?.kind === "storyDone",
    "After the age group is chosen, My story is ready isn't offered while the parent is still writing.",
  );
  check(journey.phase !== "story", "The book moves on to the story phase before the story is handed over.");
  check(
    !composerForChoice({ entry: "own", handedOver: false, wellKind: "storyDone" }),
    "The message field shows while the parent is still writing on the page.",
  );
  check(composerForChoice({ entry: "own", handedOver: true, wellKind: null }), "The message field stays hidden after the handoff.");

  for (const id of ["drawBook", "choosePersonLook", "drawPortraits", "confirmCoverWords"] as const) {
    check(GUIDE_COMMANDS[id].requires.includes("storyAccepted"), `${id} doesn't wait for My story is ready.`);
  }
  check(firstUnmet(writing, ["storyAccepted"], ctx)?.requirement === "storyAccepted", "An own story not handed over isn't reported as not ready.");

  const finish = GUIDE_COMMANDS.finishStory.run(writing, {}, ctx);
  check(finish.kind === "effect" && finish.effect.kind === "storyDone", "Saying the story is done doesn't hand it over.");

  const handed = ownBook(BODY, { handedOver: true });
  check(storyHandedOver(handed), "Tapping My story is ready doesn't hand the story over.");
  check(firstUnmet(handed, ["storyAccepted"], ctx) === null, "A handed-over story still blocks the next steps.");
  check(GUIDE_COMMANDS.finishStory.run(handed, {}, ctx).kind === "noop", "Handing the story over twice does it twice.");
  check(deriveJourney(handed, policies, {}).well?.kind !== "storyDone", "My story is ready stays after the story was handed over.");

  const empty = ownBook("", { handedOver: true });
  check(!storyHandedOver(empty), "An empty page counts as a handed-over story.");

  const legacy = ownBook(BODY, { read: true });
  check(storyHandedOver(legacy), "A book read before the handoff existed waits on a button it never showed.");
  const guided = withAuthoring({ ...ownBook(BODY), config: { ...ownBook(BODY).config, storyBrief: createDefaultStoryBrief("guided") } }, { entry: "guided" });
  check(storyHandedOver(guided), "A story the guide wrote waits for My story is ready.");
}

// --- Reading age, once --------------------------------------------------------------------------------------

{
  const read = ownBook(BODY, { handedOver: true, read: true });
  const question = ownAudienceQuestion(read);
  check(question?.own === true && question.optional !== true, "The reading age isn't asked from the child's stated age.");
  check(question !== null && readingAgeAskLine(question).key === "readingAgeAskOwnFromAge", "A stated age doesn't name the child in the reading-age question.");
  const journey = deriveJourney(read, policies, {});
  const afterRead = askedAboutPeople(journey);
  check(
    afterRead?.kind === "audienceConfirm" && afterRead.own === true,
    `After reading the story, the guide asks ${afterRead?.kind ?? "nothing"} before the reading age.`,
  );
  const answered = withFactMarks(read, "answeredFacts", ["readingAge"]);
  check(ownAudienceQuestion(answered) === null, "The reading age is asked again after the parent answered.");
  check(ownAudienceQuestion({ ...read, config: { ...read.config, audienceFromCast: "custom" } }) === null, "The reading age is asked after the parent picked one that matches.");
  const older = ownBook(BODY, { handedOver: true, read: true, cast: [{ ...maya(), age: 8 }] });
  const olderBand = audienceProfileForMonths(8 * 12, null);
  const mismatch = withFactMarks(
    { ...older, config: { ...older.config, audienceFromCast: "custom" as const } },
    "answeredFacts",
    ["readingAge"],
  );
  const differ = ownAudienceQuestion(mismatch);
  check(
    differ?.differ === true && differ.bandId === olderBand?.id,
    "A stated age in another group doesn't offer to switch the pages.",
  );
  check(readingAgeAskLine(differ!).key === "readingAgeAskOwnDiffer", "The switch question uses the first-time wording.");
  check(
    ownAudienceQuestion(withFactMarks(mismatch, "answeredFacts", ["readingAgeBand"])) === null,
    "The switch question is asked again after the parent answered it.",
  );
  const silent = ownBook(BODY, { handedOver: true, read: true, cast: [{ ...maya(), age: undefined }] });
  check(statedReaderMonths(silent) === undefined, "A missing age is treated as stated.");
  check(ownAudienceQuestion(silent)?.optional === true, "A story that states no age isn't allowed to skip the age group.");
  check(askedAboutPeople(deriveJourney(silent, policies, {}))?.kind === "castAges", "Portraits are offered before a missing age is asked.");
  check(peopleNeedingStatedAge(silent).length === 1, "A person with no age and no estimate isn't waiting on one.");
  const guessed = {
    ...silent,
    config: {
      ...silent.config,
      storyBrief: {
        ...briefOf(silent.config),
        cast: [{ ...maya(), age: undefined, visualAge: { years: 7, source: "suggested" as const } }],
      },
    },
  };
  check(peopleNeedingStatedAge(guessed).length === 0, "A person with a drawing estimate is still waiting for an age.");
  check(deriveJourney(guessed, policies, {}).well?.kind !== "castAges", "An estimated age is asked about anyway.");

  // The ages card lists everyone: estimates filled in, the one without any blank.
  const mixed = ownBook(BODY, {
    handedOver: true,
    read: true,
    cast: [
      { ...maya(), name: "Arthur", age: undefined, visualAge: { years: 5, source: "suggested" as const } },
      { ...maya(), name: "Amanda", age: undefined },
    ],
  });
  const agesWell = deriveJourney(mixed, policies, {}).open.find((item) => item.kind === "castAges") as
    | { kind: "castAges"; people: { name: string; years?: number }[] }
    | undefined;
  check(agesWell?.people.length === 2, "The ages card leaves out someone in the cast.");
  check(agesWell?.people.find((p) => p.name === "Arthur")?.years === 5, "An estimated age isn't filled in on the ages card.");
  check(agesWell?.people.find((p) => p.name === "Amanda")?.years === undefined, "A person without any age is given one on the ages card.");

  // Then, once: anything the pictures should know.
  const notesWell = deriveJourney(answered, policies, {});
  check(askedAboutPeople(notesWell)?.kind === "pictureNotes", `After the reading age, the guide offers ${askedAboutPeople(notesWell)?.kind ?? "nothing"} instead of a note for the pictures.`);
  check(!composerForChoice({ entry: "own", handedOver: true, wellKind: "pictureNotes" }), "The note for the pictures competes with the message field.");
  const skipped = withFactMarks(answered, "skippedFacts", ["pictureNotes"]);
  check(deriveJourney(skipped, policies, {}).well?.kind !== "pictureNotes", "Skip doesn't dismiss the note for the pictures.");
  const given = {
    ...answered,
    config: { ...answered.config, storyBrief: { ...briefOf(answered.config), pictureNotes: "Maya has red curls." } },
  };
  check(deriveJourney(given, policies, {}).well?.kind !== "pictureNotes", "The note for the pictures is asked again after the parent gave one.");
  const planned = { ...answered, screenplay: createVersionTree({ notes: "", spreads: [] }) };
  // The plan often lands while the notes are being typed: the question stays, and a note plans the pages again.
  check(
    deriveJourney(planned, policies, {}).open.some((item) => item.kind === "pictureNotes"),
    "The note for the pictures disappears once the pages are planned.",
  );
  const plan = pagePlanInput(given.config);
  check(!plan.story.includes("red curls"), "The note for the pictures is printed as story text.");
}

// --- Nothing is replaced until the reader decides ---------------------------------------------------------

{
  // Own words: the format and layout don't wait for the reading, so they come
  // first. The people the reading finds follow behind them, never in front.
  const unread = ownBook(BODY, { handedOver: true, read: false });
  const read = ownBook(BODY, { handedOver: true, read: true });
  const before = deriveJourney(unread, policies, {});
  const after = deriveJourney(read, policies, {});
  check(before.well?.kind === "formatChoice", `While the story is read, the guide asks ${before.well?.kind ?? "nothing"} instead of the format.`);
  check(after.well?.kind === "formatChoice", `Once the story is read, ${after.well?.kind ?? "nothing"} replaces the format question.`);
  const order = after.open.map((item) => item.kind);
  check(
    order.indexOf("layoutChoice") !== -1 && order.indexOf("layoutChoice") < order.findIndex((kind) => !BOOK_CHOICE_KINDS.has(kind)),
    `The layout is asked after the people (${order.join(", ")}).`,
  );

  // The card on screen holds while its question is open.
  const castAges = cardId({ kind: "castAges" });
  const format = cardId({ kind: "formatChoice" });
  const castFix = cardId({ kind: "castFix" });
  const at = (open: string[], shown: string | null) =>
    deckStep(shown ? placeCard(EMPTY_DECK, shown, 1) : EMPTY_DECK, { open, now: 2, acted: true, holding: false, drawable: true }).current;
  check(at([castAges, format], null) === castAges, "With nothing on screen, the first question isn't asked first.");
  check(at([castAges, format], format) === format, "A question on screen is replaced by one that opened meanwhile.");
  check(at([castAges], format) === castAges, "An answered question is held on screen.");
  check(at([castFix, format], format) === format, "A blocker replaced the question on screen instead of showing beside it.");
  check(at([], format) === null, "A question is shown with nothing to ask.");

  // Everything answered, the book still being prepared: the chat keeps working.
  const settled = (project: Project) =>
    withAuthoring(project, { bookSetup: { formatConfirmedAt: 1, layoutConfirmedAt: 1 }, cover: { confirmedAt: 1, subtitle: "", author: "" } });
  check(deriveJourney(settled(unread), policies, {}).waiting === "reading", "Nothing is shown as coming while the story is read.");
  check(deriveJourney(settled(unread), policies, {}).well === null, "A question is open although everything was answered.");
  check(deriveJourney(unread, policies, {}).waiting === null, "Waiting is shown while a question is still open.");
  check(deriveJourney(settled(read), policies, { analysisRunning: true }).waiting !== "planning", "The reading is shown as planning.");
}

// --- The heading atop the story -----------------------------------------------------------------------------

{
  const full = manuscriptHeading(`The Frost Garden\nA Morning Story\nby Grandma Lou\n\n${BODY}`);
  check(
    full?.heading.title === "The Frost Garden" && full.heading.subtitle === "A Morning Story" && full.heading.author === "Grandma Lou",
    `A title, subtitle and by-line aren't read: ${JSON.stringify(full?.heading)}.`,
  );
  check(full?.rest === BODY, "The story after the heading isn't what the parent wrote.");
  const german = manuscriptHeading(`Maya und der große Frost\nvon Oma Anni\n\n${BODY}`);
  check(german?.heading.title === "Maya und der große Frost" && german.heading.author === "Oma Anni", "A German title with a lower-case word, or its von-line, isn't read.");
  check(manuscriptHeading(`# The Frost Garden\n\n${BODY}`)?.heading.title === "The Frost Garden", 'A "# Title" line isn\'t read as the title.');
  check(manuscriptHeading(`The Frost Garden\n\n${BODY}`)?.heading.title === "The Frost Garden", "A lone title line isn't read.");

  const notTitles: [string, string][] = [
    ["Once upon a time", `Once upon a time\n\n${BODY}`],
    ["a sentence", `Maya woke up early.\n\n${BODY}`],
    ["dialogue", `"Wake up!" said Leo\n\n${BODY}`],
    ["a section heading", `### The morning\n\n${BODY}`],
    ["a page marker", `Page 1\n\n${BODY}`],
    ["a title with no story after it", "The Frost Garden\n\nThe end."],
    ["a first paragraph of four lines", `One\nTwo\nThree\nFour\n\n${BODY}`],
    ["a story with no blank line", BODY],
  ];
  for (const [what, text] of notTitles) {
    check(manuscriptHeading(text) === null, `${what} is read as the book's title.`);
  }

  // It goes on the cover, once.
  const book = ownBook(`The Frost Garden\nA Morning Story\nby Grandma Lou\n\n${BODY}`);
  const titled = withManuscriptHeading(book, full!.heading);
  const cover = authoringOf(titled).cover;
  check(titled.title === "The Frost Garden", "The story's own title isn't the book's title.");
  check(cover?.subtitle === "A Morning Story" && cover.author === "Grandma Lou" && cover.fromStory === true, "The subtitle and author atop the story aren't on the cover card.");
  const typed = withManuscriptHeading(
    withAuthoring({ ...book, title: "Frost!" }, { cover: { titleEdited: true, subtitle: "", author: "Mom" } }),
    full!.heading,
  );
  check(typed.title === "Frost!", "The heading replaces a title the parent typed on the cover card.");
  check(authoringOf(typed).cover?.subtitle === "" && authoringOf(typed).cover?.author === "Mom", "The heading replaces a subtitle or author the parent chose, or their none.");
  check(typed === withManuscriptHeading(typed, full!.heading), "A heading with nothing left to take still rewrites the book.");

  const plan = pagePlanInput(book.config);
  check(plan.config.textHandling === "exact", "The page plan may reword the parent's own story.");
  check(!plan.story.includes("The Frost Garden") && !plan.story.includes("Grandma Lou"), "The title lines are printed again on page 1.");
  check(plan.story === BODY, "The page plan doesn't read the story as the parent wrote it.");
  check(withoutHeading(book.config.storyText) === BODY, 'The readers of the story see "by Grandma Lou" as part of it.');

  const guidedConfig = { ...book.config, storyBrief: createDefaultStoryBrief("guided"), textHandling: "creative" as const };
  const guidedPlan = pagePlanInput(guidedConfig);
  // The parent read and approved a guided story in the chat, so its words are printed as written too.
  check(guidedPlan.config.textHandling === "exact" && guidedPlan.exact, "A guided story the parent approved may be reworded by the page plan.");
  check(guidedPlan.story.startsWith("The Frost Garden"), "A guided story loses its first lines.");
}

// --- The parent's pages and sections ------------------------------------------------------------------------

{
  const paged = readManuscript("Page 1\nMaya woke up.\n\nPage 2:\nShe tiptoed outside.\n\nPage 3: The garden was silver.\n\nThe End");
  check(paged.split === "pages" && paged.parts.length === 3, `Marked pages aren't kept as pages: ${JSON.stringify(paged.parts)}.`);
  check(paged.parts.every((part) => !/page\s*\d/i.test(part)), "A page marker is printed as story text.");
  check(paged.parts[2]?.startsWith("The garden was silver."), 'Text after "Page 3:" on the same line is lost.');
  check((storyForPages(paged).match(/--- page break ---/g) ?? []).length === 2, "The page plan isn't told where the parent's pages begin.");
  check(pagePlanInput(ownBook("Page 1\nMaya woke up.\n\nPage 2\nShe ran.").config).splitNote.includes("never put two parts on one page"), "The page plan isn't told to keep the parent's pages.");

  const german = readManuscript("Seite 1\nMaya wacht auf.\n\nSeite 2\nSie läuft hinaus.");
  check(german.split === "pages" && german.parts.join(" ") === "Maya wacht auf. Sie läuft hinaus.", '"Seite 1" isn\'t read as a page marker.');

  const prose = readManuscript("Page 5 was her favourite part of the book.\n\nPage 7 had a dragon on it.");
  check(prose.split === null, "A sentence that starts with the word page is read as a page marker.");
  check(readManuscript("Page 1\nMaya woke up and ran outside.").split === null, "A single page label divides the book into pages.");

  const sections = readManuscript("### Morning\nMaya woke up.\n\n### Garden\nThe frost sparkled.");
  check(sections.split === "sections" && sections.parts.length === 2, "The editor's sections aren't kept.");
  check(sections.parts.every((part) => !part.includes("Morning") && !part.includes("Garden")), "A section's name is printed as story text.");
  const breaks = readManuscript("Maya woke up.\n\n* * *\n\nThe frost sparkled.");
  check(breaks.split === "sections" && breaks.parts.length === 2, 'A "* * *" scene break doesn\'t start a new section.');
  const plain = readManuscript(BODY);
  check(plain.split === null && storyForPages(plain) === BODY, "A continuous story is changed on its way to the page plan.");
}

// --- Who is in it, as the story says ------------------------------------------------------------------------

{
  const raw: ManuscriptCast = {
    people: [
      { name: "Maya", age: 5, confidence: 0.95, kind: "person", role: null, species: null },
      { name: "Leo", confidence: 0.9, kind: "person", role: "her little brother", species: null },
      { name: "Rex", confidence: 0.9, kind: "animal", species: "dog", role: "the family's villain" },
      { name: "Pip", confidence: 0.9, kind: "toy", species: "golden unicorn" },
    ],
    unclear: [],
  };
  const text = `${BODY} Pip sat on the shelf.`;
  const found = sanitizeManuscriptCast(raw, text);
  const byName = new Map(found.people.map((person) => [person.name, person]));
  check(byName.get("Leo")?.role === "her little brother", "A role the story states is dropped.");
  check(byName.get("Rex")?.kind === "animal" && byName.get("Rex")?.species === "dog", "A dog in the story isn't read as a dog.");
  check(!byName.get("Rex")?.role, "A role the story never says is kept.");
  check(byName.get("Pip")?.kind === "toy" && !byName.get("Pip")?.species, "A species the story never says is kept.");

  const cast = withManuscriptCast(ownBook(text, { cast: [] }), found, text);
  const members = new Map(namedCast(briefOf(cast.config)).map((member) => [member.name, member]));
  check(members.get("Rex")?.kind === "animal" && members.get("Rex")?.species === "dog", "The dog read from the story is drawn as a person.");
  check(members.get("Leo")?.role === "her little brother", "The role read from the story isn't on Leo's plate.");

  const own = { ...newCastMember(), name: "Leo", role: "the twin" };
  const kept = withManuscriptCast(ownBook(text, { cast: [own] }), found, text);
  check(namedCast(briefOf(kept.config)).find((member) => member.name === "Leo")?.role === "the twin", "A role the parent gave is replaced by the reading.");
}

// --- The cover's author, and the question ----------------------------------------------------------------------

{
  const book = ownBook(BODY, { handedOver: true, read: true });
  check(authorIdeas(book, "David Miller")[0] === "David Miller", "The writer's own name isn't the first author idea.");
  check(!authorIdeas(book, "david@example.com").includes("david@example.com"), "An email address is offered as the author.");
  const french = { ...book, config: { ...book.config, contentLocale: "fr-FR" as const } };
  check(JSON.stringify(authorIdeas(french, "David Miller")) === JSON.stringify(["David Miller"]), "A French own-words book offers no author, or English ones.");
  const guided = withAuthoring({ ...book, config: { ...book.config, storyBrief: createDefaultStoryBrief("guided") } }, { entry: "guided" });
  check(!authorIdeas(guided, "David Miller").includes("David Miller"), "A story the guide wrote offers the account's name as its author.");
}

report.push("Own words");
report.push("  who the pages are for is asked up front; a missing age is asked before any portrait; a picture note is asked once");
report.push("  the title lines go on the cover, the marked pages stay, the words are laid out exactly as written");

export function checkGuideOwnWords(): CheckResult {
  notes.push("Own words: handoff, reading age, picture notes, heading, page markers, cast reading and author ideas checked");
  return { failures, notes, report, cases };
}
