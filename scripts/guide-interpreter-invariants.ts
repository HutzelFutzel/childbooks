/**
 * Invariants for the guide's interpreter: the prompt contract and the closed-world
 * filter on what comes back.
 *
 * The model call itself can't be checked offline, and that's fine — it isn't where
 * the risk is. The risk is in the two seams around it, and both are silent when
 * they break:
 *
 *   1. **The prompt seam.** The interpreter's prompt is assembled from variables
 *      the pipeline supplies and a template an admin can edit. An unknown variable
 *      renders as the empty string, so a rename on one side doesn't leave a visible
 *      `{{facts}}` to notice — it silently deletes the sentence that was meant to
 *      carry the book's facts, and the prompt still looks well-formed. The two
 *      sides are therefore compared directly, in both directions, plus against the
 *      variable list the admin preview renders from.
 *   2. **The output seam.** Whatever the model returns is filtered against the live
 *      catalog before anything acts on it. The properties worth stating: a skip can
 *      only name a component that exists AND is optional, and a turn that isn't
 *      claiming to state a fact carries no patch at all. Both are guesses the model
 *      is otherwise free to make, and the second is the one that invents a child's
 *      age out of a greeting.
 *
 *   3. **The wire seam.** The interpreter runs on the server against a payload the
 *      client slims down. Slimming away the page plan and the finished artwork
 *      costs nothing visible — no error, no missing field — it just leaves the
 *      guide confidently wrong about how far along the book is. So the guide's view
 *      is compared before and after slimming, over every state in the ladder.
 *
 * A fourth property is about honesty rather than safety: the shapes the model is
 * shown must be exactly the slots the validator will accept. They are generated
 * from the same table, so this is really a check that nobody has since added a way
 * to describe a slot without a writer, or a writer without a description.
 *
 * Offline and deterministic: synthesized books, the shipped prompt defaults, and
 * hand-written model replies standing in for the call.
 */
import {
  GUIDE_COMPONENTS,
  GUIDE_COMPONENT_IDS,
} from "../books-frontend/src/core/guide/components";
import { GUIDE_SLOT_IDS } from "../books-frontend/src/core/guide/slots";
import {
  createDefaultGuidePlaylist,
  resolveGuidePlaylist,
} from "../books-frontend/src/core/guide/playlist";
import {
  GUIDE_PATCHABLE_SLOT_IDS,
  guidePatchShapeLines,
  isGuidePatchableSlot,
  type GuidePatchContext,
} from "../books-frontend/src/core/guide/patch";
import {
  activeComponentId,
  buildGuideTurnVars,
  describeGuideFacts,
  sanitizeGuideTurn,
} from "../books-frontend/src/core/pipeline/guideInterpret";
import { slimProjectForRender } from "../books-frontend/src/core/book/slimProject";
import { GUIDE_BOOK_STATES } from "./guide-engine-invariants";
import {
  createDefaultPromptsConfig,
  defaultTemplate,
  PROMPT_ACTIONS,
} from "../books-frontend/src/core/prompts/registry";
import { renderTextPrompt } from "../books-frontend/src/core/prompts/render";
import { createDefaultConfig, type Project } from "../books-frontend/src/core/types";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { AGE_RANGES, ART_STYLE_PRESETS } from "../books-frontend/src/core/config/options";
import { BOOK_PRODUCTS } from "../books-frontend/src/core/fulfillment";
import { ALL_TEXT_ACTION_IDS } from "../books-frontend/src/core/ai/actions";
import { createDefaultModelConfig } from "../books-frontend/src/core/config/modelConfig";
import { createDefaultSparksConfig } from "../books-frontend/src/core/config/sparks";

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

const TEMPLATE_KEY = "guideInterpret/turn";

const patchContext: GuidePatchContext = {
  ageBandIds: AGE_RANGES.map((band) => band.id),
  artStylePresetIds: ART_STYLE_PRESETS.map((style) => style.id),
  productSkus: BOOK_PRODUCTS.map((product) => product.sku),
};

const playlist = resolveGuidePlaylist(createDefaultGuidePlaylist());

function project(overrides: Partial<Project["config"]> = {}): Project {
  return {
    id: "book-1",
    title: "Untitled",
    stage: "story",
    rev: 1,
    config: { ...createDefaultConfig(), storyBrief: createDefaultStoryBrief(), ...overrides },
  } as Project;
}

// A book at the start and a book part-way through, so the vars are exercised both
// with facts absent and with facts present — "not set" and a real value take
// different paths through `describe`.
const books: { name: string; project: Project }[] = [
  { name: "fresh", project: project() },
  {
    name: "partly known",
    project: project({
      storyBrief: {
        ...createDefaultStoryBrief(),
        mode: "guided",
        cast: [{ id: "c1", name: "Maya", age: 5 }],
        heroNames: ["Maya"],
      },
      ageRangeId: AGE_RANGES[1]?.id ?? AGE_RANGES[0]!.id,
    }),
  },
];

// --- The action is registered everywhere an action has to be -----------------

// A text action that isn't in the registry has no model binding, no price and no
// admin surface — and the failure is at runtime, on the first message.
cases += 1;
if (!ALL_TEXT_ACTION_IDS.includes("guideInterpret" as never)) {
  fail("guideInterpret is not a registered text action.");
}
cases += 1;
if (!createDefaultModelConfig().textBindings.guideInterpret) {
  fail("guideInterpret has no default model binding, so the guide can't run out of the box.");
}
// Free by default, because it runs on nearly every message and the reader is not
// buying an interpretation — they're talking. An admin can price it later; shipping
// it priced would meter conversation itself.
cases += 1;
{
  const pricing = createDefaultSparksConfig().actions.guideInterpret;
  if (!pricing) fail("guideInterpret has no default pricing rule.");
  else if (pricing.mode !== "free") {
    fail(`guideInterpret ships priced as "${pricing.mode}"; conversation should be free by default.`);
  }
}

// --- The prompt seam --------------------------------------------------------

const action = PROMPT_ACTIONS.find((entry) => entry.actionId === "guideInterpret");
cases += 1;
if (!action) {
  fail("guideInterpret has no PROMPT_ACTIONS entry, so its wording isn't editable.");
}
const meta = action?.templates.find((template) => template.key === TEMPLATE_KEY);
cases += 1;
if (!meta) fail(`No admin metadata for the "${TEMPLATE_KEY}" template.`);

const prompts = createDefaultPromptsConfig();

/**
 * The variables the shipped template actually references.
 *
 * Read from the template source rather than from the rendered output, because an
 * unknown variable renders as the empty string — so a rename doesn't leave a
 * visible `{{facts}}` to grep for, it silently deletes the section that was meant
 * to carry the book's facts and the prompt still looks fine. The only way to see
 * that is to compare the two sides directly.
 */
const referenced = new Set<string>();
{
  const template = defaultTemplate(TEMPLATE_KEY);
  const blocks = [...(template.system ?? []), ...(template.user ?? [])];
  cases += 1;
  if (blocks.length === 0) fail(`The "${TEMPLATE_KEY}" template has no blocks.`);
  for (const block of blocks) {
    // `{{> name}}` includes a partial, which is a different mechanism.
    for (const [, isPartial, name] of block.text.matchAll(/\{\{\s*(>?)\s*([\w.-]+)\s*\}\}/g)) {
      if (!isPartial) referenced.add(name!);
    }
  }
}

for (const book of books) {
  const vars = buildGuideTurnVars({
    project: book.project,
    message: "she's turning 6 next week",
    playlist,
    transcript: [
      { role: "guide", text: "Who is this book for?" },
      { role: "reader", text: "Maya" },
    ],
    patchContext,
  });

  // The seam, checked in both directions. A variable the template asks for but
  // nobody supplies renders as nothing; one supplied but never referenced is work
  // the pipeline does for no reader.
  for (const name of referenced) {
    cases += 1;
    if (!(name in vars)) {
      fail(`The prompt references "{{${name}}}" but the pipeline never supplies it.`);
    }
  }
  for (const name of Object.keys(vars)) {
    cases += 1;
    if (!referenced.has(name)) {
      fail(`The pipeline supplies "${name}" but the shipped prompt never uses it.`);
    }
  }

  // Every variable also has to be declared, or the admin's live preview renders a
  // different prompt than production does — and a preview that lies is worse than
  // no preview, because wording gets tuned against it.
  if (meta) {
    const declared = new Set(meta.variables.map((variable) => variable.name));
    for (const name of Object.keys(vars)) {
      cases += 1;
      if (!declared.has(name)) {
        fail(`"${name}" is supplied to the prompt but not declared, so the admin preview omits it.`);
      }
    }
    for (const variable of meta.variables) {
      cases += 1;
      if (!(variable.name in vars)) {
        fail(`"${variable.name}" is declared for the admin preview but never supplied.`);
      }
    }
  }

  // A variable that renders empty is a hole in the prompt even though every
  // placeholder was filled — "what the book already knows: " with nothing after it.
  for (const [name, value] of Object.entries(vars)) {
    cases += 1;
    if (!value.trim()) fail(`Variable "${name}" rendered empty for a ${book.name} book.`);
  }

  // And the assembled prompt has to be substantial in both segments: a template
  // whose blocks were all disabled renders to almost nothing and still "works".
  const { system, user } = renderTextPrompt(prompts, TEMPLATE_KEY, { vars });
  for (const [segment, text] of [["system", system], ["user", user]] as const) {
    cases += 1;
    if (text.trim().length < 200) {
      fail(`The ${segment} prompt is only ${text.trim().length} chars for a ${book.name} book.`);
    }
  }
}

// Facts are described for every slot, always — a slot missing from the rundown is
// one the interpreter can't see, so it re-asks a question already answered.
for (const book of books) {
  const facts = describeGuideFacts(book.project);
  for (const id of GUIDE_SLOT_IDS) {
    cases += 1;
    if (!facts.includes(`- ${id} (`)) {
      fail(`The facts rundown for a ${book.name} book omits the "${id}" slot.`);
    }
  }
}

// --- The wire seam ----------------------------------------------------------

/**
 * The interpreter runs on the server, against a payload the client slims. So the
 * question isn't whether the guide reads a book correctly — the engine checks that
 * — it's whether it reads the *same* book after slimming.
 *
 * This is the failure that would never show up as an error. A payload that drops
 * the page plan and the finished artwork produces a guide that is confidently
 * wrong about where the book is, and offers to draw characters that were drawn
 * days ago. Checked across the whole state ladder, since it only goes wrong once a
 * book has artifacts.
 */
for (const { name, project: full } of GUIDE_BOOK_STATES) {
  const wire = slimProjectForRender(full, {
    keepScreenplay: true,
    keepAnchorVersions: true,
    keepAnalysis: true,
    illustrationTargets: Object.keys(full.illustrations ?? {}).map((id) => ({ id })),
  });

  cases += 1;
  const before = describeGuideFacts(full);
  const after = describeGuideFacts(wire);
  if (before !== after) {
    const lost = before
      .split("\n")
      .filter((line, index) => line !== after.split("\n")[index])
      .map((line) => line.trim());
    fail(`Slimming a "${name}" book changed what the guide sees: ${lost.join("; ")}.`);
  }

  cases += 1;
  if (activeComponentId(playlist, full) !== activeComponentId(playlist, wire)) {
    fail(
      `Slimming a "${name}" book moved the guide from "${activeComponentId(playlist, full)}" ` +
        `to "${activeComponentId(playlist, wire)}".`,
    );
  }
}

// --- The shapes shown match the shapes accepted ------------------------------

{
  const lines = guidePatchShapeLines(patchContext);
  for (const id of GUIDE_PATCHABLE_SLOT_IDS) {
    cases += 1;
    if (!lines.includes(`- ${id}: `)) {
      fail(`Slot "${id}" is writable but isn't described to the interpreter.`);
    }
  }
  // The reverse: nothing that can't be written may appear, or the guide offers the
  // reader a choice the validator then refuses.
  for (const id of GUIDE_SLOT_IDS) {
    if (isGuidePatchableSlot(id)) continue;
    cases += 1;
    if (lines.includes(`- ${id}: `)) {
      fail(`Slot "${id}" is produced by generation but is offered to the interpreter as writable.`);
    }
  }
  // A shape that says nothing is worse than none: it reads as a field with no
  // constraints, which is an invitation to invent a value. Sliced by the known
  // prefix rather than split on a colon, because the shapes are themselves JSON.
  for (const id of GUIDE_PATCHABLE_SLOT_IDS) {
    cases += 1;
    const line = lines.split("\n").find((candidate) => candidate.startsWith(`- ${id}: `));
    const described = line?.slice(`- ${id}: `.length).trim() ?? "";
    if (described.length < 10) {
      fail(`Slot "${id}" has no usable shape description for the interpreter: "${described}".`);
    }
  }
  // The admin-configurable worlds have to actually reach the prompt, otherwise a
  // band added this morning is invisible to the conversation.
  cases += 1;
  if (!lines.includes(`"${AGE_RANGES[0]!.id}"`)) {
    fail("The age bands from the live config don't reach the interpreter's prompt.");
  }
  cases += 1;
  if (!lines.includes(`"${ART_STYLE_PRESETS[0]!.id}"`)) {
    fail("The art styles from the live config don't reach the interpreter's prompt.");
  }
}

// --- The output seam --------------------------------------------------------

const optional = GUIDE_COMPONENT_IDS.filter((id) => GUIDE_COMPONENTS[id].skippable);
const required = GUIDE_COMPONENT_IDS.filter((id) => !GUIDE_COMPONENTS[id].skippable);

// A skip may only name a real, optional component. Everything else is dropped
// silently — the engine then asks the question again, which is the right outcome.
{
  const junk = ["", "story-cast ", "STORY-IDEA", "__proto__", "constructor", "nope"];
  const result = sanitizeGuideTurn(
    { intent: "skip", skip: [...junk, ...required], reply: "Sure.", confidence: 0.9 },
    playlist,
  );
  cases += 1;
  if (result.skip.length > 0) {
    fail(`Skips survived that shouldn't have: ${result.skip.join(", ")}.`);
  }
}
for (const id of optional) {
  const result = sanitizeGuideTurn(
    { intent: "skip", skip: [id], reply: "No problem.", confidence: 0.9 },
    playlist,
  );
  cases += 1;
  if (!result.skip.includes(id)) fail(`A skip of the optional component "${id}" was dropped.`);
}
// Duplicates collapse: the skip set is a set, and a caller folding a list into one
// shouldn't have to know that.
{
  const twice = optional[0];
  if (twice) {
    const result = sanitizeGuideTurn(
      { intent: "skip", skip: [twice, twice], reply: "Ok.", confidence: 0.9 },
      playlist,
    );
    cases += 1;
    if (result.skip.length !== 1) fail("A repeated skip wasn't collapsed.");
  }
}

// Only a turn claiming to state a fact may carry one. A greeting or a question
// that arrives with a patch is a model filling in blanks it was never given.
{
  const patch = { heroes: ["Maya"], heroAges: [{ name: "Maya", age: 5 }] };
  for (const intent of ["question", "other", "skip"] as const) {
    const result = sanitizeGuideTurn(
      { intent, patch, reply: "Hello!", confidence: 0.9 },
      playlist,
    );
    cases += 1;
    if (Object.keys(result.patch).length > 0) {
      fail(`A "${intent}" turn carried a patch, so a guess reached the book.`);
    }
  }
  for (const intent of ["answer", "revise"] as const) {
    const result = sanitizeGuideTurn(
      { intent, patch, reply: "Got it.", confidence: 0.9 },
      playlist,
    );
    cases += 1;
    if (Object.keys(result.patch).length !== 2) {
      fail(`A "${intent}" turn lost the facts it stated.`);
    }
  }
}

// An absent patch is an empty one, never undefined — every caller passes this
// straight to `applyGuidePatch`.
{
  const result = sanitizeGuideTurn(
    { intent: "answer", reply: "Ok.", confidence: 0.5 },
    playlist,
  );
  cases += 1;
  if (typeof result.patch !== "object" || result.patch === null) {
    fail("A turn with no patch didn't produce an empty object.");
  }
  cases += 1;
  if (result.skip.length !== 0) fail("A turn with no skips didn't produce an empty list.");
}

// A playlist that switched a component off can't be skipped past — there is
// nothing there to decline, and honouring it would let a stale client suppress a
// component an admin has since made required.
{
  const trimmed = playlist.filter((component) => component.id !== optional[0]);
  const result = sanitizeGuideTurn(
    { intent: "skip", skip: [optional[0]!], reply: "Ok.", confidence: 0.9 },
    trimmed,
  );
  cases += 1;
  if (result.skip.length > 0) {
    fail("A skip named a component that isn't in this reader's playlist.");
  }
}

// --- Report -----------------------------------------------------------------

report.push("Interpreter prompt");
{
  const vars = buildGuideTurnVars({
    project: books[1]!.project,
    message: "she's turning 6 next week",
    playlist,
    transcript: [{ role: "guide", text: "Who is this book for?" }],
    patchContext,
  });
  const { system, user } = renderTextPrompt(prompts, TEMPLATE_KEY, { vars });
  report.push(`  system ${String(system.length).padStart(5)} chars`);
  report.push(`  user   ${String(user.length).padStart(5)} chars`);
  report.push(`  asking ${vars.asking}`);
}

report.push("\nWhat a message may write");
for (const line of guidePatchShapeLines(patchContext).split("\n")) {
  report.push(`  ${line.replace(/^- /, "")}`);
}

report.push("\nWhat a message may decline");
for (const id of GUIDE_COMPONENT_IDS) {
  const skippable = GUIDE_COMPONENTS[id].skippable;
  report.push(`  ${id.padEnd(14)} ${skippable ? "optional" : "required — never skippable"}`);
}

notes.push(
  `${GUIDE_PATCHABLE_SLOT_IDS.length} writable slots of ${GUIDE_SLOT_IDS.length}, ` +
    `${optional.length} of ${GUIDE_COMPONENT_IDS.length} components declinable`,
);

export function checkGuideInterpreter(): CheckResult {
  return { failures, notes, report, cases };
}
