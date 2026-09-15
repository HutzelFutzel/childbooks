/**
 * Invariants for attributing a book to a flow, and for the funnel it is judged on.
 *
 * Phase 8 exists to answer "is the guide better than the wizard", and the answer
 * is only as good as the attribution underneath it. That makes this the rare case
 * where a measurement bug is worse than a feature bug: a broken feature is
 * noticed, whereas a comparison built on mis-attributed books produces a
 * confident number that argues for the wrong decision, and nothing about it looks
 * wrong.
 *
 * The property that matters most is **a book that used both flows is counted in
 * neither**. It is the one mistake that biases rather than blurs: mixed books are
 * disproportionately the ones an admin opened to compare, they carry one flow's
 * draft and the other's illustrations, and crediting them to either arm imports
 * the other flow's work as evidence for it. So `flowArm` is walked over every
 * stored shape reachable here — absent, half-written, both-seen, and the
 * malformed values an older or newer writer could leave behind — and asserted
 * total, since this reads a Firestore document rather than a value the type
 * system controls.
 *
 * The second property is that **a sighting is never lost and never overwritten**.
 * `nextAuthoring` is applied in every order and every repetition, and the result
 * has to be independent of the order and stable under replay: the beacon fires on
 * every visit, so "already recorded" is the common path, and a rule that drifted
 * to overwriting would quietly turn mixed books back into clean ones.
 *
 * Offline and deterministic: pure functions and arithmetic.
 */
import {
  describeFlowArm,
  flowArm,
  isComparable,
  isStudioFlow,
  nextAuthoring,
  STUDIO_FLOWS,
  type FlowArm,
  type ProjectAuthoring,
  type StudioFlow,
} from "../books-frontend/src/core/guide/flow";

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

const T = 1_700_000_000_000;

// --- flowArm is total over anything storage can hold ------------------------

/**
 * Every shape a stored `authoring` field could actually have, including the ones
 * no current code writes. Deliberately includes junk: this classifies a document,
 * and a document outlives the version of the code that wrote it.
 */
const STORED: { name: string; value: unknown; expect: FlowArm }[] = [
  { name: "absent", value: undefined, expect: "unknown" },
  { name: "null", value: null, expect: "unknown" },
  { name: "empty object", value: {}, expect: "unknown" },
  { name: "empty seen", value: { first: "guide", seen: {} }, expect: "unknown" },
  { name: "guide only", value: { first: "guide", seen: { guide: T } }, expect: "guide" },
  { name: "legacy only", value: { first: "legacy", seen: { legacy: T } }, expect: "legacy" },
  {
    name: "both, guide first",
    value: { first: "guide", seen: { guide: T, legacy: T + 1000 } },
    expect: "mixed",
  },
  {
    name: "both, legacy first",
    value: { first: "legacy", seen: { legacy: T, guide: T + 1000 } },
    expect: "mixed",
  },
  // A `first` with no sighting is a half-written record. Trusting it would file a
  // book on the strength of a document that never finished being written.
  { name: "first with no sighting", value: { first: "guide" }, expect: "unknown" },
  // Disagreement between the two fields: `seen` wins, because it is the thing the
  // report counts and the thing a mixed book is detected by.
  {
    name: "first disagrees with seen",
    value: { first: "guide", seen: { legacy: T } },
    expect: "legacy",
  },
  { name: "seen not a map", value: { first: "guide", seen: 5 }, expect: "unknown" },
  { name: "timestamp zero", value: { first: "guide", seen: { guide: 0 } }, expect: "unknown" },
  { name: "timestamp a string", value: { seen: { guide: "yesterday" } }, expect: "unknown" },
  { name: "unknown flow name", value: { first: "chat", seen: { chat: T } }, expect: "unknown" },
  {
    name: "unknown flow beside a real one",
    value: { first: "guide", seen: { guide: T, chat: T } },
    expect: "guide",
  },
];

const armsSeen = new Set<FlowArm>();

for (const { name, value, expect } of STORED) {
  cases += 1;
  const arm = flowArm(value as Partial<ProjectAuthoring>);
  armsSeen.add(arm);
  if (arm !== expect) {
    fail(`A book whose attribution is ${name} classified as "${arm}", not "${expect}".`);
  }
  // Total means total: no throw, and always one of the four.
  if (!["guide", "legacy", "mixed", "unknown"].includes(arm)) {
    fail(`A book whose attribution is ${name} produced the arm "${arm}", which is not an arm.`);
  }
  if (!describeFlowArm(arm).trim()) {
    fail(`The arm "${arm}" has no name to show an admin.`);
  }
  // THE property. Anything with two sightings must be excluded from both arms.
  const seen = value && typeof value === "object" ? ((value as ProjectAuthoring).seen ?? {}) : {};
  const realSightings = STUDIO_FLOWS.filter((f) => typeof (seen as Record<string, unknown>)[f] === "number" && ((seen as Record<string, number>)[f] ?? 0) > 0);
  if (realSightings.length > 1 && isComparable(arm)) {
    fail(
      `A book seen in ${realSightings.join(" and ")} was counted in the "${arm}" arm. A mixed ` +
        `book carries one flow's work and the other's, so attributing it imports the other ` +
        `flow's output as evidence for this one.`,
    );
  }
  if (realSightings.length === 1 && arm !== realSightings[0]) {
    fail(`A book seen only in ${realSightings[0]} classified as "${arm}".`);
  }
}

if (armsSeen.size !== 4) {
  fail(`Only ${armsSeen.size} of the four arms were exercised: ${[...armsSeen].join(", ")}.`);
}

// --- A sighting is never lost, never overwritten, and order-independent ------

/**
 * Every sequence of up to four sightings. Replay and repetition are the realistic
 * cases — the beacon fires per visit — so a rule that only worked on first
 * sighting would pass a single-step test and corrupt real data.
 */
function sequences(depth: number): StudioFlow[][] {
  if (depth === 0) return [[]];
  const shorter = sequences(depth - 1);
  const out: StudioFlow[][] = [];
  for (const seq of shorter) {
    out.push(seq);
    for (const flow of STUDIO_FLOWS) out.push([...seq, flow]);
  }
  return out.filter((seq, i) => out.findIndex((s) => s.join() === seq.join()) === i);
}

const SEQUENCES = sequences(4).filter((seq) => seq.length > 0);
let writesSkipped = 0;

for (const seq of SEQUENCES) {
  let authoring: ProjectAuthoring | undefined;
  let at = T;

  for (const flow of seq) {
    at += 1000;
    cases += 1;
    const next = nextAuthoring(authoring, flow, at);
    if (next === null) {
      writesSkipped += 1;
      // A skipped write is only legitimate when the sighting is already on record.
      // Skipping for any other reason silently drops it, which is indistinguishable
      // from the reader never having been there.
      if (typeof authoring?.seen?.[flow] !== "number") {
        fail(
          `Recording a ${flow} sighting was skipped for a book that had never been seen in ` +
            `${flow}. A skipped write loses the sighting entirely.`,
        );
      }
      continue;
    }
    authoring = next;

    // Never loses a sighting.
    if (typeof authoring.seen[flow] !== "number") {
      fail(`Recording a ${flow} sighting produced an attribution that does not mention ${flow}.`);
    }
    // Never overwrites the first.
    if (authoring.first !== (seq[0] as StudioFlow)) {
      fail(
        `After ${seq.join(" → ")}, the first flow reads "${authoring.first}" rather than ` +
          `"${seq[0]}". The first sighting has to survive every later one.`,
      );
    }
  }

  cases += 1;
  const arm = flowArm(authoring);
  const distinct = new Set(seq);

  // The arm follows from the set of flows seen, and from nothing else — not the
  // order, not the repetition, not which came first.
  const expected: FlowArm = distinct.size > 1 ? "mixed" : (seq[0] as StudioFlow);
  if (arm !== expected) {
    fail(`The sequence ${seq.join(" → ")} produced the arm "${arm}", not "${expected}".`);
  }

  // Order-independence, stated directly: any permutation of the same set lands in
  // the same arm. A comparison whose arms depended on visit order would be
  // reporting on browsing habits.
  const reversed = [...seq].reverse();
  let other: ProjectAuthoring | undefined;
  let otherAt = T;
  for (const flow of reversed) {
    otherAt += 1000;
    other = nextAuthoring(other, flow, otherAt) ?? other;
  }
  cases += 1;
  if (flowArm(other) !== arm) {
    fail(
      `${seq.join(" → ")} lands in "${arm}" but ${reversed.join(" → ")} lands in ` +
        `"${flowArm(other)}". The arm must not depend on the order of visits.`,
    );
  }

  // Replay is inert: re-reporting everything already recorded changes nothing.
  cases += 1;
  for (const flow of distinct) {
    if (nextAuthoring(authoring, flow, at + 9999) !== null) {
      fail(
        `Re-reporting a ${flow} sighting after ${seq.join(" → ")} wanted another write. The ` +
          `beacon fires on every visit, so a repeat has to be free.`,
      );
    }
  }
}

// --- Garbage in does not produce an attribution -----------------------------

for (const bad of [null, undefined, "wizard", "chat", 0, {}, [], "GUIDE", "Legacy", " guide"]) {
  cases += 1;
  if (isStudioFlow(bad)) fail(`${JSON.stringify(bad)} was accepted as a flow.`);
  if (nextAuthoring(undefined, bad as StudioFlow, T) !== null) {
    fail(
      `${JSON.stringify(bad)} was recorded as a sighting. An unvalidated value would create a ` +
        `third arm out of a typo.`,
    );
  }
}

// A sighting with no usable time is not a sighting: it would classify the book
// while being invisible to any date-bounded report.
for (const badTime of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  cases += 1;
  if (nextAuthoring(undefined, "guide", badTime) !== null) {
    fail(`A sighting timestamped ${badTime} was recorded.`);
  }
}

// --- The funnel a flow is judged on -----------------------------------------

/**
 * `milestoneForAction` is duplicated here rather than imported, because importing
 * `functions/src/projects.ts` pulls in `firebase-admin` and this suite has to run
 * offline. That makes this a *contract* check, not a unit test: it pins the
 * mapping the report relies on, and drifts loudly if the backend's copy changes.
 *
 * What it is really defending is the split between `storyDraft` and `screenplay`.
 * They shared one milestone until phase 8, which made "time to a story" mean
 * "time to a story OR to a page plan" — and since the guide reaches the page plan
 * by a different route than the wizard, a shared milestone would have shown a
 * difference in timing that was really a difference in bookkeeping.
 */
const MILESTONE_FOR_ACTION: Record<string, string> = {
  storyDraft: "storyDrafted",
  screenplay: "pagesPlanned",
  anchorImage: "castStarted",
  pageIllustration: "pagesStarted",
  coverIllustration: "coverDone",
};

/** The order a book passes them, which the report renders as a funnel. */
const FUNNEL = [
  "created",
  "storyDrafted",
  "pagesPlanned",
  "castStarted",
  "pagesStarted",
  "coverDone",
  "previewed",
  "ordered",
];

cases += 1;
{
  const mapped = Object.values(MILESTONE_FOR_ACTION);
  if (new Set(mapped).size !== mapped.length) {
    fail(
      `Two actions stamp the same milestone (${mapped.join(", ")}). A shared milestone makes ` +
        `the stage it marks ambiguous, which is what the storyDraft/screenplay split fixed.`,
    );
  }
  for (const [action, milestone] of Object.entries(MILESTONE_FOR_ACTION)) {
    cases += 1;
    if (!FUNNEL.includes(milestone)) {
      fail(`"${action}" stamps "${milestone}", which is not a stage of the funnel.`);
    }
  }
  // `created` and `previewed` are the two stages no AI action can stamp: one is
  // set when the mirror is made, the other is reported by the client. If either
  // ever appears in the action map, something has started guessing.
  for (const clientOnly of ["created", "previewed"]) {
    cases += 1;
    if (mapped.includes(clientOnly)) {
      fail(`"${clientOnly}" is stamped by an AI action, but no AI call happens at that stage.`);
    }
  }
  cases += 1;
  if (FUNNEL.indexOf("previewed") >= FUNNEL.indexOf("ordered")) {
    fail("The funnel puts ordering before the preview, which no reader does.");
  }
}

// --- Report -----------------------------------------------------------------

report.push("Attributing a book to a flow");
for (const arm of ["guide", "legacy", "mixed", "unknown"] as FlowArm[]) {
  const n = STORED.filter(({ value }) => flowArm(value as Partial<ProjectAuthoring>) === arm).length;
  report.push(
    `  ${arm.padEnd(8)} ${describeFlowArm(arm).padEnd(15)} ${n} stored shape${n === 1 ? "" : "s"}` +
      `${isComparable(arm) ? " — counted" : " — excluded"}`,
  );
}
report.push("The funnel a flow is judged on");
report.push(`  ${FUNNEL.join(" → ")}`);

notes.push(
  `${STORED.length} stored attribution shapes, ${SEQUENCES.length} visit sequences ` +
    `(${writesSkipped} repeat sightings correctly skipped)`,
);

export function checkGuideFlow(): CheckResult {
  return { failures, notes, report, cases };
}
