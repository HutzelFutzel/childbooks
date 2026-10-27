/**
 * Invariants for the Chat studio's journey: where a book is, what the well
 * offers and where the chat and the book sit, all derived from the book.
 *
 * The claims here are the ones a reader would notice as a broken promise:
 *
 * - A book nobody has started offers only the opening choice.
 * - Once the pages start, nothing that changes the look, cast or story is
 *   offered again, and Order appears only when every page is done.
 * - Paid work is never offered twice for the same thing while it is running.
 * - The layout is a pure function of the book and the window.
 * - A typed change goes to exactly one thing, or the guide asks which.
 * - The hardcover check only ever settles on page counts a product can print.
 *
 * Offline and deterministic: the engine's synthesized books, pure functions.
 */
import { createDefaultGuideFactPolicies } from "../books-frontend/src/core/guide/factPolicy";
import { classifyOpeningText } from "../books-frontend/src/core/guide/manuscript";
import en from "../books-frontend/messages/en.json";
import de from "../books-frontend/messages/de.json";
import { cardPlaceholderKind, composerForChoice, ENTER_NEVER_ACCEPTS, guideActivity } from "../books-frontend/src/core/guide/activity";
import { availableViews, bookViewOf, BOOK_CHOICE_KINDS, deriveJourney, type Journey } from "../books-frontend/src/core/guide/journey";
import { guideLayout, GUIDE_MOBILE_MAX, GUIDE_CHAT_COLUMN_PX, GUIDE_FOCUS_MIN_PANE } from "../books-frontend/src/core/guide/layout";
import { hardcoverCheck, roundPages, shapeProducts } from "../books-frontend/src/core/guide/hardcover";
import { chipForView, resolveGuideTarget, targetHomeView } from "../books-frontend/src/core/guide/target";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { mergeBooks, resolveBookConflict } from "../books-frontend/src/core/guide/merge";
import { restoreDesign, snapshotForChange } from "../books-frontend/src/core/guide/agent/restore";
import { illustrationUnits } from "../books-frontend/src/core/book/units";
import { collectProjectImageBlobIds } from "../books-frontend/src/core/book/blobRefs";
import { collectSourceArtGroups } from "../books-frontend/src/core/book/sourceArt";
import { slimProjectForRender } from "../books-frontend/src/core/book/slimProject";
import {
  assignStyleSource,
  autoAssignStyleSource,
  stageStyleSource,
} from "../books-frontend/src/core/guide/styleSource";
import {
  manuscriptHash,
  OWN_WORDS_MAX_CHARS,
  sanitizeManuscriptCast,
  withAnalysisCharacters,
  withCastResolved,
} from "../books-frontend/src/core/guide/ownWords";
import {
  noteStyleChange,
  portraitInputs,
  portraitPrompt,
  portraitStatus,
  styleRevert,
  withLooksDecided,
  withPortraitAnchorReferences,
  withStyleReverted,
} from "../books-frontend/src/core/guide/portrait";
import { createDefaultPromptsConfig } from "../books-frontend/src/core/prompts/registry";
import {
  anchorImageIsCurrent,
  anchorsToPrepare,
} from "../books-frontend/src/core/book/anchorFreshness";
import { anchorSignature } from "../books-frontend/src/core/pipeline/provenance";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import {
  audienceSourceCharacter,
  briefOf,
  namedCast,
} from "../books-frontend/src/core/story/brief";
import { applyAutomaticBookFrame, withIllustrationFrame } from "../books-frontend/src/core/design";
import type { BookDesign } from "../books-frontend/src/core/design";
import type { Project } from "../books-frontend/src/core/types";
import { GUIDE_BOOK_STATES } from "./guide-engine-invariants";

/** The first open card about the people, past the book's own choices (format, layout, cover words). */
const askedAboutPeople = (journey: Pick<Journey, "open">) =>
  journey.open.find((item) => !BOOK_CHOICE_KINDS.has(item.kind));


export interface CheckResult {
  failures: string[];
  notes: string[];
  report: string[];
  cases: number;
}

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function fail(message: string): void {
  failures.push(message);
}

const policies = createDefaultGuideFactPolicies();

function journeyOf(project: Project, signals: Parameters<typeof deriveJourney>[2] = {}): Journey {
  return deriveJourney(project, policies, signals);
}

// --- Opening ---------------------------------------------------------------

{
  const fresh = GUIDE_BOOK_STATES[0]!.project;
  const bare: Project = { ...fresh, authoringState: undefined, screenplay: undefined };
  const opening = journeyOf({ ...bare, config: { ...bare.config, storyText: "", storyBrief: undefined } });
  cases += 1;
  if (
    opening.entry === null &&
    (opening.phase !== "opening" || opening.well !== null || opening.composer || opening.hasBook)
  ) {
    fail(
      `A book with no entry should offer only the opening choice and no composer/book/well ` +
        `(got ${opening.phase}, composer ${opening.composer}, book ${opening.hasBook}, ${opening.well?.kind}).`,
    );
  }
  const guidedEmpty = journeyOf(
    withAuthoring(
      {
        ...bare,
        title: "",
        illustrations: {},
        config: {
          ...bare.config,
          storyText: "",
          styleReady: undefined,
          storyBrief: { ...bare.config.storyBrief, mode: "guided", cast: [], heroNames: [] },
        },
      },
      { entry: "guided" },
    ),
  );
  cases += 1;
  if (guidedEmpty.hasBook || guidedEmpty.views.includes("style")) {
    fail("Choosing Guide me opened the book pane before there was a name, a story or a saved style.");
  }

  const namedUnchosen = withAuthoring(
    {
      ...bare,
      title: "Maya",
      illustrations: {},
      config: {
        ...bare.config,
        storyText: "",
        styleReady: false,
        storyBrief: {
          ...bare.config.storyBrief,
          mode: "guided",
          cast: [{ id: "maya", name: "Maya" }],
          heroNames: ["Maya"],
        },
      },
    },
    { entry: "guided" },
  );
  const choosing = journeyOf(namedUnchosen);
  cases += 1;
  if (choosing.views.includes("style")) {
    fail("The style tab opened while the look was still being chosen in the chat.");
  }
  cases += 1;
  if (choosing.hasBook) {
    fail("A name alone opened the book pane. There is nothing to show but placeholders yet.");
  }
  const styled = journeyOf({
    ...namedUnchosen,
    config: { ...namedUnchosen.config, styleReady: true },
  });
  cases += 1;
  if (!styled.views.includes("style")) fail("Choosing a look should open the style tab.");
  const designed = journeyOf(
    withAuthoring(
      { ...namedUnchosen, config: { ...namedUnchosen.config, styleReady: true } },
      { bookSetup: { formatConfirmedAt: 1, layoutConfirmedAt: 1 } },
    ),
  );
  cases += 1;
  if ((designed.views as string[]).some((view) => view === "design" || view === "cover")) {
    fail("The shape and layout are chosen in the chat and the title is typed with the story: no Design or Cover tab.");
  }
  cases += 1;
  if (designed.views.includes("pages")) {
    fail("The Book tab opened before the pages started.");
  }
}

// Views stored or named before the Cover and Design tabs were folded in.
{
  cases += 1;
  if (bookViewOf("cover") !== "pages" || bookViewOf("design") !== "story" || bookViewOf("nope") !== null) {
    fail("Old view ids should open the Book (cover) and Story (design) tabs, and unknown ids nothing.");
  }
}

// --- Every synthesized book, guided and own words ---------------------------

const LOCKED_FORBIDDEN = new Set([
  "portraits",
  "style",
  "formatChoice",
  "layoutChoice",
  "drawBook",
  "castFix",
  "storyRetry",
  "skipFact",
  "account",
]);
const phases = new Map<string, number>();

for (const { name, project } of GUIDE_BOOK_STATES) {
  for (const entry of ["guided", "own"] as const) {
    const book = withAuthoring(project, { entry });
    const journey = journeyOf(book);
    phases.set(journey.phase, (phases.get(journey.phase) ?? 0) + 1);

    cases += 1;
    if (journey.suggestedView && !journey.views.includes(journey.suggestedView)) {
      fail(`"${name}" (${entry}) suggests the ${journey.suggestedView} view, which it doesn't list.`);
    }
    cases += 1;
    if (journey.hasBook !== journey.views.length > 0) {
      fail(`"${name}" (${entry}) disagrees with itself about whether there is a book to show.`);
    }

    // Locked: the look, cast, story and count can't be offered again.
    const locked = withAuthoring(book, { entry, lockedAt: 1 });
    const lockedJourney = journeyOf(locked);
    cases += 1;
    if (lockedJourney.well && LOCKED_FORBIDDEN.has(lockedJourney.well.kind)) {
      fail(`"${name}" (${entry}) offers ${lockedJourney.well.kind} after the pages started.`);
    }
    cases += 1;
    if (!lockedJourney.locked) fail(`"${name}" (${entry}) with lockedAt set does not read as locked.`);

    // Order only when every page is done.
    const units = illustrationUnits(locked);
    cases += 1;
    if (lockedJourney.well?.kind === "order" && lockedJourney.pages.done !== lockedJourney.pages.total) {
      fail(`"${name}" (${entry}) offers Order with ${lockedJourney.pages.done}/${lockedJourney.pages.total} pages done.`);
    }
    if (units.length > 0) {
      // A failed page puts its fix in the well rather than Order.
      const failedUnits = { [units[0]!.id]: { error: "moderated" } };
      const failed = journeyOf(locked, { failedUnits });
      cases += 1;
      if (failed.well?.kind === "order") fail(`"${name}" (${entry}) offers Order while a page has failed.`);
      // A running page is never offered again.
      const running = journeyOf(locked, { failedUnits, activeUnitIds: new Set([units[0]!.id]) });
      cases += 1;
      if (running.well?.kind === "pageFix" && running.well.unitId === units[0]!.id) {
        fail(`"${name}" (${entry}) offers to redraw a page that is already being drawn.`);
      }
      cases += 1;
      if (!running.working) fail(`"${name}" (${entry}) is drawing a page but shows no work running.`);
    }

    // Portraits are never offered for someone already being drawn.
    if (journey.well?.kind === "portraits") {
      const drawing = journey.well.castIds[0]!;
      const busy = journeyOf(book, { activeUnitIds: new Set([drawing]) });
      cases += 1;
      if (busy.well?.kind === "portraits" && busy.well.castIds.includes(drawing)) {
        fail(`"${name}" (${entry}) offers a portrait again while it is being drawn.`);
      }
    }

    // Guests are asked for an account instead of Draw the book.
    if (journey.well?.kind === "drawBook") {
      cases += 1;
      if (journey.composer) fail(`"${name}" (${entry}) keeps the composer beside Draw the book.`);
      const guest = journeyOf(book, { guest: true });
      cases += 1;
      if (guest.well?.kind === "drawBook") fail(`"${name}" (${entry}) lets a guest start Draw the book.`);
    }
  }
}

// --- Pasted stories and exclusive actions ------------------------------------

{
  const pasted = "Amira and Aaron were twins.\n\nThey walked to the river and found a red boat. Aaron climbed in. Amira pushed.";
  cases += 1;
  if (classifyOpeningText(pasted) !== "manuscript") fail("A multi-paragraph story should be kept as the manuscript.");
  cases += 1;
  if (classifyOpeningText("Amira and Aaron are twins, both 5") !== "brief") {
    fail("A short brief should stay in the guided conversation.");
  }
  cases += 1;
  const busy = guideActivity({ sending: true, extractionRunning: true });
  if (busy?.id !== "understanding") fail("A message in flight should say it is being understood.");
  // The message field stays beside every card that spends Sparks, and Enter never accepts one.
  for (const kind of ["portraits", "drawBook", "order", "redraw", "bookUpdate", "bookFinish", "bookPrepFix", "formatChoice", "layoutChoice", "hardcoverChoice", "pageFix", "printFix", "account"]) {
    cases += 1;
    if (!composerForChoice({ entry: "guided", wellKind: kind })) fail(`The message field is hidden beside the "${kind}" card.`);
    cases += 1;
    if (!ENTER_NEVER_ACCEPTS.has(kind)) fail(`Enter on an empty field can accept the "${kind}" card.`);
  }
  for (const kind of ["whichName", "manuscriptChoice", "pictureNotes"]) {
    cases += 1;
    if (composerForChoice({ entry: "guided", wellKind: kind })) fail(`The message field shows beside "${kind}", which holds the next words itself.`);
  }
  cases += 1;
  if (!composerForChoice({ entry: "guided", wellKind: null })) fail("The message field is hidden while the book draws.");

  // The field never invites an answer the card would not take: a typed line
  // answers only the cards that ask in words; beside every other card it says
  // to pick, and no card that spends Sparks or changes the book invites typing.
  for (const kind of ["audienceConfirm", "castAges", "castLooks", "storyBrief", "skipFact", "coverWords", "lookAlike"]) {
    cases += 1;
    if (cardPlaceholderKind(kind) !== "type") fail(`The field does not invite a typed answer beside "${kind}", which takes one.`);
  }
  for (const kind of ENTER_NEVER_ACCEPTS) {
    if (kind === "pictureNotes" || kind === "whichName" || kind === "manuscriptChoice") continue;
    cases += 1;
    if (cardPlaceholderKind(kind) !== "pick") fail(`The field invites a typed answer beside "${kind}", which runs on a tap.`);
  }
  // Every line the field can show exists in both languages.
  const chromeEn = (en as unknown as { guide: { chrome: Record<string, string> } }).guide.chrome;
  const chromeDe = (de as unknown as { guide: { chrome: Record<string, string> } }).guide.chrome;
  for (const key of [
    "sendingPlaceholder",
    "cardTypePlaceholder",
    "briefPlaceholder",
    "coverTypeBelowHint",
    "cardPickPlaceholder",
    "drawingPeoplePlaceholder",
    "drawingBookPlaceholder",
    "guideMeHint",
    "ownWordsHintEntry",
  ]) {
    cases += 2;
    if (!chromeEn[key]?.trim()) fail(`The English message "${key}" is missing.`);
    if (!chromeDe[key]?.trim()) fail(`The German message "${key}" is missing.`);
  }
  const looksEn = (en as unknown as { guide: { looks: Record<string, string> } }).guide.looks;
  const looksDe = (de as unknown as { guide: { looks: Record<string, string> } }).guide.looks;
  for (const key of ["switchLabel", "switchDone", "switchOpen", "describeBelowHint"]) {
    cases += 2;
    if (!looksEn[key]?.trim()) fail(`The English looks message "${key}" is missing.`);
    if (!looksDe[key]?.trim()) fail(`The German looks message "${key}" is missing.`);
  }
  // A card opened on a tab belongs to that tab.
  {
    const person = { kind: "person" as const, castId: "p1", name: "Maya" };
    const page = { kind: "page" as const, unitId: "u1", page: 2 };
    cases += 1;
    if (targetHomeView(person) !== "cast") fail("A person's card should belong to the Characters tab.");
    cases += 1;
    if (chipForView(person, "cast") !== person) fail("A person's card closed while still on the Characters tab.");
    for (const view of ["story", "style", "pages", null] as const) {
      cases += 1;
      if (chipForView(person, view) !== null) fail(`A person's card stayed open on the ${view ?? "empty"} view.`);
    }
    cases += 1;
    if (chipForView(page, "cast") !== null) fail("A page's card stayed open on the Characters tab.");
    cases += 1;
    if (chipForView(null, "cast") !== null) fail("No card should stay no card.");
  }
  cases += 1;
  if (guideActivity({ revisionRunning: true })?.id !== "revisingStory") {
    fail("A story change being prepared should show a named status, not silence.");
  }
  cases += 1;
  if (guideActivity({ revisionRunning: false }) !== null) {
    fail("No revision running and nothing else happening should show no status.");
  }
  cases += 1;
  if (guideActivity({ revisionRunning: true, sending: true })?.id !== "understanding") {
    fail("A message in flight is understood before a background revision is reported.");
  }
  cases += 1;
  const reading = guideActivity({ extractionRunning: true });
  if (reading?.id !== "readingStory") fail("Reading a pasted story should be a named status.");

  const duplicate = sanitizeManuscriptCast(
    {
      people: [
        { name: "Maya", confidence: 0.95 },
        { name: "Maya", confidence: 0.95 },
      ],
      unclear: ["Maya"],
    },
    "Maya went outside. Maya found a kite.",
  );
  cases += 1;
  if (duplicate.unclear.includes("Maya")) {
    fail("A repeated high-confidence mention of one person should not block the story.");
  }
  const uncertain = sanitizeManuscriptCast(
    { people: [{ name: "Maya", confidence: 0.4 }], unclear: [] },
    "Maya found a kite.",
  );
  cases += 1;
  if (!uncertain.unclear.includes("Maya")) {
    fail("A low-confidence extracted person should still require review.");
  }
  const prefix = "a".repeat(OWN_WORDS_MAX_CHARS);
  cases += 1;
  if (manuscriptHash(prefix) !== manuscriptHash(`${prefix} ignored suffix`)) {
    fail("Own-words status should hash exactly the manuscript slice extraction reads.");
  }

  const portraitCandidate = GUIDE_BOOK_STATES.map(({ project }) =>
    withAuthoring(project, { entry: "own" }),
  ).find((project) => journeyOf(project).well?.kind === "portraits");
  if (portraitCandidate) {
    cases += 1;
    const unresolvedStyle = {
      ...portraitCandidate,
      config: { ...portraitCandidate.config, styleReady: false },
    };
    if (journeyOf(unresolvedStyle).well?.kind === "portraits") {
      fail("Portraits should wait until the reader explicitly resolves the book style.");
    }
  }

  const ageBase: Project = withAuthoring(
    {
      ...GUIDE_BOOK_STATES[0]!.project,
      config: {
        ...GUIDE_BOOK_STATES[0]!.project.config,
        storyText: "Maya found a lantern and carried it home.",
        storyBrief: {
          mode: "own",
          cast: [{ id: "maya", name: "Maya" }],
        },
      },
    },
    { entry: "own" },
  );
  const withVisualAge = withAnalysisCharacters(ageBase, [
    {
      name: "Maya",
      type: "character",
      ageYears: 7,
      ageSource: "suggested",
    },
  ]);
  const maya = withVisualAge.config.storyBrief?.cast?.[0];
  cases += 1;
  if (!maya || maya.age !== undefined || maya.visualAge?.years !== 7) {
    fail("A missing manuscript age should become a drawing-only estimate, not an author age.");
  } else {
    cases += 1;
    if (audienceSourceCharacter([maya])) {
      fail("A drawing-only age estimate must not silently select the reading audience.");
    }
    cases += 1;
    const inputs = JSON.parse(
      portraitInputs(withVisualAge, maya).subjectSignature,
    ) as { visualAge?: { years?: number } };
    if (inputs.visualAge?.years !== 7) {
      fail("Portrait freshness should include the visual age estimate.");
    }

    // Someone already drawn: reading the story again re-guesses the estimate, and a
    // guess a year apart is a different-looking child. It must not call for a redraw.
    const drawnMaya = withAuthoring(withVisualAge, {
      portraits: {
        [maya.id]: createVersionTree({
          blobId: "maya-portrait",
          mimeType: "image/png",
          createdAt: 5,
          inputs: portraitInputs(withVisualAge, maya),
        }),
      },
    });
    const reread = withAnalysisCharacters(drawnMaya, [
      { name: "Maya", type: "character", ageYears: 8, ageSource: "suggested" },
    ]);
    cases += 1;
    if (reread.config.storyBrief?.cast?.[0]?.visualAge?.years !== 7 || portraitStatus(reread, maya.id) !== "current") {
      fail("Reading the story again re-guessed the age of someone already drawn and left their portrait out of date.");
    }
    const stated = withAnalysisCharacters(drawnMaya, [
      { name: "Maya", type: "character", ageYears: 9, ageSource: "story" },
    ]);
    cases += 1;
    if (stated.config.storyBrief?.cast?.[0]?.visualAge?.years !== 9 || portraitStatus(stated, maya.id) !== "stale") {
      fail("An age the story states outright should still reach someone already drawn.");
    }
  }

  const frogBook = withAnalysisCharacters(ageBase, [
    {
      name: "Maya",
      type: "character",
      description: "A small green frog with golden eyes.",
      bodyPlan: "aquatic",
      ageYears: 4,
      ageSource: "suggested",
    },
  ]);
  const frog = frogBook.config.storyBrief?.cast?.[0];
  cases += 1;
  if (
    frog?.appearance !== "A small green frog with golden eyes." ||
    frog.bodyPlan !== "aquatic" ||
    frog.appearanceFromStory !== true
  ) {
    fail("Story analysis should copy the character's kind of being onto the plate.");
  } else {
    cases += 1;
    const prompt = portraitPrompt(frogBook, frog, createDefaultPromptsConfig());
    if (!prompt.includes("small green frog") || !prompt.includes("aquatic") || !prompt.includes("species")) {
      fail("The portrait prompt should draw the being the story described.");
    }
    cases += 1;
    if (prompt.includes("Nothing else is known")) {
      fail("A described character should not be invented from the name.");
    }
    const revised = withAnalysisCharacters(frogBook, [
      {
        name: "Maya",
        type: "character",
        description: "A brown toad with warty skin.",
        bodyPlan: "quadruped",
      },
    ]);
    const toad = revised.config.storyBrief?.cast?.[0];
    cases += 1;
    if (toad?.appearance !== "A brown toad with warty skin." || toad.bodyPlan !== "quadruped") {
      fail("A story-copied look should update when analysis runs again.");
    }
  }

  const kept = withAnalysisCharacters(
    {
      ...ageBase,
      config: {
        ...ageBase.config,
        storyBrief: {
          mode: "own",
          cast: [{ id: "maya", name: "Maya", appearance: "curly red hair" }],
        },
      },
    },
    [{ name: "Maya", type: "character", description: "A small green frog.", bodyPlan: "aquatic" }],
  );
  const keptMaya = kept.config.storyBrief?.cast?.[0];
  cases += 1;
  if (keptMaya?.appearance !== "curly red hair" || keptMaya.bodyPlan !== undefined) {
    fail("A look the family wrote should stay, and analysis should not replace it.");
  }

  const bookCandidate = GUIDE_BOOK_STATES.map(({ project }) => project).find(
    (project) =>
      Boolean(project.screenplay) &&
      Boolean(project.analysis) &&
      Boolean(project.config.storyText.trim()) &&
      Boolean(project.config.storyBrief?.cast?.some((member) => member.name.trim())),
  );
  if (bookCandidate) {
    const portraitFirst = withAuthoring(
      {
        ...bookCandidate,
        config: { ...bookCandidate.config, styleReady: true },
      },
      {
        entry: "own",
        lockedAt: undefined,
        portraits: {},
        // Asked once after the reading; settled here so the looks come next.
        answeredFacts: ["readingAge"],
        skippedFacts: ["pictureNotes"],
        extraction: {
          storyHash: manuscriptHash(bookCandidate.config.storyText),
          at: 1,
          names: (bookCandidate.config.storyBrief?.cast ?? []).map((member) => member.name),
          unresolved: [],
        },
      },
    );
    const castIds = namedCast(briefOf(portraitFirst.config)).map((member) => member.id);
    cases += 1;
    const looksFirst = askedAboutPeople(journeyOf(portraitFirst));
    if (looksFirst?.kind !== "castLooks" || looksFirst.castId !== castIds[0]) {
      fail("Where each person's look comes from must be asked before their portraits, first person first.");
    }
    cases += 1;
    if (availableViews(portraitFirst).includes("cast")) {
      fail("The People tab showed before anyone had a portrait.");
    }
    const looksSettled = withLooksDecided(portraitFirst, castIds);
    cases += 1;
    if (askedAboutPeople(journeyOf(looksSettled))?.kind !== "portraits") {
      fail("Current portraits must be offered before Create illustrated book.");
    }

    const currentPortraits = Object.fromEntries(
      namedCast(briefOf(portraitFirst.config)).map((member, index) => [
        member.id,
        createVersionTree({
          blobId: `portrait-${member.id}`,
          mimeType: "image/png",
          createdAt: index + 1,
          inputs: portraitInputs(portraitFirst, member),
        }),
      ]),
    );
    const needsSetup = withAuthoring(portraitFirst, {
      portraits: currentPortraits,
    });
    cases += 1;
    if (!availableViews(needsSetup).includes("cast")) {
      fail("The People tab didn't arrive with the first portraits.");
    }
    cases += 1;
    if (journeyOf(needsSetup, { planReady: false }).well?.kind !== "formatChoice") {
      fail("After portraits, Chat should ask for an explicit book format.");
    }
    cases += 1;
    if (
      journeyOf(withAuthoring(needsSetup, { entry: "guided" }), {
        planReady: false,
      }).well?.kind !== "formatChoice"
    ) {
      fail("Guided and own-words books should share the setup flow once the manuscript and portraits are ready.");
    }
    const formatChosen = withAuthoring(needsSetup, {
      bookSetup: { formatConfirmedAt: 1 },
    });
    cases += 1;
    if (journeyOf(formatChosen, { planReady: false }).well?.kind !== "layoutChoice") {
      fail("Page layout should be asked after book format.");
    }
    const layoutChosen = withAuthoring(formatChosen, {
      bookSetup: { formatConfirmedAt: 1, layoutConfirmedAt: 2 },
    });
    cases += 1;
    if (journeyOf(layoutChosen, { planReady: false }).well?.kind !== "coverWords") {
      fail("The cover's words should be asked right after the page layout, while the plan is made.");
    }
    cases += 1;
    if (journeyOf(layoutChosen, { planReady: true }).well?.kind !== "coverWords") {
      fail("Draw the book must wait for the cover's words.");
    }
    const setupChosen = withAuthoring(layoutChosen, { cover: { confirmedAt: 3 } });
    cases += 1;
    if (journeyOf(setupChosen, { planReady: true }).well?.kind !== "drawBook") {
      fail("Settling the cover's words should lead straight to Draw the book.");
    }
    cases += 1;
    if (journeyOf(withAuthoring(layoutChosen, { cover: { subtitle: "A Blanket Fort Adventure" } }), { planReady: true }).well?.kind !== "coverWords") {
      fail("Picking a subtitle is not saying the cover is done: the card should stay until Looks good.");
    }
    cases += 1;
    if (journeyOf(setupChosen, { planReady: false }).well?.kind === "drawBook") {
      fail("Create illustrated book must wait for a page plan matching the reviewed setup.");
    }

    // A new look after portraits were drawn: redraw them (priced for portraits
    // only) or keep the old look for free. The book's button waits behind it.
    {
      const other: Project = {
        ...setupChosen,
        config: { ...setupChosen.config, artStyle: { presetId: "__another-look__", origin: "preset" } },
      };
      const restyled = noteStyleChange(setupChosen, other);
      const card = journeyOf(restyled, { planReady: true }).well;
      cases += 1;
      if (card?.kind !== "portraits" || !card.stale || !card.canKeepLook || card.castIds.length !== castIds.length) {
        fail(`A new look should ask to redraw the portraits, with the old look as the way back (got ${JSON.stringify(card)}).`);
      }
      cases += 1;
      if (journeyOf(restyled, { planReady: true }).well?.kind === "drawBook") {
        fail("Create illustrated book must not share a card with redrawing the portraits.");
      }
      const unnoted = journeyOf(other, { planReady: true }).well;
      cases += 1;
      if (unnoted?.kind !== "portraits" || !unnoted.stale || unnoted.canKeepLook) {
        fail("With no remembered look the card should only offer to redraw, never a way back that doesn't exist.");
      }
      const redrawing = journeyOf(restyled, { planReady: true, activeUnitIds: new Set(castIds) }).well;
      cases += 1;
      if (redrawing?.kind === "drawBook" || redrawing?.kind === "portraits") {
        fail("While the portraits redraw, neither the redraw card nor the book's button should show.");
      }
      // A redraw of a portrait that is already current changes nothing until the new one lands:
      // the book's button still has to wait for it.
      cases += 1;
      if (journeyOf(setupChosen, { planReady: true, activeUnitIds: new Set([castIds[0]!]) }).well?.kind === "drawBook") {
        fail("Create illustrated book must wait while a current portrait is being redrawn.");
      }
      cases += 1;
      if (journeyOf(setupChosen, { planReady: true, activeUnitIds: new Set() }).well?.kind !== "drawBook") {
        fail("Create illustrated book should come back once no portrait is drawing.");
      }
      const back = withStyleReverted(restyled);
      cases += 1;
      if (
        styleRevert(restyled) === null ||
        back.config.artStyle.presetId !== setupChosen.config.artStyle.presetId ||
        journeyOf(back, { planReady: true }).well?.kind !== "drawBook" ||
        styleRevert(back) !== null
      ) {
        fail("Keeping the old look should bring the portraits back as current, with Create illustrated book next.");
      }
      const member = namedCast(briefOf(restyled.config))[0]!;
      const oneRedrawn = withAuthoring(restyled, {
        portraits: {
          ...restyled.authoringState?.portraits,
          [member.id]: createVersionTree({
            blobId: "portrait-new-look",
            mimeType: "image/png",
            createdAt: 99,
            inputs: portraitInputs(restyled, member),
          }),
        },
      });
      cases += 1;
      if (styleRevert(oneRedrawn) !== null) {
        fail("Once a portrait is redrawn in the new look, going back would waste it, so it must not be offered.");
      }
      const allRedrawn = withAuthoring(restyled, {
        portraits: Object.fromEntries(
          namedCast(briefOf(restyled.config)).map((person, index) => [
            person.id,
            createVersionTree({
              blobId: `portrait-new-${person.id}`,
              mimeType: "image/png",
              createdAt: 100 + index,
              inputs: portraitInputs(restyled, person),
            }),
          ]),
        ),
      });
      cases += 1;
      if (journeyOf(allRedrawn, { planReady: true }).well?.kind !== "drawBook") {
        fail("After the portraits are redrawn, the book's button should come back as its own step.");
      }
      // Two changes in a row still go back to the look the pictures are in.
      const twice = noteStyleChange(restyled, {
        ...restyled,
        config: { ...restyled.config, artStyle: { presetId: "__a-third-look__", origin: "preset" } },
      });
      cases += 1;
      if (styleRevert(twice)?.presetId !== setupChosen.config.artStyle.presetId) {
        fail("A second style change must keep the look the portraits were drawn in, not the one in between.");
      }
      // Changing nothing, or changing before anything is drawn, remembers nothing.
      cases += 1;
      if (
        noteStyleChange(setupChosen, setupChosen) !== setupChosen ||
        authoringOf(noteStyleChange(portraitFirst, { ...portraitFirst, config: { ...portraitFirst.config, artStyle: other.config.artStyle } })).styleBefore !== undefined
      ) {
        fail("A style change with no drawn portrait must not remember anything.");
      }
      // A stored look that isn't one reads as absent.
      cases += 1;
      if (
        authoringOf({ authoringState: { version: 1, styleBefore: { presetId: 7 } } as never }).styleBefore !== undefined ||
        authoringOf({ authoringState: { version: 1, styleBefore: "watercolor" } as never }).styleBefore !== undefined
      ) {
        fail("A stored previous look that isn't a style should read as absent.");
      }
    }

    // Too short for a hardcover: the question stands alone, with only its two answers.
    const short = {
      case: "short" as const,
      pages: 20,
      naturalPages: 18,
      wordsPerPage: 30,
      hardcoverMin: 24,
      softcoverPages: 20,
      printable: true,
    };
    const asked = journeyOf(setupChosen, { planReady: true, hardcover: short }).well;
    cases += 1;
    if (asked?.kind !== "hardcoverChoice" || asked.min !== 24 || asked.pages !== 20) {
      fail(`A short story should ask "spread it or keep it short?" on its own (got ${asked?.kind}).`);
    }
    for (const decision of ["thin", "keep"] as const) {
      const decided = journeyOf(withAuthoring(setupChosen, { hardcover: decision }), { planReady: true, hardcover: short });
      cases += 1;
      if (decided.well?.kind !== "drawBook") {
        fail(`After "${decision}" the hardcover question should give way to Draw the book (got ${decided.well?.kind}).`);
      }
    }
  }
}

// --- Hidden character preparation ------------------------------------------

{
  const candidate = GUIDE_BOOK_STATES.map(({ project }) => project).find(
    (project) =>
      Boolean(project.config.storyBrief?.cast?.[0]) &&
      Boolean(project.anchors?.some((anchor) => anchor.type === "character")),
  );
  if (candidate) {
    const member = candidate.config.storyBrief!.cast![0]!;
    const anchorIndex = candidate.anchors!.findIndex(
      (anchor) =>
        anchor.type === "character" &&
        anchor.name.trim().toLocaleLowerCase() ===
          member.name.trim().toLocaleLowerCase(),
    );
    if (anchorIndex >= 0) {
      const originalAnchor = candidate.anchors![anchorIndex]!;
      const upload = {
        blobId: "reader-drawing",
        mimeType: "image/png",
        createdAt: 1,
      };
      const portraitOne = {
        blobId: "portrait-one",
        mimeType: "image/png",
        createdAt: 2,
        inputs: portraitInputs(candidate, member),
      };
      const withPortrait = withAuthoring(
        {
          ...candidate,
          anchors: candidate.anchors!.map((anchor, index) =>
            index === anchorIndex
              ? { ...anchor, sourceArt: [upload], versions: undefined }
              : anchor,
          ),
        },
        {
          portraits: {
            ...candidate.authoringState?.portraits,
            [member.id]: createVersionTree(portraitOne),
          },
        },
      );
      const seeded = withPortraitAnchorReferences(withPortrait);
      const seededAnchor = seeded.anchors![anchorIndex]!;
      cases += 1;
      if (
        seededAnchor.sourceArt?.[0]?.blobId !== portraitOne.blobId ||
        seededAnchor.sourceArt[0]?.origin !== "portrait" ||
        !seededAnchor.sourceArt.some((image) => image.blobId === upload.blobId)
      ) {
        fail("A portrait should become the canonical hidden character input without deleting a reader drawing.");
      }

      // The portrait is the book's own picture: only what the reader uploaded is artwork to read a look from.
      const readable = collectSourceArtGroups(seeded).flatMap((group) => group.images.map((image) => image.blobId));
      cases += 1;
      if (readable.includes(portraitOne.blobId) || !readable.includes(upload.blobId)) {
        fail("A portrait was offered as the reader's artwork, or the reader's own drawing was lost with it.");
      }
      const portraitOnly = withPortraitAnchorReferences(
        withAuthoring(
          {
            ...candidate,
            anchors: candidate.anchors!.map((anchor, index) =>
              index === anchorIndex ? { ...anchor, sourceArt: undefined, versions: undefined } : anchor,
            ),
          },
          { portraits: { [member.id]: createVersionTree(portraitOne) } },
        ),
      );
      cases += 1;
      if (
        !portraitOnly.anchors![anchorIndex]!.sourceArt?.some((image) => image.origin === "portrait") ||
        collectSourceArtGroups(portraitOnly).some((group) => group.images.some((image) => image.origin === "portrait"))
      ) {
        fail("A book with only portraits was read as having the reader's artwork, so the story analysis described the pictures.");
      }

      const signatureOne = anchorSignature(seededAnchor);
      const portraitTwo = { ...portraitOne, blobId: "portrait-two", createdAt: 3 };
      const redrawn = withPortraitAnchorReferences(
        withAuthoring(seeded, {
          portraits: {
            ...seeded.authoringState?.portraits,
            [member.id]: createVersionTree(portraitTwo),
          },
        }),
      );
      const redrawnAnchor = redrawn.anchors![anchorIndex]!;
      cases += 1;
      if (
        redrawnAnchor.sourceArt?.[0]?.blobId !== portraitTwo.blobId ||
        redrawnAnchor.sourceArt.filter((image) => image.origin === "portrait").length !== 1 ||
        !redrawnAnchor.sourceArt.some((image) => image.blobId === upload.blobId)
      ) {
        fail("A new portrait should replace only the old portrait-derived input.");
      }
      cases += 1;
      if (anchorSignature(redrawnAnchor) === signatureOne) {
        fail("Changing the canonical portrait should invalidate hidden character preparation.");
      }

      const legacyImageAnchor = {
        ...seededAnchor,
        versions: createVersionTree({
          blobId: "legacy-character",
          mimeType: "image/png",
        }),
      };
      const legacyImageProject: Project = {
        ...seeded,
        anchors: seeded.anchors!.map((anchor, index) =>
          index === anchorIndex ? legacyImageAnchor : anchor,
        ),
      };
      cases += 1;
      if (anchorImageIsCurrent(legacyImageProject, legacyImageAnchor)) {
        fail("A legacy character image with no input receipt must not bypass a new portrait.");
      }

      const signed = {
        ...seededAnchor,
        versions: createVersionTree({
          blobId: "prepared-character",
          mimeType: "image/png",
          references: [
            {
              anchorId: seededAnchor.id,
              signature: anchorSignature(seededAnchor),
              textOnly: true,
            },
          ],
        }),
      };
      const prepared: Project = {
        ...seeded,
        anchors: seeded.anchors!.map((anchor, index) =>
          index === anchorIndex ? signed : anchor,
        ),
      };
      cases += 1;
      if (!anchorImageIsCurrent(prepared, signed)) {
        fail("Fresh hidden character preparation should match its portrait-derived input.");
      }
      const changed: Project = {
        ...prepared,
        anchors: prepared.anchors!.map((anchor, index) =>
          index === anchorIndex
            ? { ...anchor, sourceArt: redrawnAnchor.sourceArt }
            : anchor,
        ),
      };
      cases += 1;
      if (!anchorsToPrepare(changed).some((anchor) => anchor.id === signed.id)) {
        fail("A changed portrait should put hidden character preparation back into the cascade.");
      }

      const locked = withAuthoring(changed, {
        lockedAt: 1,
        drawBook: { quoteId: "quote", startedAt: 1, phase: "cast" },
      });
      const failed = journeyOf(locked, {
        drawPhase: "cast",
        failedUnits: { [signed.id]: { error: "render failed" } },
      });
      cases += 1;
      if (failed.well?.kind !== "bookPrepFix" || failed.composer) {
        fail("Failed hidden preparation should stop page generation and offer one friendly retry.");
      }
    }
  }

  // The server book job: nothing to fix while it runs. Once it is over, undrawn
  // pictures are explained without another charge, and a refusal still offers
  // a fresh price because nothing was drawn.
  const planned = GUIDE_BOOK_STATES.map((state) => state.project).find((p) => p.screenplay);
  if (planned) {
    const serverRun = withAuthoring(planned, {
      lockedAt: 1,
      drawBook: { quoteId: "quote", startedAt: 1, phase: "pages", jobId: "book-quote" },
    });
    const running = journeyOf(serverRun, { drawPhase: "pages" });
    cases += 1;
    if (running.well?.kind === "bookFinish" || running.well?.kind === "pageFix") {
      fail("A running book job should not offer a retry: the server retries on its own.");
    }
    const pageId = illustrationUnits(planned)[0]?.id;
    if (pageId) {
      const midFailure = journeyOf(serverRun, {
        drawPhase: "pages",
        failedUnits: { [pageId]: { error: "No image returned" } },
      });
      cases += 1;
      if (
        midFailure.well?.kind === "bookFinish" ||
        midFailure.well?.kind === "pageFix" ||
        midFailure.well?.kind === "bookPrepFix"
      ) {
        fail("A running book job keeps a failed page instead of asking for another payment.");
      }
    }
    const over = withAuthoring(serverRun, {
      drawBook: { quoteId: "quote", startedAt: 1, phase: "done", jobId: "book-quote" },
    });
    const finished = journeyOf(over, { drawPhase: "done" });
    cases += 1;
    if (finished.well?.kind !== "bookFinish" || finished.well.missing < 1 || !finished.well.settled) {
      fail("A finished book job with undrawn pictures should say so (the well then offers the retry; nothing missing was charged).");
    }
    const refusedRun = withAuthoring(serverRun, {
      drawBook: { quoteId: "quote", startedAt: 1, phase: "done", jobId: "book-quote", error: "Not enough Sparks." },
    });
    const refused = journeyOf(refusedRun, { drawPhase: "done" });
    cases += 1;
    if (refused.well?.kind !== "bookFinish" || refused.well.error !== "Not enough Sparks." || refused.well.settled) {
      fail("A refused book job should say why and offer a fresh price.");
    }
  } else {
    fail("No sample book has a page plan to walk the book job against.");
  }

  cases += 1;
  const preparing = guideActivity({
    drawPhase: "cast",
    preparation: { done: 1, total: 2 },
  });
  if (
    preparing?.id !== "preparingBook" ||
    preparing.done !== 1 ||
    preparing.total !== 2
  ) {
    fail("Hidden consistency work should have its own reader-friendly progress.");
  }
}

// --- Drawing-first style source ----------------------------------------------

{
  const base = GUIDE_BOOK_STATES[0]!.project;
  const ref = { blobId: "drawing-1", mimeType: "image/jpeg", createdAt: 1 };
  const withoutCast: Project = {
    ...base,
    config: {
      ...base.config,
      storyBrief: { ...base.config.storyBrief, cast: [], heroNames: [] },
      styleReady: false,
    },
  };
  const staged = stageStyleSource(withoutCast, ref);
  cases += 1;
  if (collectSourceArtGroups(staged)[0]?.images[0]?.blobId !== ref.blobId) {
    fail("A drawing uploaded before cast extraction should be available to style extraction.");
  }
  cases += 1;
  if (!collectProjectImageBlobIds(staged).has(ref.blobId)) {
    fail("Project blob accounting dropped a staged style drawing.");
  }
  const slim = slimProjectForRender(staged, { keepStyleSourceArt: true });
  cases += 1;
  if (slim.authoringState?.styleSourceArt?.[0]?.blobId !== ref.blobId) {
    fail("The style-extraction payload dropped the staged drawing.");
  }

  const oneCast: Project = {
    ...staged,
    config: {
      ...staged.config,
      storyBrief: {
        ...staged.config.storyBrief,
        cast: [{ id: "maya", name: "Maya" }],
        heroNames: ["Maya"],
      },
    },
  };
  const assigned = autoAssignStyleSource(oneCast);
  cases += 1;
  if (
    assigned.authoringState?.styleSourceArt ||
    assigned.config.storyBrief?.cast?.[0]?.sourceArt?.[0]?.blobId !== ref.blobId
  ) {
    fail("One extracted character should automatically receive the staged drawing.");
  }

  const twoCast: Project = {
    ...staged,
    config: {
      ...staged.config,
      storyBrief: {
        ...staged.config.storyBrief,
        cast: [
          { id: "maya", name: "Maya" },
          { id: "leo", name: "Leo" },
        ],
        heroNames: ["Maya", "Leo"],
      },
    },
  };
  cases += 1;
  if (!autoAssignStyleSource(twoCast).authoringState?.styleSourceArt) {
    fail("A drawing should not be guessed onto one of several extracted characters.");
  }
  const leo = assignStyleSource(twoCast, "leo");
  cases += 1;
  if (
    leo.authoringState?.styleSourceArt ||
    leo.config.storyBrief?.cast?.find((member) => member.id === "leo")?.sourceArt?.[0]?.blobId !==
      ref.blobId
  ) {
    fail("The reader's character choice should move the staged drawing onto that character.");
  }

  const unresolved = withAuthoring(twoCast, {
    extraction: {
      storyHash: manuscriptHash(twoCast.config.storyText),
      at: 1,
      names: ["Maya", "Leo"],
      unresolved: ["Maya"],
    },
  });
  cases += 1;
  if (withCastResolved(unresolved).authoringState?.extraction?.unresolved.length !== 0) {
    fail("Confirming corrected cast plates should unblock the own-words pipeline.");
  }
}

// --- Layout -----------------------------------------------------------------

for (const width of [320, GUIDE_MOBILE_MAX, GUIDE_MOBILE_MAX + 1, 1024, 1280, GUIDE_CHAT_COLUMN_PX + GUIDE_FOCUS_MIN_PANE, 1920]) {
  for (const hasBook of [false, true]) {
    for (const focusRequested of [false, true]) {
      const layout = guideLayout({ width, hasBook, focusRequested });
      cases += 1;
      if (width <= GUIDE_MOBILE_MAX && layout !== "mobile") fail(`A ${width}px window should be mobile, got ${layout}.`);
      if (width > GUIDE_MOBILE_MAX && !hasBook && layout !== "centered") {
        fail(`With no book a ${width}px window should be centered, got ${layout}.`);
      }
      if (width > GUIDE_MOBILE_MAX && hasBook && !focusRequested && layout !== "split") {
        fail(`With a book a ${width}px window should be split, got ${layout}.`);
      }
      if (layout === "focus" && width - GUIDE_CHAT_COLUMN_PX >= GUIDE_FOCUS_MIN_PANE) {
        fail(`A ${width}px window has room for the chat beside the page, but hides it.`);
      }
    }
  }
}

// --- Targeting ----------------------------------------------------------------

{
  const cast = [
    { id: "a", name: "Maya" },
    { id: "b", name: "Leo" },
  ];
  const one = resolveGuideTarget({ sentence: "Make Maya's hair curlier", chip: null, cast });
  cases += 1;
  if (one.kind !== "target" || one.target.kind !== "person" || one.target.castId !== "a") {
    fail("A sentence naming one person should target that person.");
  }
  const both = resolveGuideTarget({ sentence: "Maya and Leo should wear hats", chip: null, cast });
  cases += 1;
  if (both.kind !== "targets" || both.people.map((person) => person.id).join() !== "a,b") {
    fail("A sentence naming two people with no chip is about both of them, not a question of which.");
  }
  const bothWithFace = resolveGuideTarget({
    sentence: "Make Maya and Leo blonde",
    chip: { kind: "person", castId: "a", name: "Maya" },
    cast,
  });
  cases += 1;
  if (bothWithFace.kind !== "targets") fail("A selected face hides the second person the sentence names.");
  const inView = resolveGuideTarget({
    sentence: "make the hair blonde",
    chip: null,
    cast,
    inView: cast,
  });
  cases += 1;
  if (inView.kind !== "ask") fail("A sentence naming nobody, with several people in view, should ask which.");
  const page = resolveGuideTarget({
    sentence: "Maya and Leo should wear hats",
    chip: { kind: "page", unitId: "spread-1", page: 2 },
    cast,
  });
  cases += 1;
  if (page.kind !== "target" || page.target.kind !== "page") fail("A page chip is one target however many people are on it.");
  const nobody = resolveGuideTarget({ sentence: "brighter please", chip: null, cast });
  cases += 1;
  if (nobody.kind === "target") fail("A sentence naming nobody, with no chip, should not guess a target.");
}

// --- Hardcover check -----------------------------------------------------------

{
  const config = GUIDE_BOOK_STATES[0]!.project.config;
  const { hardcover, softcover } = shapeProducts(config);
  for (const words of [8, 40, 120, 400, 1200, 4000]) {
    for (const wpp of [8, 20, 60]) {
      for (const decision of [undefined, "keep", "thin", "spread"] as const) {
        const storyText = Array.from({ length: 6 }, () => Array.from({ length: Math.ceil(words / 6) }, () => "word").join(" ")).join("\n\n");
        const check = hardcoverCheck({ ...config, storyText }, { targetWordsPerPage: wpp }, decision);
        cases += 1;
        if (check.printable) {
          const product = check.case === "short" ? softcover : (hardcover ?? softcover);
          if (product && roundPages(product, check.pages) !== check.pages) {
            fail(`The hardcover check settled on ${check.pages} pages, which the product doesn't sell.`);
          }
        }
        if (check.case === "thin" && decision !== "thin") fail("A thin book was chosen without the reader agreeing.");
      }
    }
  }
}

// --- Two devices ------------------------------------------------------------------

{
  const base = GUIDE_BOOK_STATES[GUIDE_BOOK_STATES.length - 1]!.project;
  const mine: Project = { ...base, title: "Mine", rev: 1 };
  const theirs: Project = { ...base, config: { ...base.config, storyText: "Their story." }, rev: 2 };
  const clean = mergeBooks(base, mine, theirs);
  cases += 1;
  if (clean.conflicts.length > 0 || clean.project.title !== "Mine" || clean.project.config.storyText !== "Their story.") {
    fail("Independent changes on two devices should merge without asking.");
  }
  cases += 1;
  if (clean.project.rev !== 2) fail("A merged book should carry the stored revision it was merged onto.");

  const clash: Project = { ...theirs, title: "Theirs" };
  const both = mergeBooks(base, mine, clash);
  cases += 1;
  if (!both.conflicts.includes("title") || both.conflicts.includes("config.storyText")) {
    fail(`Only the field both devices changed should conflict (got ${both.conflicts.join(", ")}).`);
  }
  for (const keep of ["mine", "theirs"] as const) {
    const settled = resolveBookConflict(both.project, mine, clash, both.conflicts, keep, 1);
    cases += 1;
    if (settled.title !== (keep === "mine" ? "Mine" : "Theirs")) fail(`Keeping ${keep} did not keep ${keep}.`);
    cases += 1;
    const lost = settled.authoringState?.replaced?.[0]?.fields.title;
    if (lost !== (keep === "mine" ? "Theirs" : "Mine")) fail(`Keeping ${keep} lost the other device's title.`);
  }
}

// --- Page design on two devices, and in Undo ---------------------------------------

{
  const box = (id: string, size: number) =>
    ({ id, rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 }, z: 1, presetId: "plain", fontFamily: "Fredoka", fontSizePct: size, color: "#111", align: "left", vAlign: "top", lineHeight: 1.3, paragraphs: [] }) as unknown as import("../books-frontend/src/core/design").TextBox;
  const page = (size: number) => ({ textBoxes: [box("b", size)] });
  const design = (pages: Record<string, ReturnType<typeof page>>) =>
    ({ defaultFontFamily: "Fredoka", defaultFontSizePct: 0.04, pages }) as unknown as NonNullable<Project["design"]>;
  const seed = GUIDE_BOOK_STATES[GUIDE_BOOK_STATES.length - 1]!.project;
  const base: Project = { ...seed, design: design({ p1: page(0.04), p2: page(0.04) }) };

  // Two devices restyled different pages: both survive and nobody is asked.
  const mine: Project = { ...base, design: design({ p1: page(0.06), p2: page(0.04) }), rev: 1 };
  const theirs: Project = { ...base, design: design({ p1: page(0.04), p2: page(0.07) }), rev: 2 };
  const apart = mergeBooks(base, mine, theirs);
  cases += 1;
  if (apart.conflicts.length > 0) fail(`Restyling different pages should merge (got ${apart.conflicts.join(", ")}).`);
  cases += 1;
  const pages = apart.project.design?.pages ?? {};
  if (pages.p1?.textBoxes[0]?.fontSizePct !== 0.06 || pages.p2?.textBoxes[0]?.fontSizePct !== 0.07) {
    fail("A merge of two pages' design lost one device's change.");
  }

  // The same page restyled differently on both: that page is the question.
  const clashing: Project = { ...theirs, design: design({ p1: page(0.09), p2: page(0.07) }) };
  const same = mergeBooks(base, mine, clashing);
  cases += 1;
  if (same.conflicts.join() !== "design.pages.p1") {
    fail(`Only the page both devices changed should conflict (got ${same.conflicts.join(", ")}).`);
  }
  for (const keep of ["mine", "theirs"] as const) {
    const settled = resolveBookConflict(same.project, mine, clashing, same.conflicts, keep, 1);
    cases += 1;
    if (settled.design?.pages.p1?.textBoxes[0]?.fontSizePct !== (keep === "mine" ? 0.06 : 0.09)) {
      fail(`Keeping ${keep} on a page conflict did not keep ${keep}.`);
    }
  }

  // Undo puts back only the pages a turn changed.
  const after: Project = { ...base, design: design({ p1: page(0.08), p2: page(0.04), p3: page(0.05) }) };
  const saved = JSON.parse(snapshotForChange(base, after)) as Record<string, unknown>;
  cases += 1;
  if (Object.keys((saved.designPages as object) ?? {}).sort().join() !== "p1,p3") {
    fail("The undo snapshot should hold exactly the changed pages.");
  }
  const back = restoreDesign(after, saved);
  cases += 1;
  if (
    back.design?.pages.p1?.textBoxes[0]?.fontSizePct !== 0.04 ||
    back.design?.pages.p3 !== undefined ||
    back.design?.pages.p2 === undefined
  ) {
    fail("Undo did not put the changed pages back and leave the others alone.");
  }
  cases += 1;
  if ("designPages" in JSON.parse(snapshotForChange(base, base))) fail("A turn that left the design alone should not snapshot it.");
}

{
  const picture = {
    id: "im",
    kind: "illustration" as const,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    z: 0,
    fit: "cover" as const,
  };
  const bare = {
    version: 1,
    defaultFontFamily: "Itim",
    defaultFontSizePct: 0.04,
    pages: {
      "cover-front": { textBoxes: [], images: [{ ...picture, id: "cover" }] },
      p1: { textBoxes: [], images: [{ ...picture }] },
    },
  } as BookDesign;
  const framed = applyAutomaticBookFrame(bare, "mask-1");
  cases += 1;
  if (framed.defaultImageMaskId !== "mask-1" || framed.pages.p1?.images?.[0]?.imageMaskId !== "mask-1") {
    fail("A new book should keep one checked frame on its story pages.");
  }
  cases += 1;
  if (framed.pages["cover-front"]?.images?.[0]?.imageMaskId) fail("Covers stay unframed.");
  cases += 1;
  if (applyAutomaticBookFrame(framed, "mask-2") !== framed) fail("A frame already chosen is not rolled again.");
  const cutout = applyAutomaticBookFrame(framed, "mask-1", { transparentPageIds: new Set(["p1"]) });
  cases += 1;
  if (cutout.pages.p1?.images?.[0]?.imageMaskId || cutout.defaultImageMaskId !== "mask-1") {
    fail("Transparent cutout art stays unframed without forgetting the book's frame.");
  }
  const original = withIllustrationFrame(
    {
      ...bare,
      defaultImageMaskId: "mask-1",
      pages: {
        ...bare.pages,
        p1: { textBoxes: [], images: [{ ...picture, frameSource: "none" }] },
      },
    },
    "p1",
    { imageMaskId: "mask-1", frameSource: "auto" },
  );
  cases += 1;
  if (original.pages.p1?.images?.[0]?.frameSource !== "none") {
    fail("An explicit original picture is not framed again.");
  }
}

report.push("Chat journey");
report.push(`  phases reached: ${[...phases.entries()].map(([phase, n]) => `${phase} ×${n}`).join(", ")}`);
notes.push(`${GUIDE_BOOK_STATES.length * 2} books walked through the journey, guided and own words`);

export function checkGuideJourney(): CheckResult {
  return { failures, notes, report, cases };
}
