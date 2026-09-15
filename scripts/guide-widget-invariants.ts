/**
 * Invariants for the input affordances and the artifact pane.
 *
 * Two claims are checked here, and both are the kind that fail silently.
 *
 * **1. An option the reader can see is an option the validator accepts.** A tapped
 * choice carries its own patch and skips the interpreter entirely, which is the
 * reason widgets are worth building — and also the reason a wrong option is nastier
 * than a wrong sentence. There is no model to blame and no rejection to report: the
 * reader taps "4–5 years", the write is refused, and the guide asks the same question
 * again. So every option of every widget is actually applied to a real book here, and
 * has to land.
 *
 * **2. Driving the pane from `component.canvas` is not a behaviour change.** The pane
 * used to follow `legacyDestination` (the wizard's vocabulary) and now follows
 * `canvas` (the guide's own). Since `legacyDestination` is deleted with the wizard,
 * the swap had to happen at some point; doing it while both exist means the two can be
 * pinned against each other, so it is provable rather than hoped for. One divergence
 * is intended and listed.
 *
 * Offline and deterministic: the same synthesized books the engine is proven against,
 * the shipped admin config, and pure functions.
 */
import {
  GUIDE_CATALOG,
  GUIDE_COMPONENTS,
  type GuideCanvasKind,
  type GuideComponentId,
} from "../books-frontend/src/core/guide/components";
import {
  createDefaultGuidePlaylist,
  resolveGuidePlaylist,
} from "../books-frontend/src/core/guide/playlist";
import { nextGuideStep } from "../books-frontend/src/core/guide/engine";
import { guideWidget, type GuideWidget } from "../books-frontend/src/core/guide/widgets";
import { applyGuidePatch, guidePatchContext } from "../books-frontend/src/core/guide/patch";
import { CANVAS_DESTINATION } from "../books-frontend/src/ui/guide/guideCanvas";
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
// The shipped admin config, which is what a reader gets before an admin touches
// anything — so the offered options are the real ones, not a fixture's.
const context = guidePatchContext({ audience: null, artStyles: null });

/**
 * The one place the pane and the wizard are allowed to disagree.
 *
 * The wizard has no surface for the wait while the screenplay drafts, so it holds on
 * Cast. The guide would rather show the reader the pages being planned, which is the
 * whole reason it has a vocabulary of its own.
 */
const EXPECTED_CANVAS_DIVERGENCE: Partial<Record<GuideComponentId, string>> = {
  "page-plan": "the wizard waits on Cast; the guide shows the pages being planned",
};

// --- The pane follows the guide's vocabulary, faithfully --------------------

for (const component of GUIDE_CATALOG) {
  cases += 1;
  const mapped = CANVAS_DESTINATION[component.canvas];
  if (!mapped) {
    fail(`Canvas "${component.canvas}" (on "${component.id}") maps to no destination.`);
    continue;
  }
  const expected = EXPECTED_CANVAS_DIVERGENCE[component.id];
  if (mapped !== component.legacyDestination && !expected) {
    fail(
      `"${component.id}" would open "${mapped}" from its canvas but the wizard opens ` +
        `"${component.legacyDestination}". Either the canvas is wrong or the divergence is ` +
        `intended and belongs in EXPECTED_CANVAS_DIVERGENCE.`,
    );
  }
  if (mapped === component.legacyDestination && expected) {
    fail(`"${component.id}" is listed as diverging but now agrees with the wizard — drop the entry.`);
  }
}

// Every canvas kind is reachable, or it is a value nothing can ever show.
{
  const used = new Set(GUIDE_CATALOG.map((component) => component.canvas));
  for (const canvas of Object.keys(CANVAS_DESTINATION) as GuideCanvasKind[]) {
    cases += 1;
    if (!used.has(canvas)) {
      fail(`Canvas "${canvas}" is mapped but no component uses it.`);
    }
  }
}

// --- Every offered option actually lands ------------------------------------

/**
 * Applied for real, against every book state, because an option is only correct in
 * the context it is offered in. A patch that works on a fresh book and is refused on
 * a half-finished one is exactly the bug this catches.
 */
const widgetsSeen = new Map<GuideComponentId, GuideWidget["kind"]>();
let optionsChecked = 0;

for (const { name, project } of GUIDE_BOOK_STATES) {
  const cursor = nextGuideStep(playlist, project, []);
  const widget = guideWidget(cursor, project, {});
  cases += 1;

  if (cursor.component) widgetsSeen.set(cursor.component.id, widget.kind);

  // A placeholder is the only hint about what a good answer looks like. An empty one
  // is a wasted affordance, and a leaked value is worse.
  if (widget.placeholder.trim().length < 8) {
    fail(`The composer on a "${name}" book has a near-empty placeholder: "${widget.placeholder}".`);
  }
  if (/undefined|null|\[object/.test(widget.placeholder)) {
    fail(`The composer on a "${name}" book leaked a value: "${widget.placeholder}".`);
  }

  if (widget.kind === "wait" && widget.message.trim().length < 12) {
    fail(`The waiting note on a "${name}" book says almost nothing: "${widget.message}".`);
  }

  if (widget.kind === "confirm") {
    cases += 1;
    if (widget.affirm.trim().length < 5) {
      fail(`The confirm button on a "${name}" book is unlabelled.`);
    }
  }

  if (widget.kind !== "choice") continue;

  cases += 1;
  if (widget.options.length === 0) {
    fail(`A "${name}" book offered a choice with no options.`);
  }
  // The slot the widget claims to write has to belong to the component asking.
  if (cursor.component && !cursor.component.slots.includes(widget.slot)) {
    fail(
      `The choice on "${cursor.component.id}" writes "${widget.slot}", which that ` +
        `component doesn't own (it owns ${cursor.component.slots.join(", ") || "nothing"}).`,
    );
  }

  const ids = new Set<string>();
  for (const option of widget.options) {
    optionsChecked += 1;
    cases += 1;

    if (ids.has(option.id)) fail(`"${cursor.component?.id}" offered "${option.id}" twice.`);
    ids.add(option.id);
    if (!option.label.trim()) fail(`An option of "${cursor.component?.id}" has no label.`);
    if (!option.said.trim()) {
      fail(`Option "${option.id}" records nothing in the transcript when tapped.`);
    }

    // The claim: tapping this writes the book. Applied for real.
    const outcome = applyGuidePatch(project, option.patch, context);
    if (outcome.rejected.length > 0) {
      fail(
        `Tapping "${option.label}" on a "${name}" book was REFUSED: ` +
          outcome.rejected.map((r) => `${r.key} (${r.reason})`).join(", "),
      );
      continue;
    }
    if (!outcome.applied.includes(widget.slot)) {
      fail(
        `Tapping "${option.label}" on a "${name}" book changed nothing — it wrote ` +
          `[${outcome.applied.join(", ") || "nothing"}], not "${widget.slot}". The guide would ` +
          `ask the same question again.`,
      );
    }
    // And it has to actually settle the question, or the tap is a dead end.
    const after = nextGuideStep(playlist, outcome.project, []);
    if (after.component?.id === cursor.component?.id && widget.slot !== "artStyle") {
      fail(
        `Tapping "${option.label}" on a "${name}" book left the guide on ` +
          `"${cursor.component?.id}". A choice that doesn't move on is a loop.`,
      );
    }
  }
}

/**
 * Widgets no book state reaches, exercised directly.
 *
 * `audience` is the one that matters: it is satisfied as soon as a named child has an
 * age, so a book that has got far enough to be asked anything has usually answered it
 * by implication — and the age-band picker, the widget with the most options and the
 * only admin-configurable list among them, would never be applied at all. Reached by
 * building the cursor for it rather than by contriving a book, for the same reason the
 * unreachable cursor states are handled that way in the session checks.
 */
{
  const unreached = playlist.filter((component) => !widgetsSeen.has(component.id));
  for (const component of unreached) {
    const cursor = {
      component,
      status: "ask" as const,
      blockers: component.blockers(GUIDE_BOOK_STATES[0]!.project),
    };
    const widget = guideWidget(cursor, GUIDE_BOOK_STATES[0]!.project, {});
    cases += 1;
    if (widget.placeholder.trim().length < 8) {
      fail(`The composer for the unreached "${component.id}" has a near-empty placeholder.`);
    }
    if (widget.kind !== "choice") continue;

    for (const option of widget.options) {
      optionsChecked += 1;
      cases += 1;
      // Applied to a book that has passed this component's requirements, so the
      // patch is judged in a state where it is legitimately offerable.
      const host =
        GUIDE_BOOK_STATES.find(({ project }) =>
          component.requires.every((required) => GUIDE_COMPONENTS[required].isSatisfied(project)),
        ) ?? GUIDE_BOOK_STATES[GUIDE_BOOK_STATES.length - 1]!;
      const outcome = applyGuidePatch(host.project, option.patch, context);
      if (outcome.rejected.length > 0) {
        fail(
          `Tapping "${option.label}" for "${component.id}" was REFUSED: ` +
            outcome.rejected.map((r) => `${r.key} (${r.reason})`).join(", "),
        );
      } else if (!outcome.applied.includes(widget.slot)) {
        fail(
          `Tapping "${option.label}" for "${component.id}" wrote ` +
            `[${outcome.applied.join(", ") || "nothing"}], not "${widget.slot}".`,
        );
      }
    }
  }
  if (unreached.length > 0) {
    notes.push(
      `widgets exercised directly (no book state reaches them): ` +
        unreached.map((c) => c.id).join(", "),
    );
  }
}

// --- A confirmation is offered exactly when it is being asked for ----------

/**
 * The cast confirmation is the fiddly one: it appears only once every sheet is drawn
 * and the reader's explicit `castReady` is what's missing. Checked against the
 * blocker text, because those two have to be the same moment — a button that shows up
 * while pictures are still rendering promises something it can't deliver.
 */
for (const { name, project } of GUIDE_BOOK_STATES) {
  const cursor = nextGuideStep(playlist, project, []);
  if (cursor.component?.id !== "cast-looks") continue;
  const widget = guideWidget(cursor, project, {});
  const askingToConfirm = cursor.blockers[0] === "Confirm the cast looks right.";
  cases += 1;
  if (askingToConfirm && widget.kind !== "confirm") {
    fail(`A "${name}" book asks the reader to confirm the cast but offers no button.`);
  }
  if (!askingToConfirm && widget.kind === "confirm") {
    fail(
      `A "${name}" book offers a cast-confirm button while it is still saying ` +
        `"${cursor.blockers[0]}".`,
    );
  }
}

// Story approval is unconditional: reaching that component IS the ask.
{
  const approving = GUIDE_BOOK_STATES.filter(
    ({ project }) => nextGuideStep(playlist, project, []).component?.id === "story-approve",
  );
  cases += 1;
  if (approving.length === 0) {
    notes.push("no book state reaches story-approve — its confirm button is unexercised");
  }
  for (const { name, project } of approving) {
    const widget = guideWidget(nextGuideStep(playlist, project, []), project, {});
    cases += 1;
    if (widget.kind !== "confirm" || widget.action !== "approveStory") {
      fail(`A "${name}" book is waiting for the reader's go-ahead but offers no approve button.`);
    }
  }
}

// --- Report -----------------------------------------------------------------

report.push("How the reader answers each question");
for (const component of GUIDE_CATALOG) {
  const kind = widgetsSeen.get(component.id);
  report.push(
    `  ${component.id.padEnd(15)} ${(kind ?? "—").padEnd(8)} canvas ${component.canvas.padEnd(11)}` +
      ` → ${CANVAS_DESTINATION[component.canvas]}` +
      (EXPECTED_CANVAS_DIVERGENCE[component.id] ? "  (diverges, by design)" : ""),
  );
}

notes.push(
  `${optionsChecked} tappable options applied for real, ${widgetsSeen.size} of ` +
    `${GUIDE_CATALOG.length} components reached by a book state`,
);

export function checkGuideWidgets(): CheckResult {
  return { failures, notes, report, cases };
}

void GUIDE_COMPONENTS;
