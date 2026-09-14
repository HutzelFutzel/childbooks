/**
 * Invariants for the conversation layer: what the guide says, and what it stores.
 *
 * The chat surface is the one part of the guide with no obvious failure signal. A
 * wrong model answer gets rejected and logged; a wrong *line* just sits there being
 * wrong, and the two ways it goes wrong are both silent:
 *
 *   1. **Repeating itself.** The guide speaks whenever the book moves without the
 *      reader having said anything — a render lands, the page plan arrives, a fact is
 *      edited in the pane beside the chat. The surface therefore asks "anything to
 *      say?" on every change and relies on the answer being `null` almost always. Get
 *      that comparison wrong and the transcript fills with the same question. So
 *      `nextGuideSay` is driven here across every book state: it must speak exactly
 *      once per question, and must go quiet the moment it has.
 *   2. **Saying nothing, visibly.** An empty or placeholder-looking line is a blank
 *      bubble on screen. Every component in every state has to produce a real
 *      sentence, so that is checked rather than assumed.
 *
 * The storage half is checked for the opposite reason: it is fed a document that may
 * have been written by any past or future build, and it must never be a reason the
 * chat fails to open. Normalization is fuzzed with junk and asserted total.
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
import {
  guideAdvance,
  guideAsk,
  guideSkipAck,
  nextGuideSay,
} from "../books-frontend/src/core/guide/voice";
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

/** Speak, the way the store does: append the line, stamped with its question. */
function speak(session: GuideSession, line: string, cursor: GuideCursor): GuideSession {
  return appendGuideMessage(
    session,
    guideMessage("guide", line, cursor.component ? { about: cursor.component.id } : {}),
  );
}

// --- Every line is a real sentence ------------------------------------------

/**
 * A blank or placeholder line is a blank bubble on screen. Checked over every
 * component in every state rather than over the happy path, because the lines that
 * go wrong are the ones for states nobody demoed: a component blocked on generation,
 * or an optional one with no blocker text of its own.
 */
for (const { name, project } of GUIDE_BOOK_STATES) {
  for (const skipped of [[], GUIDE_COMPONENT_IDS.filter(declinable)] as GuideComponentId[][]) {
    const cursor = nextGuideStep(playlist, project, skipped);
    for (const [label, line] of [
      ["ask", guideAsk(cursor)],
      ["advance", guideAdvance(cursor)],
    ] as const) {
      cases += 1;
      const trimmed = line.trim();
      if (trimmed.length < 12) {
        fail(`The ${label} line for a "${name}" book is too short to be a sentence: "${line}".`);
      }
      if (/undefined|null|\[object|\{\{/.test(trimmed)) {
        fail(`The ${label} line for a "${name}" book leaked a value: "${line}".`);
      }
      // Sentence case and real punctuation: these are read as prose beside a
      // storybook, not as field labels.
      if (trimmed[0] !== trimmed[0]!.toUpperCase()) {
        fail(`The ${label} line for a "${name}" book doesn't start with a capital: "${line}".`);
      }
      if (!/[.!?]$/.test(trimmed)) {
        fail(`The ${label} line for a "${name}" book has no closing punctuation: "${line}".`);
      }
    }

    // A skip acknowledgement has to carry the next question, or declining leaves
    // the reader looking at a dead end.
    if (cursor.component?.skippable) {
      const after = nextGuideStep(playlist, project, [...skipped, cursor.component.id]);
      const ack = guideSkipAck(cursor.component, after);
      cases += 1;
      if (ack.trim().length < 20) {
        fail(`Declining "${cursor.component.id}" on a "${name}" book said almost nothing: "${ack}".`);
      }
    }
  }
}

/**
 * The two cursor states a real book cannot currently reach, exercised directly.
 *
 * `blocked` needs a component that is both declinable and required by another, and
 * the catalog has none — the two skippable components appear in nobody's `requires`,
 * and the playlist editor only lets an admin disable skippable ones. `done` needs an
 * empty tail, and `review` is terminal and never satisfied, so the walk always stops
 * there. Both branches are deliberate defence (a future optional-but-required
 * component, a hand-edited document) and both put a line on screen, so they are
 * checked as the pure functions they are rather than left until the day something
 * makes them reachable.
 */
{
  const blockedCases: GuideCursor[] = [];
  for (const component of playlist) {
    for (const required of component.requires) {
      blockedCases.push({
        component,
        status: "blocked",
        blockedBy: required,
        blockers: component.blockers(GUIDE_BOOK_STATES[0]!.project),
      });
    }
    // The harder shape: blocked with nothing to report, which is what falls through
    // to the "we're getting X ready" line.
    blockedCases.push({ component, status: "blocked", blockers: [] });
  }
  const done: GuideCursor = { component: null, status: "done", blockers: [] };

  for (const cursor of [...blockedCases, done]) {
    const where = cursor.component?.id ?? "done";
    for (const [label, line] of [
      ["ask", guideAsk(cursor)],
      ["advance", guideAdvance(cursor)],
    ] as const) {
      cases += 1;
      const trimmed = line.trim();
      if (trimmed.length < 12) {
        fail(`The ${label} line for a ${cursor.status} "${where}" is too short: "${line}".`);
      }
      if (!/[.!?]$/.test(trimmed) || trimmed[0] !== trimmed[0]!.toUpperCase()) {
        fail(`The ${label} line for a ${cursor.status} "${where}" isn't a sentence: "${line}".`);
      }
      if (/undefined|null|\[object|\{\{/.test(trimmed)) {
        fail(`The ${label} line for a ${cursor.status} "${where}" leaked a value: "${line}".`);
      }
    }
  }

  // Reaching the end has to be said once and then dropped, same as any question.
  const ended = speak(createGuideSession(), guideAdvance(done), done);
  cases += 1;
  if (nextGuideSay(ended, done) !== null) {
    fail("The guide announced a finished book more than once.");
  }
  notes.push(`${blockedCases.length} unreachable cursor states exercised directly`);
}

// --- It speaks once, then goes quiet ---------------------------------------

/**
 * The property that keeps the transcript sane: for any book, the guide has exactly
 * one thing to say about the current question, and nothing more until the book moves.
 *
 * Driven the way the surface drives it — repeatedly, with no change in between —
 * because that is exactly what an effect does on re-render.
 */
for (const { name, project } of GUIDE_BOOK_STATES) {
  const cursor = nextGuideStep(playlist, project, []);
  let session = createGuideSession();

  const opening = nextGuideSay(session, cursor);
  cases += 1;
  if (!opening) {
    fail(`A "${name}" book opened with the guide saying nothing at all.`);
    continue;
  }
  session = speak(session, opening, cursor);

  // Ten more passes with the book unchanged. Every one has to be silent.
  for (let i = 0; i < 10; i += 1) {
    cases += 1;
    const again = nextGuideSay(session, cursor);
    if (again !== null) {
      fail(`A "${name}" book had the guide repeat itself: "${again}".`);
      break;
    }
  }

  // And the receipt of what it spoke about is readable back, which is what the
  // silence above depends on.
  cases += 1;
  if (lastSpokenAbout(session) !== (cursor.component?.id ?? null)) {
    fail(`A "${name}" book didn't record which question the guide asked.`);
  }
}

/**
 * When the book DOES move, it speaks again. Checked by walking consecutive states
 * from the ladder: wherever the cursor differs, a session that spoke about the old
 * question must have something to say about the new one.
 */
for (let i = 1; i < GUIDE_BOOK_STATES.length; i += 1) {
  const before = GUIDE_BOOK_STATES[i - 1]!;
  const after = GUIDE_BOOK_STATES[i]!;
  const wasAt = nextGuideStep(playlist, before.project, []);
  const nowAt = nextGuideStep(playlist, after.project, []);
  if ((wasAt.component?.id ?? null) === (nowAt.component?.id ?? null)) continue;

  const session = speak(createGuideSession(), guideAsk(wasAt), wasAt);
  cases += 1;
  if (!nextGuideSay(session, nowAt)) {
    fail(
      `Going from a "${before.name}" to a "${after.name}" book moved the guide to ` +
        `"${nowAt.component?.id ?? "done"}" and it said nothing.`,
    );
  }
}

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

report.push("What the guide says, as a book is made");
for (const { name, project } of GUIDE_BOOK_STATES.slice(0, 15)) {
  const cursor = nextGuideStep(playlist, project, []);
  report.push(`  ${name.padEnd(17)} ${guideAsk(cursor)}`);
}

notes.push(
  `${GUIDE_BOOK_STATES.length} book states spoken for, ${junk.length} malformed documents read`,
);

export function checkGuideSession(): CheckResult {
  return { failures, notes, report, cases };
}
