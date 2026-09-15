/**
 * Invariants for generation the reader watches.
 *
 * The central claim of `core/guide/effects.ts` is that progress is counted from the
 * BOOK and only "is anyone working on it" comes from live job state. That claim is
 * worth pinning because breaking it is invisible in development and obvious in
 * production: a progress bar sourced from a job document reads correctly while the tab
 * stays open and resets to nothing the moment it reloads. So every effect is asked for
 * its state twice per book — once with live signals, once with none, which is exactly
 * what a reader sees after a refresh — and the counts have to match.
 *
 * The second thing checked here costs real money if it is wrong. `resumable` gates the
 * start button, and a button offered while a job is already running enqueues a
 * duplicate batch that the reader pays Sparks for. So it is asserted false whenever
 * work is in flight and false whenever there is nothing left to make, against
 * synthesized running states for all four effects.
 *
 * Offline and deterministic: the same book ladder the engine and widgets are proven
 * against, and pure functions only.
 */
import {
  GUIDE_CATALOG,
  type GuideComponentId,
  type GuideEffectId,
} from "../books-frontend/src/core/guide/components";
import {
  guideEffectFraction,
  guideEffectPending,
  guideEffectState,
  type GuideEffectSignals,
} from "../books-frontend/src/core/guide/effects";
import {
  createDefaultGuidePlaylist,
  resolveGuidePlaylist,
} from "../books-frontend/src/core/guide/playlist";
import { nextGuideStep } from "../books-frontend/src/core/guide/engine";
import { guideWidget } from "../books-frontend/src/core/guide/widgets";
import { guideAsk } from "../books-frontend/src/core/guide/voice";
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
const EFFECTS: GuideEffectId[] = ["storyDraft", "screenplay", "castArt", "pageArt"];

/** Signals that claim every outstanding unit is being worked on right now. */
function runningSignals(effect: GuideEffectId, pending: string[]): GuideEffectSignals {
  switch (effect) {
    case "storyDraft":
      return { drafting: true };
    case "screenplay":
      return { screenplay: { status: "running" } };
    default:
      return { activeUnitIds: new Set(pending) };
  }
}

// --- Shape, totality, and the reload claim ---------------------------------

const seen = new Map<GuideEffectId, Set<string>>();
for (const effect of EFFECTS) seen.set(effect, new Set());

for (const { name, project } of GUIDE_BOOK_STATES) {
  for (const effect of EFFECTS) {
    cases += 1;
    const pending = guideEffectPending(effect, project);
    const live = guideEffectState(effect, project, runningSignals(effect, pending));
    // No signals at all: precisely a reader who just reloaded the tab.
    const reloaded = guideEffectState(effect, project, {});

    seen.get(effect)!.add(live.status);

    if (!live.label.trim()) {
      fail(`${effect} on a "${name}" book has no label.`);
    }
    if (/undefined|NaN|\[object|\s{2}/.test(live.label)) {
      fail(`${effect} on a "${name}" book has a malformed label: "${live.label}".`);
    }
    if (live.done < 0 || live.total < 0 || live.done > live.total) {
      fail(`${effect} on a "${name}" book reports ${live.done}/${live.total}.`);
    }

    // The reload claim: counts come from the book, so signals cannot move them.
    if (live.done !== reloaded.done || live.total !== reloaded.total) {
      fail(
        `${effect} on a "${name}" book counts ${live.done}/${live.total} with live jobs but ` +
          `${reloaded.done}/${reloaded.total} after a reload. Progress must be derived from ` +
          `the book, not from a job.`,
      );
    }

    // Status has to agree with the counts, in both directions.
    if (live.status === "done" && live.done !== live.total) {
      fail(`${effect} on a "${name}" book claims done at ${live.done}/${live.total}.`);
    }
    if (live.total > 0 && live.done === live.total && live.status !== "done") {
      fail(
        `${effect} on a "${name}" book has everything (${live.done}/${live.total}) but reports ` +
          `"${live.status}".`,
      );
    }

    // The money check: never offer a button for work already in flight, and never
    // for work that doesn't exist.
    if (live.status === "running" && live.resumable) {
      fail(`${effect} on a "${name}" book offers a start button while it is running.`);
    }
    if (live.status === "done" && live.resumable) {
      fail(`${effect} on a "${name}" book offers a start button with nothing left to make.`);
    }

    // Pending ids and the counts are two views of one thing.
    if (live.total > 0 && live.total - live.done !== pending.length) {
      fail(
        `${effect} on a "${name}" book has ${live.total - live.done} outstanding by count but ` +
          `${pending.length} by id.`,
      );
    }

    // A bar that is only ever empty or full is a worse spinner than a spinner.
    const fraction = guideEffectFraction(live);
    if (live.total <= 1 && fraction !== null) {
      fail(`${effect} on a "${name}" book offers a progress bar for a single unit.`);
    }
    if (fraction !== null && (fraction < 0 || fraction > 1)) {
      fail(`${effect} on a "${name}" book reports a fraction of ${fraction}.`);
    }
  }
}

// --- A stalled effect offers a way on; a running one does not --------------

/**
 * Both halves matter and they fail differently. A stalled effect with no button is a
 * book that can never finish — the reader is told what is missing and given nothing to
 * do about it. A running effect WITH a button is a duplicate batch on their bill.
 */
for (const { name, project } of GUIDE_BOOK_STATES) {
  for (const effect of EFFECTS) {
    const pending = guideEffectPending(effect, project);
    if (pending.length === 0) continue;

    cases += 2;
    const stalled = guideEffectState(effect, project, {});
    const running = guideEffectState(effect, project, runningSignals(effect, pending));

    // `castArt`/`pageArt` legitimately have nothing to offer when the book has no
    // cast or no page plan yet — that is `total === 0`, filtered out above.
    if (stalled.status !== "idle" && stalled.status !== "failed") {
      fail(
        `${effect} on a "${name}" book has ${pending.length} outstanding and nobody working ` +
          `on it, but reports "${stalled.status}".`,
      );
    }
    if (!stalled.resumable) {
      fail(
        `${effect} on a "${name}" book has ${pending.length} outstanding, nothing running, and ` +
          `no way for the reader to start it.`,
      );
    }
    if (running.status !== "running") {
      fail(`${effect} on a "${name}" book is being worked on but reports "${running.status}".`);
    }
  }
}

// --- A failed attempt says so, and offers a retry ---------------------------

{
  const unplanned = GUIDE_BOOK_STATES.filter(({ project }) => !project.screenplay);
  for (const { name, project } of unplanned) {
    cases += 1;
    const state = guideEffectState("screenplay", project, {
      screenplay: { status: "error", error: "the provider timed out" },
    });
    if (state.status !== "failed") {
      fail(`A failed page plan on a "${name}" book reports "${state.status}".`);
    }
    if (!state.resumable) {
      fail(`A failed page plan on a "${name}" book offers no retry.`);
    }
    if (state.error !== "the provider timed out") {
      fail(`A failed page plan on a "${name}" book dropped the provider's message.`);
    }
  }
  if (unplanned.length === 0) notes.push("no book state lacks a screenplay — failure path unexercised");
}

// --- Generation takes precedence over asking --------------------------------

/**
 * If the guide has landed on a component that still has work to do, the affordance
 * must be the reveal. Anything else — a picker, a confirm button — asks the reader
 * about something the guide is in the middle of doing.
 */
const revealed = new Set<GuideComponentId>();
for (const { name, project } of GUIDE_BOOK_STATES) {
  const cursor = nextGuideStep(playlist, project, []);
  const component = cursor.component;
  if (!component?.effect) continue;

  cases += 1;
  const state = guideEffectState(component.effect, project, {});
  const widget = guideWidget(cursor, project, {});

  if (state.status === "done") {
    if (widget.kind === "reveal") {
      fail(`A "${name}" book shows a reveal for "${component.id}" with nothing left to generate.`);
    }
    continue;
  }

  revealed.add(component.id);
  if (widget.kind !== "reveal") {
    fail(
      `A "${name}" book is on "${component.id}" with generation outstanding but offers a ` +
        `"${widget.kind}" widget instead of the reveal.`,
    );
  } else if (widget.effect !== component.effect) {
    fail(
      `A "${name}" book shows the "${widget.effect}" reveal on "${component.id}", whose effect ` +
        `is "${component.effect}".`,
    );
  }
}

// --- The transcript carries no live numbers ---------------------------------

/**
 * A count written into the transcript is wrong five minutes later and stays wrong.
 *
 * The guide's lines are durable — they scroll into history and are reloaded from
 * storage — while the reveal beside the composer re-reads the book on every render. So
 * while generation is outstanding the spoken line has to explain the intent and leave
 * every number to the reveal. Checked as "no digits", which is blunt but exactly the
 * mistake worth catching: it fires the moment someone reaches for `blockers[0]` again,
 * since every one of those sentences counts something.
 */
for (const { name, project } of GUIDE_BOOK_STATES) {
  const cursor = nextGuideStep(playlist, project, []);
  const component = cursor.component;
  if (!component?.effect) continue;
  if (guideEffectState(component.effect, project, {}).status === "done") continue;

  cases += 1;
  const line = guideAsk(cursor, project);
  if (/\d/.test(line)) {
    fail(
      `While "${component.id}" generates on a "${name}" book, the guide says "${line}". A count ` +
        `in the transcript is a number that will be wrong later and stay wrong — leave it to ` +
        `the reveal.`,
    );
  }
  if (line.trim().length < 20) {
    fail(`The line for "${component.id}" mid-generation is too terse: "${line}".`);
  }
}

// --- Report -----------------------------------------------------------------

report.push("Generation the reader can watch");
for (const effect of EFFECTS) {
  const statuses = [...seen.get(effect)!].sort().join(", ");
  const owner = GUIDE_CATALOG.find((component) => component.effect === effect);
  report.push(`  ${effect.padEnd(11)} on ${(owner?.id ?? "—").padEnd(13)} states seen: ${statuses}`);
}

notes.push(
  `${EFFECTS.length} effects × ${GUIDE_BOOK_STATES.length} book states, each checked live and ` +
    `after a reload; ${revealed.size} components showed a reveal`,
);

export function checkGuideEffects(): CheckResult {
  return { failures, notes, report, cases };
}
