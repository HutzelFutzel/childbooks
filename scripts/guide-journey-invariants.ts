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
import { guideActivity } from "../books-frontend/src/core/guide/activity";
import { deriveJourney, type Journey } from "../books-frontend/src/core/guide/journey";
import { guideLayout, GUIDE_MOBILE_MAX, GUIDE_CHAT_COLUMN_PX, GUIDE_FOCUS_MIN_PANE } from "../books-frontend/src/core/guide/layout";
import { hardcoverCheck, roundPages, shapeProducts } from "../books-frontend/src/core/guide/hardcover";
import { resolveGuideTarget } from "../books-frontend/src/core/guide/target";
import { withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { mergeBooks, resolveBookConflict } from "../books-frontend/src/core/guide/merge";
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
  portraitInputs,
  withPortraitAnchorReferences,
} from "../books-frontend/src/core/guide/portrait";
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
import type { Project } from "../books-frontend/src/core/types";
import { GUIDE_BOOK_STATES } from "./guide-engine-invariants";

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
    (opening.phase !== "opening" || opening.well !== null || !opening.composer || opening.hasBook)
  ) {
    fail(
      `A book with no entry should have one composer and no book/well ` +
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

    // Portraits are not offered while any of them is running.
    if (journey.well?.kind === "portraits") {
      const busy = journeyOf(book, { activeUnitIds: new Set([journey.well.castIds[0]!]) });
      cases += 1;
      if (busy.well?.kind === "portraits") {
        fail(`"${name}" (${entry}) offers portraits again while one is being drawn.`);
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
        extraction: {
          storyHash: manuscriptHash(bookCandidate.config.storyText),
          at: 1,
          names: (bookCandidate.config.storyBrief?.cast ?? []).map((member) => member.name),
          unresolved: [],
        },
      },
    );
    cases += 1;
    if (journeyOf(portraitFirst).well?.kind !== "portraits") {
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
    const setupChosen = withAuthoring(formatChosen, {
      bookSetup: { formatConfirmedAt: 1, layoutConfirmedAt: 2 },
    });
    cases += 1;
    if (journeyOf(setupChosen, { planReady: false }).well?.kind === "drawBook") {
      fail("Create illustrated book must wait for a page plan matching the reviewed setup.");
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

  // The server book job: nothing to fix while it runs; one action for all
  // that's left once it's over, and the refusal reason when it never ran.
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
    const over = withAuthoring(serverRun, {
      drawBook: { quoteId: "quote", startedAt: 1, phase: "done", jobId: "book-quote" },
    });
    const finished = journeyOf(over, { drawPhase: "done" });
    cases += 1;
    if (finished.well?.kind !== "bookFinish" || finished.well.missing < 1) {
      fail("A finished book job with undrawn pictures should offer to draw the rest.");
    }
    const refusedRun = withAuthoring(serverRun, {
      drawBook: { quoteId: "quote", startedAt: 1, phase: "done", jobId: "book-quote", error: "Not enough Sparks." },
    });
    const refused = journeyOf(refusedRun, { drawPhase: "done" });
    cases += 1;
    if (refused.well?.kind !== "bookFinish" || refused.well.error !== "Not enough Sparks.") {
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
  if (both.kind !== "ask") fail("A sentence naming two people with no chip should ask which.");
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

report.push("Chat journey");
report.push(`  phases reached: ${[...phases.entries()].map(([phase, n]) => `${phase} ×${n}`).join(", ")}`);
notes.push(`${GUIDE_BOOK_STATES.length * 2} books walked through the journey, guided and own words`);

export function checkGuideJourney(): CheckResult {
  return { failures, notes, report, cases };
}
