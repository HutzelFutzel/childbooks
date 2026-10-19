/**
 * Invariants for the conversation layer: what the guide stores.
 *
 * The facts strip, recorded skips and the saved transcript are checked here. The
 * saved document may have been written by any past or future build, and it must
 * never be a reason the chat fails to open, so normalization is fuzzed with junk
 * and asserted total.
 *
 * Offline and deterministic: the same synthesized book states the engine is proven
 * against, and pure functions. No network, no React, no model call.
 */
import {
  GUIDE_COMPONENTS,
  GUIDE_COMPONENT_IDS,
  type GuideComponentId,
} from "../books-frontend/src/core/guide/components";
import {
  createDefaultGuidePlaylist,
  normalizeGuidePlaylist,
  resolveGuidePlaylist,
} from "../books-frontend/src/core/guide/playlist";
import {
  coveredGuideSlots,
  nextGuideStep,
  type GuideCursor,
} from "../books-frontend/src/core/guide/engine";
import {
  appendGuideMessage,
  createGuideSession,
  guideMessage,
  guideTranscriptWindow,
  lastSpokenAbout,
  normalizeGuideSession,
  withGuideSkips,
  MAX_GUIDE_MESSAGES,
  type GuideSession,
} from "../books-frontend/src/core/guide/session";
import { withGuidedBriefIfMissing } from "../books-frontend/src/core/story/brief";
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

const playlist = resolveGuidePlaylist(createDefaultGuidePlaylist());
const declinable = (id: GuideComponentId) => GUIDE_COMPONENTS[id].skippable;

// --- The facts strip only shows facts the reader has been asked about --------

/**
 * Nearly every field in a book config ships with a working default, so a facts strip
 * built from "everything with a value" greets a reader who has answered nothing by
 * telling them their trim size and page layout. `coveredGuideSlots` is the rule that
 * prevents it, and these are the properties it has to have.
 */
{
  const ownerOf = new Map<string, GuideComponentId>();
  for (const component of playlist) {
    for (const slot of component.slots) if (!ownerOf.has(slot)) ownerOf.set(slot, component.id);
  }
  const positionOf = new Map(playlist.map((component, index) => [component.id, index]));

  for (const { name, project } of GUIDE_BOOK_STATES) {
    const cursor = nextGuideStep(playlist, project, []);
    const covered = coveredGuideSlots(playlist, project, []);
    const limit = cursor.component ? positionOf.get(cursor.component.id)! : playlist.length - 1;

    cases += 1;
    if (new Set(covered).size !== covered.length) {
      fail(`A "${name}" book's facts strip listed the same fact twice.`);
    }

    // Nothing from beyond the current question.
    for (const slot of covered) {
      const owner = ownerOf.get(slot);
      cases += 1;
      if (owner === undefined) {
        fail(`A "${name}" book's facts strip showed "${slot}", which no component owns.`);
      } else if (positionOf.get(owner)! > limit) {
        fail(
          `A "${name}" book's facts strip showed "${slot}" from "${owner}", which the ` +
            `guide hasn't reached (it's asking "${cursor.component?.id ?? "nothing"}").`,
        );
      }
    }

    // And everything up to it: a fact already discussed must not vanish from the
    // strip, which is the failure that would make a reader re-state something.
    for (const component of playlist.slice(0, limit + 1)) {
      for (const slot of component.slots) {
        cases += 1;
        if (!covered.includes(slot)) {
          fail(`A "${name}" book's facts strip dropped "${slot}" from the already-asked "${component.id}".`);
        }
      }
    }
  }

  // The case that prompted the rule, named explicitly so it can't regress quietly.
  const fresh = coveredGuideSlots(playlist, GUIDE_BOOK_STATES[0]!.project, []);
  for (const slot of ["trim", "layout", "artStyle", "storyText"]) {
    cases += 1;
    if (fresh.includes(slot as never)) {
      fail(`A brand-new book's facts strip showed "${slot}" before anyone was asked about it.`);
    }
  }
  notes.push(`facts strip covered ${fresh.length} of ${ownerOf.size} slots on a fresh book`);
}

// --- Skips are recorded honestly -------------------------------------------

// A required component can never be recorded as declined. The engine ignores such a
// skip anyway, but storing one leaves a permanent instruction that reads as honoured.
{
  const required = GUIDE_COMPONENT_IDS.filter((id) => !declinable(id));
  const session = withGuideSkips(createGuideSession(), required, declinable);
  cases += 1;
  if (session.skipped.length > 0) {
    fail(`Required components were recorded as declined: ${session.skipped.join(", ")}.`);
  }
}
for (const id of GUIDE_COMPONENT_IDS.filter(declinable)) {
  const once = withGuideSkips(createGuideSession(), [id], declinable);
  const twice = withGuideSkips(once, [id], declinable);
  cases += 1;
  if (once.skipped.length !== 1) fail(`Declining "${id}" wasn't recorded.`);
  cases += 1;
  if (twice.skipped.length !== 1) fail(`Declining "${id}" twice recorded it twice.`);
  cases += 1;
  // Unchanged input must return the same object, or every render writes storage.
  if (twice !== once) fail(`Re-declining "${id}" produced a new session for no change.`);
}

// --- Storage never breaks the chat -----------------------------------------

/**
 * Fed a document written by any build, past or future. The contract is total: always
 * a usable session, never a throw, and never an id the engine can't interpret.
 */
const junk: unknown[] = [
  undefined,
  null,
  0,
  "",
  "session",
  [],
  {},
  { version: 9 },
  { messages: null, skipped: null },
  { messages: "hello", skipped: "story-idea" },
  { messages: [null, 1, "x", {}, []], skipped: [null, 1, {}] },
  { messages: [{ role: "system", text: "hi" }] },
  { messages: [{ role: "reader" }] },
  { messages: [{ role: "reader", text: "   " }] },
  { messages: [{ role: "guide", text: "hi", about: "no-such-component" }] },
  { messages: [{ role: "guide", text: "hi", about: "__proto__" }] },
  { messages: [{ role: "reader", text: "hi", applied: ["heroes", "pageArt", "nope"] }] },
  { messages: [{ role: "reader", text: "hi", at: Number.NaN }] },
  { messages: [{ role: "reader", text: "hi", at: "yesterday" }] },
  { skipped: ["story-idea", "story-idea", "story-draft", "__proto__", "constructor"] },
  { messages: Array.from({ length: MAX_GUIDE_MESSAGES * 3 }, () => ({ role: "reader", text: "x" })) },
];

for (const input of junk) {
  cases += 1;
  let session: GuideSession;
  try {
    session = normalizeGuideSession(input);
  } catch (err) {
    fail(`Reading ${JSON.stringify(input)?.slice(0, 60)} threw: ${(err as Error).message}.`);
    continue;
  }
  if (session.version !== 1) fail("Normalizing produced a session with the wrong version.");
  if (!Array.isArray(session.messages) || !Array.isArray(session.skipped)) {
    fail(`Normalizing ${JSON.stringify(input)?.slice(0, 60)} produced non-arrays.`);
  }
  if (session.messages.length > MAX_GUIDE_MESSAGES) {
    fail(`Normalizing kept ${session.messages.length} messages, over the ${MAX_GUIDE_MESSAGES} cap.`);
  }
  for (const message of session.messages) {
    if (message.role !== "reader" && message.role !== "guide") fail("A message kept an unknown role.");
    if (!message.text.trim()) fail("An empty message survived normalization.");
    if (!Number.isFinite(message.at)) fail("A message kept an unusable timestamp.");
    if (message.about !== undefined && !(message.about in GUIDE_COMPONENTS)) {
      fail(`A message kept "${message.about}", which is not a component.`);
    }
  }
  for (const id of session.skipped) {
    if (!(id in GUIDE_COMPONENTS)) fail(`A skip of "${id}" survived, which is not a component.`);
  }
}

// Round-tripping through storage has to be lossless for a session we wrote, or a
// reload quietly edits the reader's own history.
{
  let session = createGuideSession();
  session = appendGuideMessage(session, guideMessage("guide", "Who is this book for?", { about: "story-cast" }));
  session = appendGuideMessage(session, guideMessage("reader", "Maya, she's 5"));
  session = appendGuideMessage(
    session,
    guideMessage("guide", "Lovely.", { about: "story-idea", applied: ["heroes", "heroAges"] }),
  );
  session = withGuideSkips(session, ["story-idea"], declinable);
  cases += 1;
  // Both sides normalized, so this compares the DATA rather than the key order a
  // conditional spread happens to produce. Losing a field would still show up;
  // `applied` landing before `about` would not, and shouldn't.
  const stored = normalizeGuideSession(JSON.parse(JSON.stringify(session)));
  const canonical = normalizeGuideSession(session);
  if (JSON.stringify(stored) !== JSON.stringify(canonical)) {
    fail("A session we wrote did not survive a storage round-trip unchanged.");
  }
  // And nothing was quietly dropped on the way through.
  cases += 1;
  if (
    stored.messages.length !== session.messages.length ||
    stored.skipped.length !== session.skipped.length ||
    stored.messages[2]?.applied?.length !== 2 ||
    stored.messages[0]?.about !== "story-cast"
  ) {
    fail("A storage round-trip lost part of the conversation.");
  }
}

// The story check's card is kept whole across a reload, and a malformed one is
// dropped rather than shown half-drawn.
{
  const card = {
    verdict: "minor",
    headline: "A good fit, with a thought or two.",
    notes: ["A few long sentences.", "Nice repetition."],
    dimensions: [{ label: "Sentence length", fit: "richer" }],
    band: "4–5",
    textHash: "0123abcd0123abcd",
  };
  const stored = normalizeGuideSession(
    JSON.parse(JSON.stringify({ messages: [{ role: "guide", text: card.headline, fit: card }] })),
  );
  cases += 1;
  if (JSON.stringify(stored.messages[0]?.fit) !== JSON.stringify(card)) fail("A story check card did not survive a storage round-trip.");
  for (const broken of [
    { ...card, verdict: "great" },
    { ...card, textHash: "" },
    { ...card, textHash: 7 },
    "good",
  ]) {
    cases += 1;
    const read = normalizeGuideSession({ messages: [{ role: "guide", text: "x", fit: broken }] });
    if (read.messages[0]?.fit) fail(`A malformed story check card was kept: ${JSON.stringify(broken).slice(0, 60)}.`);
  }
  cases += 1;
  const cleaned = normalizeGuideSession({
    messages: [
      {
        role: "guide",
        text: "x",
        fit: { ...card, notes: ["a", "b", "c", "d", 5], dimensions: [{ label: "Tone", fit: "heavier" }, { label: "Pace", fit: "lighter" }] },
      },
    ],
  }).messages[0]?.fit;
  if (!cleaned || cleaned.notes.length > 3 || cleaned.dimensions.length !== 1) {
    fail("A story check card kept more notes than allowed or a dimension it cannot show.");
  }
}

// The window handed to the interpreter is bounded and excludes failed turns — a
// message that never reached the backend is not part of the conversation.
{
  let session = createGuideSession();
  session = appendGuideMessage(session, guideMessage("reader", "kept"));
  session = appendGuideMessage(session, guideMessage("reader", "lost", { failed: true }));
  const window = guideTranscriptWindow(session, 8);
  cases += 1;
  if (window.some((turn) => turn.text === "lost")) fail("A failed turn was sent as history.");
  cases += 1;
  if (window.length !== 1) fail(`The transcript window had ${window.length} turns, expected 1.`);

  let long = createGuideSession();
  for (let i = 0; i < 50; i += 1) long = appendGuideMessage(long, guideMessage("reader", `m${i}`));
  cases += 1;
  if (guideTranscriptWindow(long, 8).length !== 8) fail("The transcript window ignored its size.");
  cases += 1;
  if (guideTranscriptWindow(long, 8)[7]?.text !== "m49") fail("The transcript window kept the wrong end.");
}

// --- Report -----------------------------------------------------------------

notes.push(
  `${GUIDE_BOOK_STATES.length} book states checked, ${junk.length} malformed documents read`,
);

export function checkGuideSession(): CheckResult {
  return { failures, notes, report, cases };
}
