/**
 * Invariants for the Chat studio's settings and the checkers behind it.
 *
 * The guide's state model — catalog, playlist, engine, patch — is checked by
 * `guide-engine-invariants.ts`, and its interpreter's prompt and output contract by
 * `guide-interpreter-invariants.ts`. Each of the other `guide-*-invariants.ts`
 * files covers one part of the studio. All of them merge their results into this
 * report so one command covers the whole feature.
 *
 * What is asserted directly here is the settings document: the shipped default
 * satisfies its own schema, normalizing it is a no-op, and a missing, malformed
 * or out-of-range stored document still normalizes to something the studio can
 * run on.
 *
 * Offline and deterministic: no network, no emulator, no model call.
 */
import {
  createDefaultGuideConfig,
  guideConfigSchema,
  guideExtractionSchema,
  normalizeGuideConfig,
  normalizeGuideExtraction,
} from "../books-frontend/src/core/config/guide";
import { checkGuideEngine } from "./guide-engine-invariants";
import { checkGuideInterpreter } from "./guide-interpreter-invariants";
import { checkGuideSession } from "./guide-session-invariants";
import { checkGuideMemory } from "./guide-memory-invariants";
import { checkGuideAdmin } from "./guide-admin-invariants";
import { checkGuideFlow } from "./guide-flow-invariants";
import { checkGuideStudio } from "./guide-studio-invariants";
import { checkGuideJourney } from "./guide-journey-invariants";
import { checkGuideAgent } from "./guide-agent-invariants";
import { checkGuideMark } from "./guide-mark-invariants";
import { checkGuideStory } from "./guide-story-invariants";
import { checkGuidePeople } from "./guide-people-invariants";
import { checkGuideFailure } from "./guide-failure-invariants";
import { checkGuideMentions } from "./guide-mentions-invariants";
import { checkGuideConversation } from "./guide-conversation-invariants";
import { checkGuideCover } from "./guide-cover-invariants";
import { checkGuideOwnWords } from "./guide-own-words-invariants";
import { checkGuideLooks } from "./guide-looks-invariants";
import { checkGuideCast } from "./guide-cast-invariants";
import { checkGuideRedraw } from "./guide-redraw-invariants";
import { checkGuideCards } from "./guide-card-invariants";
import { checkGuideHistory } from "./guide-history-invariants";
import { checkEnUsCopy } from "./en-us-copy-lint";

const failures: string[] = [];
const notes: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

let cases = 0;

// --- Shipped default -------------------------------------------------------

const shipped = createDefaultGuideConfig();

if (!guideConfigSchema.safeParse(shipped).success) {
  fail("The shipped default config does not satisfy its own schema.");
}
// Normalizing the default must be a no-op, or a saved-then-reloaded document
// differs from the one the code ships.
const roundTripped = normalizeGuideConfig(structuredClone(shipped));
if (JSON.stringify(roundTripped) !== JSON.stringify(shipped)) {
  fail(`Round-tripping the default changed it: ${JSON.stringify(roundTripped)}.`);
}

// --- Normalization of a stored document -----------------------------------

const garbage: [label: string, input: unknown][] = [
  ["absent", undefined],
  ["null", null],
  ["empty", {}],
  ["a string", "on"],
  ["a number", 1],
  ["an array", []],
  ["no version", { rollout: { mode: "on" } }],
  ["a stale rollout field", { version: 1, rollout: { mode: "percentage", percent: 4000 } }],
];

for (const [label, input] of garbage) {
  const config = normalizeGuideConfig(input);
  if (!guideConfigSchema.safeParse(config).success) {
    fail(`Normalizing ${label} produced a document that fails the schema.`);
  }
}

// --- Extraction settings ---------------------------------------------------

/**
 * The knobs that used to be constants in the pipeline.
 *
 * They are clamped rather than rejected: a confidence floor that reads wrong
 * must still let the guide work, because the cost of refusing is a chat that
 * silently stops understanding anyone — with no error anywhere, since
 * "extracted nothing" is a legal outcome for every message.
 */
{
  const bad: [label: string, input: unknown][] = [
    ["absent", undefined],
    ["null", null],
    ["a string", "fast"],
    ["an array", []],
    ["empty thresholds", { thresholds: {} }],
    ["NaN floor", { thresholds: { floor: Number.NaN } }],
    ["Infinite floor", { thresholds: { floor: Number.POSITIVE_INFINITY } }],
    ["negative floor", { thresholds: { floor: -3 } }],
    ["floor of 1", { thresholds: { floor: 1 } }],
    ["floor above 1", { thresholds: { floor: 40 } }],
    ["string floor", { thresholds: { floor: "0.5" } }],
    ["huge repair budget", { repairAttempts: 99 }],
    ["fractional repair budget", { repairAttempts: 1.6 }],
    ["negative repair budget", { repairAttempts: -1 }],
    ["scorching temperature", { temperature: 12 }],
    ["tiny message cap", { maxMessageChars: 1 }],
    ["absurd message cap", { maxMessageChars: 10_000_000 }],
  ];

  for (const [label, input] of bad) {
    cases += 1;
    const extraction = normalizeGuideExtraction(input);
    if (!guideExtractionSchema.safeParse(extraction).success) {
      fail(`Normalizing extraction settings that are ${label} produced an invalid document.`);
    }
    // The claim that matters: whatever an admin stores, the guide still reads.
    // A floor of 1 would mean no claim ever clears it, and the chat would look
    // broken while every log line said it was working as configured.
    if (extraction.thresholds.floor >= 1) {
      fail(`Extraction settings that are ${label} left a floor no claim can clear.`);
    }
    if (extraction.maxMessageChars < 500) {
      fail(`Extraction settings that are ${label} left a cap shorter than a sentence.`);
    }
    if (extraction.repairAttempts > 3) {
      fail(`Extraction settings that are ${label} allowed ${extraction.repairAttempts} repairs.`);
    }
  }

  // Clamping, not discarding: 40 in a 0–1 field is an admin who meant "as high as
  // it goes", and silently restoring the default would hide that from them.
  cases += 1;
  if (normalizeGuideExtraction({ thresholds: { floor: 40 } }).thresholds.floor !== 0.9) {
    fail("An out-of-range floor was discarded instead of clamped to the top of its range.");
  }
  cases += 1;
  if (normalizeGuideExtraction({ repairAttempts: 99 }).repairAttempts !== 3) {
    fail("An out-of-range repair budget was discarded instead of clamped.");
  }
  // A value an admin really set has to survive, or the whole page is decoration.
  cases += 1;
  const tuned = normalizeGuideExtraction({
    thresholds: { floor: 0.5, readBack: 0.6, overwrite: 0.95 },
    repairAttempts: 2,
    temperature: 0.2,
    maxMessageChars: 8000,
  });
  if (
    tuned.thresholds.floor !== 0.5 ||
    tuned.repairAttempts !== 2 ||
    tuned.temperature !== 0.2 ||
    tuned.maxMessageChars !== 8000
  ) {
    fail(`Deliberately set extraction settings were not kept: ${JSON.stringify(tuned)}.`);
  }

  /**
   * The message cap has to fit the longest thing we ASK for.
   *
   * `storyText` accepts 40,000 characters, and one of the guide's own paths
   * invites a parent to paste the story they wrote. Shipping a cap below that
   * rejects the message at the door, on the one path where a long message is
   * exactly what we requested — which is what the 2,000-character constant did.
   */
  cases += 1;
  if (shipped.extraction.maxMessageChars < 40_000) {
    fail(
      `The shipped message cap is ${shipped.extraction.maxMessageChars} characters, below the ` +
        `40,000 the storyText slot accepts — a pasted story would be refused before it is read.`,
    );
  }
}

// --- The state model and the interpreter ----------------------------------

const engine = checkGuideEngine();
failures.push(...engine.failures);
notes.push(...engine.notes);
cases += engine.cases;

const interpreter = checkGuideInterpreter();
failures.push(...interpreter.failures);
notes.push(...interpreter.notes);
cases += interpreter.cases;

const session = checkGuideSession();
failures.push(...session.failures);
notes.push(...session.notes);
cases += session.cases;

const memory = checkGuideMemory();
failures.push(...memory.failures);
notes.push(...memory.notes);
cases += memory.cases;

const admin = checkGuideAdmin();
failures.push(...admin.failures);
notes.push(...admin.notes);
cases += admin.cases;

const flow = checkGuideFlow();
failures.push(...flow.failures);
notes.push(...flow.notes);
cases += flow.cases;

const studio = checkGuideStudio();
failures.push(...studio.failures);
notes.push(...studio.notes);
cases += studio.cases;

const journey = checkGuideJourney();
failures.push(...journey.failures);
notes.push(...journey.notes);
cases += journey.cases;

const agent = checkGuideAgent();
failures.push(...agent.failures);
notes.push(...agent.notes);
cases += agent.cases;

const mark = checkGuideMark();
failures.push(...mark.failures);
notes.push(...mark.notes);
cases += mark.cases;

const story = checkGuideStory();
failures.push(...story.failures);
notes.push(...story.notes);
cases += story.cases;

const people = checkGuidePeople();
failures.push(...people.failures);
notes.push(...people.notes);
cases += people.cases;

const mentionChecks = checkGuideMentions();
failures.push(...mentionChecks.failures);
notes.push(...mentionChecks.notes);
cases += mentionChecks.cases;

const failureChecks = checkGuideFailure();
failures.push(...failureChecks.failures);
notes.push(...failureChecks.notes);
cases += failureChecks.cases;

const conversation = checkGuideConversation();
failures.push(...conversation.failures);
notes.push(...conversation.notes);
cases += conversation.cases;

const looks = checkGuideLooks();
failures.push(...looks.failures);
notes.push(...looks.notes);
cases += looks.cases;

const castChecks = checkGuideCast();
failures.push(...castChecks.failures);
notes.push(...castChecks.notes);
cases += castChecks.cases;

const coverChecks = await checkGuideCover();
failures.push(...coverChecks.failures);
notes.push(...coverChecks.notes);
cases += coverChecks.cases;

const ownWordsChecks = checkGuideOwnWords();
failures.push(...ownWordsChecks.failures);
notes.push(...ownWordsChecks.notes);
cases += ownWordsChecks.cases;

const redrawChecks = checkGuideRedraw();
failures.push(...redrawChecks.failures);
notes.push(...redrawChecks.notes);
cases += redrawChecks.cases;
const cardChecks = checkGuideCards();
failures.push(...cardChecks.failures);
notes.push(...cardChecks.notes);
cases += cardChecks.cases;

const historyChecks = checkGuideHistory();
failures.push(...historyChecks.failures);
notes.push(...historyChecks.notes);
cases += historyChecks.cases;

const enUs = checkEnUsCopy();
failures.push(...enUs.failures);
notes.push(...enUs.notes);
cases += enUs.cases;

// --- Report ---------------------------------------------------------------

console.log();
for (const line of engine.report) console.log(line);

console.log();
for (const line of interpreter.report) console.log(line);

console.log();
for (const line of session.report) console.log(line);

console.log();
for (const line of memory.report) console.log(line);

console.log();
for (const line of admin.report) console.log(line);

console.log();
for (const line of flow.report) console.log(line);

console.log();
for (const line of studio.report) console.log(line);

console.log();
for (const line of journey.report) console.log(line);

console.log();
for (const line of agent.report) console.log(line);

console.log();
for (const line of story.report) console.log(line);

console.log();
for (const line of conversation.report) console.log(line);

console.log();
for (const line of looks.report) console.log(line);

console.log();
for (const line of castChecks.report) console.log(line);

console.log();
for (const line of redrawChecks.report) console.log(line);
for (const line of cardChecks.report) console.log(line);

if (notes.length > 0) {
  console.log("\nNotes");
  for (const note of notes) console.log(`  · ${note}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `\n${cases} cases — all invariants hold.`,
  );
}
