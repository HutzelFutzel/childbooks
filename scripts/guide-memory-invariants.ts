/**
 * Invariants for changing your mind: checkpoints, jump-back, and staleness.
 *
 * The dangerous one here is the round-trip. `captureGuideFacts` is the inverse of the
 * patch writers, and a restore applies whatever it captured — so a capture that is
 * subtly wrong does not fail, it silently rewrites the reader's book at the exact
 * moment they asked to *undo* something. Worse, it is the kind of bug that only appears
 * for the states nobody demos: an age in months rather than years, an age band inherited
 * from the hero rather than chosen, a style named but not confirmed.
 *
 * So the property checked is: capturing the facts and applying them back must change
 * nothing at all. Not "look equivalent" — `applyGuidePatch` reports which slots it
 * actually changed, and that list has to be empty for every synthesized book. Any
 * capture that reads a default as a decision, or writes a unit the writer normalizes
 * differently, shows up immediately.
 *
 * The second property is that a checkpoint is *reachable*: after moving a book forward
 * with a real patch, applying the captured checkpoint has to put the facts back. A
 * capture can be a faithful no-op and still be useless if it omits the very slot the
 * reader wants to undo.
 *
 * Offline and deterministic throughout.
 */
import {
  applyGuidePatch,
  captureGuideFacts,
  guidePatchContext,
  GUIDE_PATCHABLE_SLOT_IDS,
} from "../books-frontend/src/core/guide/patch";
import { GUIDE_SLOTS, type GuideSlotId } from "../books-frontend/src/core/guide/slots";
import {
  guideStaleSummary,
  guideStaleness,
} from "../books-frontend/src/core/guide/staleness";
import {
  appendGuideMessage,
  createGuideSession,
  guideMessage,
  guideRestorePoints,
  normalizeGuideSession,
  rewoundGuideSession,
} from "../books-frontend/src/core/guide/session";
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

const context = guidePatchContext({ audience: null, artStyles: null });

// --- Capture is a faithful inverse of the writer ----------------------------

const capturedEver = new Set<string>();

for (const { name, project } of GUIDE_BOOK_STATES) {
  cases += 1;
  const facts = captureGuideFacts(project);
  for (const key of Object.keys(facts)) capturedEver.add(key);

  // Nothing outside the closed world, ever.
  for (const key of Object.keys(facts)) {
    if (!GUIDE_PATCHABLE_SLOT_IDS.includes(key as GuideSlotId)) {
      fail(`A checkpoint of a "${name}" book captured "${key}", which is not a writable fact.`);
    }
    if (facts[key] === undefined) {
      fail(`A checkpoint of a "${name}" book captured "${key}" as undefined — omit it instead.`);
    }
  }

  // THE property: capture then apply changes nothing.
  const back = applyGuidePatch(project, facts, context);
  if (back.applied.length > 0) {
    fail(
      `Restoring a "${name}" book's own checkpoint CHANGED it: ${back.applied.join(", ")}. ` +
        `A capture that doesn't round-trip rewrites the book when the reader asks to undo.`,
    );
  }
  if (back.rejected.length > 0) {
    fail(
      `A "${name}" book's own checkpoint was REJECTED: ` +
        back.rejected.map((r) => `${r.key} (${r.reason})`).join(", "),
    );
  }
}

// --- A checkpoint can actually undo a change --------------------------------

/**
 * A no-op capture is necessary but not sufficient. Each writable slot is moved to a
 * genuinely different value, then the checkpoint is applied, and the slot has to come
 * back — otherwise "undo this" would leave the very fact the reader wanted reverted.
 *
 * Only slots the book has actually settled are exercised: a checkpoint deliberately
 * omits unset facts (see `captureGuideFacts`), so there is nothing to restore for them.
 */
const CHANGES: Partial<Record<GuideSlotId, unknown>> = {
  storyMode: "own",
  heroes: ["Somebody Else"],
  audience: { ageRangeId: "age-9-12" },
  language: "de-DE",
  storyIdea: { customTheme: "a completely different idea" },
  storyText: "A totally different story, written fresh.",
  layout: "text-below",
};

let restoresChecked = 0;

for (const { name, project } of GUIDE_BOOK_STATES) {
  const facts = captureGuideFacts(project);

  for (const [slot, value] of Object.entries(CHANGES) as [GuideSlotId, unknown][]) {
    if (!(slot in facts)) continue; // nothing settled to restore

    const forward = applyGuidePatch(project, { [slot]: value }, context);
    if (forward.applied.length === 0) continue; // the change was a no-op here

    cases += 1;
    restoresChecked += 1;
    const restored = applyGuidePatch(forward.project, facts, context);

    /**
     * Compared as captured facts, not as the slot's description.
     *
     * `describe` is a reader-facing summary and is not always a faithful window onto
     * the fact underneath — `namedHeroes` ignores the cast entirely for a co-write
     * brief, so a hero that is genuinely stored reads as absent. Comparing captures
     * asks the question that actually matters for an undo: is the book back to the
     * facts it held?
     */
    const restoredFacts = captureGuideFacts(restored.project);
    if (JSON.stringify(restoredFacts[slot]) !== JSON.stringify(facts[slot])) {
      fail(
        `On a "${name}" book, changing ${slot} to ${JSON.stringify(value)} and jumping back left ` +
          `${JSON.stringify(restoredFacts[slot])} instead of ${JSON.stringify(facts[slot])}.`,
      );
    }
    if (restored.rejected.length > 0) {
      fail(
        `Jumping back after changing ${slot} on a "${name}" book was rejected: ` +
          restored.rejected.map((r) => r.key).join(", "),
      );
    }
    // And when the description IS meaningful, the reader has to see the old value back.
    const describedBefore = GUIDE_SLOTS[slot].describe(project);
    if (describedBefore !== null) {
      const describedBack = GUIDE_SLOTS[slot].describe(restored.project);
      if (describedBack !== describedBefore) {
        fail(
          `On a "${name}" book, jumping back on ${slot} shows "${describedBack}" to the reader, ` +
            `not the original "${describedBefore}".`,
        );
      }
    }
  }
}

// --- Undoing an ADDITION, not just a replacement ----------------------------

/**
 * The case the book ladder cannot reach: no fixture has a story idea, so nothing above
 * ever walks the slot that merges field by field.
 *
 * It is also the one shape where a plausible capture is wrong. The other slots replace
 * their value wholesale, so a partial capture still overwrites; `storyIdea` merges, so a
 * checkpoint that only lists the fields that were set cannot remove a field the reader
 * added afterwards — the restore simply doesn't mention it, and it survives. Built here
 * by hand, forwards then backwards, one field at a time.
 */
{
  const base = GUIDE_BOOK_STATES.find(({ name }) => name === "hero named")!.project;
  const withTheme = applyGuidePatch(base, { storyIdea: { customTheme: "a lost balloon" } }, context);
  cases += 1;
  if (withTheme.applied.length === 0) {
    fail("Could not set a story idea to test undoing one — the fixture no longer applies.");
  }

  const checkpoint = captureGuideFacts(withTheme.project);
  const FIELDS = ["customSetting", "occasion", "when", "where", "mustInclude"] as const;

  for (const field of FIELDS) {
    cases += 1;
    const added = applyGuidePatch(withTheme.project, { storyIdea: { [field]: "added later" } }, context);
    if (added.applied.length === 0) {
      fail(`Adding "${field}" to a story idea changed nothing, so the undo is untested.`);
      continue;
    }

    const back = applyGuidePatch(added.project, checkpoint, context);
    const idea = captureGuideFacts(back.project).storyIdea as Record<string, unknown> | undefined;
    if (idea?.[field] != null) {
      fail(
        `Jumping back did not remove "${field}" from the story idea — it is still ` +
          `${JSON.stringify(idea[field])}. A checkpoint that omits a field cannot undo adding it.`,
      );
    }
    if (idea?.customTheme !== "a lost balloon") {
      fail(
        `Jumping back after adding "${field}" lost the original theme: ` +
          `${JSON.stringify(idea?.customTheme)}.`,
      );
    }
  }
}

// --- The transcript rewinds with the book ----------------------------------

{
  let session = createGuideSession();
  session = appendGuideMessage(session, guideMessage("guide", "Who is the book about?"));
  session = appendGuideMessage(session, guideMessage("reader", "Maya, she's five", {
    before: { heroes: ["Nobody"] },
  }));
  session = appendGuideMessage(session, guideMessage("guide", "Lovely. What should happen?"));
  session = appendGuideMessage(session, guideMessage("reader", "A trip to the sea", {
    before: { storyIdea: { customTheme: "something else" } },
  }));
  session = appendGuideMessage(session, guideMessage("guide", "Writing it now."));

  cases += 1;
  const points = guideRestorePoints(session);
  if (points.length !== 2) {
    fail(`A conversation with two fact-changing turns offered ${points.length} restore points.`);
  }
  // Newest first: "undo" means the most recent thing by default.
  if (points[0]?.text !== "A trip to the sea") {
    fail(`Restore points are not newest-first — got "${points[0]?.text}".`);
  }

  const target = session.messages.find((m) => m.text === "Maya, she's five")!;
  const rewound = rewoundGuideSession(session, target.id);
  cases += 1;
  if (rewound.messages.length !== 1) {
    fail(
      `Rewinding to the first fact-changing turn left ${rewound.messages.length} messages; ` +
        `everything from that turn on should be gone.`,
    );
  }
  if (rewound.messages.some((m) => m.text === "A trip to the sea")) {
    fail("Rewinding left a later turn in the transcript, describing a book that no longer exists.");
  }

  // A skip is not a fact, so it survives — re-asking a declined question would be its
  // own annoyance.
  const withSkip = { ...session, skipped: ["story-idea" as const] };
  cases += 1;
  if (rewoundGuideSession(withSkip, target.id).skipped.length !== 1) {
    fail("Rewinding dropped a component the reader had declined.");
  }

  // An unknown or non-checkpoint id must be inert, not destructive.
  for (const id of ["nope", session.messages[0]!.id]) {
    cases += 1;
    if (rewoundGuideSession(session, id) !== session) {
      fail(`Rewinding to "${id}" — not a restore point — changed the transcript.`);
    }
  }

  // Checkpoints have to survive a reload, or "undo this" disappears on refresh.
  cases += 1;
  const reloaded = normalizeGuideSession(JSON.parse(JSON.stringify(session)));
  if (guideRestorePoints(reloaded).length !== 2) {
    fail("Restore points did not survive a storage round-trip.");
  }
}

// --- Staleness is ordered, described, and fixable ---------------------------

/**
 * Order is the load-bearing part. Re-drawing pages before the cast sheet they reference
 * produces pages that are stale again on arrival, so the reader pays twice — which is
 * why the notice only ever offers to fix the first item.
 */
{
  const project = GUIDE_BOOK_STATES[GUIDE_BOOK_STATES.length - 1]!.project;
  const items = guideStaleness(project, { anchors: ["a1", "a2"], pages: ["s1"] });
  cases += 1;

  const order = items.map((item) => item.component);
  const cast = order.indexOf("cast-looks");
  const pages = order.indexOf("page-art");
  if (cast >= 0 && pages >= 0 && cast > pages) {
    fail("Staleness offered to redraw the pages before the cast sheets they reference.");
  }

  for (const item of items) {
    cases += 1;
    if (!/[.!?]$/.test(item.reason) || item.reason.trim().length < 20) {
      fail(`A staleness reason isn't a sentence: "${item.reason}".`);
    }
    if (item.count < 1) fail(`Staleness reported "${item.component}" with a count of ${item.count}.`);
  }

  // Counts have to be spoken correctly — this is the plural the wizard gets wrong.
  const one = guideStaleness(project, { anchors: ["a1"] });
  cases += 1;
  if (one[0] && /\b1 characters\b/.test(one[0].reason)) {
    fail(`A single stale sheet was described as plural: "${one[0].reason}".`);
  }

  // Nothing stale must be nothing at all, or the notice shows permanently.
  cases += 1;
  if (guideStaleness(project, {}).some((item) => item.component !== "story-draft")) {
    fail("Staleness invented outdated artwork with no detector verdict to support it.");
  }
  cases += 1;
  if (guideStaleSummary([]) !== "") {
    fail("An empty staleness list produced a summary, so the notice would never hide.");
  }
}

// Every book state, with no verdicts: only story staleness may ever appear, and it must
// be self-consistent.
for (const { name, project } of GUIDE_BOOK_STATES) {
  cases += 1;
  const items = guideStaleness(project, {});
  for (const item of items) {
    if (item.component !== "story-draft") {
      fail(`A "${name}" book reported "${item.component}" stale with no detector verdict.`);
    }
    if (item.effect !== "storyDraft") {
      fail(`Stale story on a "${name}" book offers "${item.effect}" as the fix.`);
    }
  }
}

// --- Report -----------------------------------------------------------------

report.push("What a checkpoint remembers");
for (const id of GUIDE_PATCHABLE_SLOT_IDS) {
  report.push(
    `  ${id.padEnd(11)} ${capturedEver.has(id) ? "captured" : "never settled in any test book"}`,
  );
}

notes.push(
  `${GUIDE_BOOK_STATES.length} checkpoints round-tripped, ${restoresChecked} undo paths walked`,
);

export function checkGuideMemory(): CheckResult {
  return { failures, notes, report, cases };
}
