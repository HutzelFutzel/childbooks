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
 *      is otherwise free to make. A one-word quotation on a question is not a
 *      fact. A longer quotation beside the question is, because people volunteer
 *      facts while asking something else.
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
  guidePatchExampleLines,
  guidePatchShapeLines,
  isGuidePatchableSlot,
  type GuidePatchContext,
} from "../books-frontend/src/core/guide/patch";
import {
  activeComponentId,
  buildGuideTurnVars,
  describeClaimProblems,
  describeGuideFacts,
  sanitizeGuideTurn,
  type SanitizeGuideTurnOptions,
} from "../books-frontend/src/core/pipeline/guideInterpret";
import { claimEvidenceHolds } from "../books-frontend/src/core/guide/claims";
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

/**
 * The repair template, checked the same way but with a different shape of claim.
 *
 * It uses a SUBSET of the turn's variables plus two of its own, so the turn's
 * "everything supplied is used" rule does not apply — the useful version here is
 * that nothing it references is missing, and nothing it declares goes unsupplied.
 * A repair prompt with an empty `{{problems}}` would ask the model to correct
 * mistakes it cannot see, and would look completely normal doing it.
 */
{
  const REPAIR_KEY = "guideInterpret/repair";
  const repairMeta = action?.templates.find((template) => template.key === REPAIR_KEY);
  cases += 1;
  if (!repairMeta) fail(`No admin metadata for the "${REPAIR_KEY}" template.`);

  const turnVars = buildGuideTurnVars({
    project: books[1]!.project,
    message: "and Sam is 9",
    playlist,
    transcript: [{ role: "guide", text: "Who is this book for?" }],
    patchContext,
  });
  // The two the repair adds, as the pipeline builds them.
  const repairVars = {
    ...turnVars,
    problems: '- heroAges = [{"name":"Sam","age":9}] was refused: no cast member named Sam',
    kept: '{"heroes":["Maya"]}',
  };

  const repairReferenced = new Set<string>();
  const template = defaultTemplate(REPAIR_KEY);
  const blocks = [...(template.system ?? []), ...(template.user ?? [])];
  cases += 1;
  if (blocks.length === 0) fail(`The "${REPAIR_KEY}" template has no blocks.`);
  for (const block of blocks) {
    for (const [, isPartial, name] of block.text.matchAll(/\{\{\s*(>?)\s*([\w.-]+)\s*\}\}/g)) {
      if (!isPartial) repairReferenced.add(name!);
    }
  }

  for (const name of repairReferenced) {
    cases += 1;
    if (!(name in repairVars)) {
      fail(`The repair prompt references "{{${name}}}" but the pipeline never supplies it.`);
    }
  }
  if (repairMeta) {
    const declared = new Set(repairMeta.variables.map((variable) => variable.name));
    for (const name of repairReferenced) {
      cases += 1;
      if (!declared.has(name)) {
        fail(`The repair prompt uses "${name}" but doesn't declare it for the admin preview.`);
      }
    }
    for (const variable of repairMeta.variables) {
      cases += 1;
      if (!(variable.name in repairVars)) {
        fail(`"${variable.name}" is declared for the repair preview but never supplied.`);
      }
    }
  }

  // The objections have to actually reach it, or the second pass is just a
  // re-roll of the first with extra latency.
  const { system, user } = renderTextPrompt(prompts, REPAIR_KEY, { vars: repairVars });
  cases += 1;
  if (!user.includes("no cast member named Sam")) {
    fail("The validator's objection doesn't reach the repair prompt.");
  }
  cases += 1;
  if (system.trim().length < 200) {
    fail(`The repair system prompt is only ${system.trim().length} chars.`);
  }
}

/**
 * The worked examples reach the prompt, and they are the validator's own.
 *
 * They are generated from the writers so they cannot describe a shape the
 * validator refuses (`guide-engine-invariants.ts` parses each one against its
 * slot's schema). What is checked here is the other half: that they actually
 * arrive, because an examples block that renders empty leaves a prompt that reads
 * perfectly and teaches the model nothing.
 */
{
  const examples = guidePatchExampleLines();
  cases += 1;
  if (examples.split("\n").filter(Boolean).length < 5) {
    fail(`Only ${examples.split("\n").filter(Boolean).length} worked examples reach the prompt.`);
  }
  cases += 1;
  if (!examples.includes("Micah and Neil, both 5 years old")) {
    fail(
      "The message that started this work is not among the worked examples. It is the " +
        "canonical shared-age sentence; if anything regresses, it should be this.",
    );
  }
  for (const book of books) {
    const vars = buildGuideTurnVars({
      project: book.project,
      message: "Micah and Neil, both 5",
      playlist,
      transcript: [],
      patchContext,
    });
    const { system } = renderTextPrompt(prompts, TEMPLATE_KEY, { vars });
    cases += 1;
    if (!system.includes("Micah and Neil")) {
      fail(`The worked examples don't reach the assembled prompt for a ${book.name} book.`);
    }
  }

  // A selected person reaches the prompt, and the prompt tells the model to name them and to keep an age
  // out of a look change by meaning, not by words (the report: "make him 2 years old" only redrew).
  {
    const vars = buildGuideTurnVars({
      project: books[0]!.project,
      message: "make him 2 years old",
      playlist,
      transcript: [],
      patchContext,
      selected: "Nile's portrait",
    });
    const { system, user } = renderTextPrompt(prompts, TEMPLATE_KEY, { vars });
    cases += 1;
    if (!user.includes("Nile's portrait")) fail("The selected person does not reach the interpreter's prompt.");
    cases += 1;
    if (!/setPersonAge[^.]*never[^.]*editPersonLook/.test(system)) {
      fail("The interpreter is not told that an age is setPersonAge and never a look change.");
    }
    cases += 1;
    if (!system.includes("never a pronoun")) fail("The interpreter is not told to name the selected person, not a pronoun.");
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

const fresh = books[0]!.project;
const known = books[1]!.project; // has Maya, age 5

/** The sanitizer's non-model arguments, for a book and the message being read. */
function reading(message: string, on: Project = fresh): SanitizeGuideTurnOptions {
  return { playlist, message, project: on, patchContext };
}

/** One claim, with its evidence defaulting to something the message contains. */
function claim(
  slot: string,
  value: unknown,
  evidence: string,
  confidence = 0.95,
): { slot: string; value: unknown; evidence: string; confidence: number } {
  return { slot, value, evidence, confidence };
}

// A skip may only name a real, optional component. Everything else is dropped
// silently — the engine then asks the question again, which is the right outcome.
{
  const junk = ["", "story-cast ", "STORY-IDEA", "__proto__", "constructor", "nope"];
  const result = sanitizeGuideTurn(
    { intent: "skip", skip: [...junk, ...required], reply: "Sure.", confidence: 0.9 },
    reading("skip that"),
  );
  cases += 1;
  if (result.skip.length > 0) {
    fail(`Skips survived that shouldn't have: ${result.skip.join(", ")}.`);
  }
}
for (const id of optional) {
  const result = sanitizeGuideTurn(
    { intent: "skip", skip: [id], reply: "No problem.", confidence: 0.9 },
    reading("skip that"),
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
      reading("skip that"),
    );
    cases += 1;
    if (result.skip.length !== 1) fail("A repeated skip wasn't collapsed.");
  }
}

// A playlist that switched a component off can't be skipped past — there is
// nothing there to decline, and honouring it would let a stale client suppress a
// component an admin has since made required.
{
  const trimmed = playlist.filter((component) => component.id !== optional[0]);
  const result = sanitizeGuideTurn(
    { intent: "skip", skip: [optional[0]!], reply: "Ok.", confidence: 0.9 },
    { ...reading("skip that"), playlist: trimmed },
  );
  cases += 1;
  if (result.skip.length > 0) {
    fail("A skip named a component that isn't in this reader's playlist.");
  }
}

// --- Claims: the one the whole rewrite is for -------------------------------

/**
 * THE regression test.
 *
 * "Micah and Neil, both 5 years old" is the message that produced "I didn't quite
 * catch that" in the screenshot this work started from. Nothing about it is
 * ambiguous; it failed because the extraction was all-or-nothing, so one slot
 * failing to validate discarded the other.
 *
 * Checked as claims rather than as a patch, and with a deliberately broken third
 * claim in the same turn, because the property that matters is not "this sentence
 * works now" — it is that a bad claim can no longer take a good one down with it.
 */
{
  const message = "Micah and Neil, both 5 years old";
  const result = sanitizeGuideTurn(
    {
      intent: "answer",
      claims: [
        claim("heroes", ["Micah", "Neil"], "Micah and Neil"),
        claim(
          "heroAges",
          [
            { name: "Micah", age: 5 },
            { name: "Neil", age: 5 },
          ],
          "both 5 years old",
        ),
        claim("audience", { ageRangeId: "no-such-band" }, "Micah and Neil", 0.9),
      ],
      reply: "Micah and Neil, both five.",
      confidence: 0.95,
    },
    reading(message),
  );

  cases += 1;
  if (!("heroes" in result.patch) || !("heroAges" in result.patch)) {
    fail(
      `"${message}" produced ${JSON.stringify(Object.keys(result.patch))}; both the names ` +
        `and the ages have to survive a third claim being wrong.`,
    );
  }
  cases += 1;
  if (result.patch.audience !== undefined) {
    fail("An age band that does not exist reached the patch.");
  }
  cases += 1;
  if (!result.refused.some((r) => r.slot === "audience" && r.refusal === "rejected")) {
    fail("A claim the validator would refuse was dropped without being recorded.");
  }
}

/**
 * Evidence is the hallucination guard, and it is the only one that does not
 * depend on the model cooperating.
 *
 * A claim quoting words the reader never typed is thrown away whatever its
 * confidence says — a confidently invented age is worse than an unsure one, not
 * better, because nothing downstream will question it.
 */
{
  const result = sanitizeGuideTurn(
    {
      intent: "answer",
      claims: [
        claim("heroes", ["Maya"], "Maya"),
        claim("heroAges", [{ name: "Maya", age: 5 }], "she is five years old", 1),
      ],
      reply: "Maya, five.",
      confidence: 0.9,
    },
    reading("it's for Maya"),
  );
  cases += 1;
  if ("heroAges" in result.patch) {
    fail("An age the reader never stated was applied because the model sounded sure.");
  }
  cases += 1;
  if (!result.refused.some((r) => r.slot === "heroAges" && r.refusal === "unsupported")) {
    fail("An unsupported claim wasn't recorded as unsupported.");
  }
  cases += 1;
  if (!("heroes" in result.patch)) {
    fail("The supported claim in the same turn was lost along with the invented one.");
  }
}

// Quoting loosely is fine; quoting something else is not. Punctuation, case and
// spacing are not evidence, so a model copying the words correctly must not be
// punished for dropping a comma.
{
  const message = "Micah and Neil, both 5 years old!";
  for (const [quote, holds] of [
    ["Micah and Neil", true],
    ["micah and neil,", true],
    ["both  5 years   old", true],
    ["Micah and Neil, both 5 years old!", true],
    ["Neil and Micah", false],
    ["both 6 years old", false],
    ["", false],
    ["Mic", false],
  ] as [string, boolean][]) {
    cases += 1;
    if (claimEvidenceHolds(message, quote) !== holds) {
      fail(`Evidence "${quote}" against "${message}" should ${holds ? "hold" : "not hold"}.`);
    }
  }
}

/**
 * Any conversational act may also carry a fact, but weak incidental quotations
 * are not enough.
 *
 * Evidence verification catches most invention but not this: "what ages do you
 * support?" really does contain the word "ages", so a claim about the audience
 * quoting it passes the evidence check while being the opposite of what was meant.
 *
 * What is new is the second half — the loss has to be RECORDED. Dropping these
 * silently made a misclassified intent indistinguishable in the log from a model
 * that extracted nothing, and those have completely different fixes.
 */
{
  const claims = [claim("heroes", ["Maya"], "Maya")];
  for (const intent of ["question", "other", "skip"] as const) {
    const result = sanitizeGuideTurn(
      { intent, claims, reply: "Hello!", confidence: 0.9 },
      reading("is Maya a good name?"),
    );
    cases += 1;
    if (Object.keys(result.patch).length > 0) {
      fail(`A "${intent}" turn carried a fact, so a guess reached the book.`);
    }
    cases += 1;
    if (!result.refused.some((r) => r.refusal === "not-a-statement")) {
      fail(`A "${intent}" turn dropped its claims without recording why.`);
    }
  }
  const volunteered = sanitizeGuideTurn(
    { intent: "question", claims: [claim("heroes", ["Amira"], "The book is for Amira")], reply: "Printing takes a couple of weeks.", confidence: 0.9 },
    reading("How long does printing take? The book is for Amira"),
  );
  cases += 1;
  if (!("heroes" in volunteered.patch)) {
    fail("A question that also states who the book is for dropped the fact.");
  }

  for (const intent of ["answer", "revise"] as const) {
    const result = sanitizeGuideTurn(
      { intent, claims, reply: "Got it.", confidence: 0.9 },
      reading("it's for Maya"),
    );
    cases += 1;
    if (!("heroes" in result.patch)) fail(`A "${intent}" turn lost the fact it stated.`);
  }
}

// Pasted manuscripts are lossless: a short supporting quote cannot authorise a
// model to rewrite the rest of the story.
{
  const message = "Here is my story:\nOnce there was a fox.\nIt found its way home.";
  const exact = sanitizeGuideTurn(
    {
      intent: "answer",
      route: "own",
      claims: [claim("storyText", "Once there was a fox.\nIt found its way home.", "Here is my story")],
      reply: "I added your story.",
      confidence: 0.98,
    },
    reading(message),
  );
  cases += 1;
  if (exact.patch.storyText !== "Once there was a fox.\nIt found its way home.") {
    fail("An exact pasted manuscript did not reach the story.");
  }
  cases += 1;
  if (exact.route !== "own") fail("The own-words route was not preserved.");

  const rewritten = sanitizeGuideTurn(
    {
      intent: "answer",
      route: "own",
      claims: [claim("storyText", "Once there was a clever fox. It went home.", "Here is my story")],
      reply: "I added your story.",
      confidence: 0.98,
    },
    reading(message),
  );
  cases += 1;
  if ("storyText" in rewritten.patch) fail("A rewritten manuscript was accepted as the reader's exact words.");
  cases += 1;
  if (!rewritten.refused.some((r) => r.refusal === "unsupported")) {
    fail("A rewritten manuscript was dropped without recording why.");
  }

  const wrongRoute = sanitizeGuideTurn(
    {
      intent: "answer",
      route: "guided",
      claims: [claim("storyText", "Once there was a fox.\nIt found its way home.", "Here is my story")],
      reply: "I have the idea.",
      confidence: 0.9,
    },
    reading(message),
  );
  cases += 1;
  if ("storyText" in wrongRoute.patch) {
    fail("A guided-route message was allowed to become the manuscript.");
  }
}

// An absent claim list is an empty patch, never undefined — every caller passes
// this straight to `applyGuidePatch`.
{
  const result = sanitizeGuideTurn(
    { intent: "answer", reply: "Ok.", confidence: 0.5 },
    reading("hello"),
  );
  cases += 1;
  if (typeof result.patch !== "object" || result.patch === null) {
    fail("A turn with no claims didn't produce an empty object.");
  }
  cases += 1;
  if (result.skip.length !== 0) fail("A turn with no skips didn't produce an empty list.");
  cases += 1;
  if (result.refused.length !== 0) fail("A turn with no claims invented a refusal.");
}

// A field that isn't a writable fact dies on its own, and says so.
for (const slot of ["price", "isAdmin", "__proto__", "storyDraft", "nonsense"]) {
  const result = sanitizeGuideTurn(
    {
      intent: "answer",
      claims: [claim(slot, "x", "Maya"), claim("heroes", ["Maya"], "Maya")],
      reply: "Ok.",
      confidence: 0.9,
    },
    reading("it's for Maya"),
  );
  cases += 1;
  // `Object.hasOwn`, not `in`: `"__proto__" in {}` is true for every object, so
  // `in` cannot tell "the patch carries this key" from "every object inherits it".
  // That is the same confusion `isGuidePatchableSlot` used to make.
  if (Object.hasOwn(result.patch, slot)) fail(`A claim on "${slot}" reached the patch.`);
  cases += 1;
  if (!result.refused.some((r) => r.slot === slot && r.refusal === "unknown-slot")) {
    fail(`A claim on "${slot}" wasn't recorded as an unknown slot.`);
  }
  cases += 1;
  if (!("heroes" in result.patch)) {
    fail(`A claim on "${slot}" took a good claim down with it.`);
  }
}

// Below the floor is not worth acting on, however plainly it is quoted.
{
  const result = sanitizeGuideTurn(
    {
      intent: "answer",
      claims: [claim("heroes", ["Maya"], "Maya", 0.1)],
      reply: "Maya?",
      confidence: 0.4,
    },
    reading("maybe Maya, I'm not sure"),
  );
  cases += 1;
  if ("heroes" in result.patch) fail("A claim below the confidence floor was applied.");
  cases += 1;
  if (!result.refused.some((r) => r.refusal === "low-confidence")) {
    fail("A claim below the floor wasn't recorded as low-confidence.");
  }
}

// Two claims for one slot resolve to the more confident one, rather than merging
// into a third value that neither the reader nor the model proposed.
{
  const result = sanitizeGuideTurn(
    {
      intent: "answer",
      claims: [
        claim("heroes", ["Maya"], "Maya", 0.6),
        claim("heroes", ["Maya", "Leo"], "Maya and Leo", 0.95),
      ],
      reply: "Maya and Leo.",
      confidence: 0.9,
    },
    reading("Maya and Leo"),
  );
  cases += 1;
  if (JSON.stringify(result.patch.heroes) !== JSON.stringify(["Maya", "Leo"])) {
    fail(`Duplicate claims resolved to ${JSON.stringify(result.patch.heroes)}.`);
  }
  cases += 1;
  if (!result.refused.some((r) => r.refusal === "superseded")) {
    fail("The losing duplicate wasn't recorded.");
  }
}

/**
 * Blast radius, not confidence alone.
 *
 * The same 0.6 means two different things depending on what it would do. Filling
 * an empty slot at 0.6 is a cheap mistake the reader corrects in the next breath.
 * Overwriting a name they settled earlier at 0.6 is expensive — by the time
 * anyone notices, the cast sheets have been drawn from it — so it is asked about
 * first, and the question is a real sentence rather than a silent hold.
 */
{
  const overwrite = sanitizeGuideTurn(
    {
      intent: "revise",
      claims: [claim("heroes", ["Mya"], "Mya", 0.6)],
      reply: "Mya?",
      confidence: 0.7,
    },
    reading("actually it's Mya", known),
  );
  cases += 1;
  if ("heroes" in overwrite.patch) {
    fail("A middling-confidence claim overwrote a settled fact without asking.");
  }
  cases += 1;
  if (!overwrite.confirm) {
    fail("A held-back overwrite produced no question, so the reader can never approve it.");
  }
  cases += 1;
  if (overwrite.confirm && !/\?$/.test(overwrite.confirm)) {
    fail(`A confirmation isn't phrased as a question: "${overwrite.confirm}".`);
  }

  // The same claim, stated plainly, goes straight through.
  const sure = sanitizeGuideTurn(
    {
      intent: "revise",
      claims: [claim("heroes", ["Mya"], "Mya", 0.97)],
      reply: "Mya it is.",
      confidence: 0.95,
    },
    reading("actually it's Mya", known),
  );
  cases += 1;
  if (!("heroes" in sure.patch)) fail("A confident correction was held back anyway.");

  // And the same middling confidence FILLING a slot is applied — read back, not
  // held. Nothing is being taken away from the reader, so asking would be noise.
  const fill = sanitizeGuideTurn(
    {
      intent: "answer",
      claims: [claim("heroes", ["Mya"], "Mya", 0.6)],
      reply: "Mya?",
      confidence: 0.7,
    },
    reading("it's for Mya", fresh),
  );
  cases += 1;
  if (!("heroes" in fill.patch)) fail("A middling claim filling an empty slot was held back.");
  cases += 1;
  if (!fill.readBack.includes("heroes")) {
    fail("A middling claim was applied without being read back to the reader.");
  }
}

// --- The repair loop reads back a usable objection ---------------------------

/**
 * The repair prompt is only worth a round trip if it says something specific. A
 * model told "some claims were invalid" produces a second guess; one told
 * `heroAges: no cast member named Sam` produces a correction.
 */
{
  const result = sanitizeGuideTurn(
    {
      intent: "answer",
      claims: [claim("heroAges", [{ name: "Sam", age: 9 }], "Sam is 9")],
      reply: "Sam, nine.",
      confidence: 0.9,
    },
    reading("and Sam is 9", known),
  );
  const problems = describeClaimProblems(result.refused);
  cases += 1;
  if (!problems.includes("heroAges")) {
    fail(`The repair prompt doesn't name the slot that failed: "${problems}".`);
  }
  cases += 1;
  if (!problems.includes("Sam")) {
    fail(`The repair prompt doesn't quote what was refused: "${problems}".`);
  }

  // Refusals a second attempt cannot fix must NOT be sent back. Asking a model to
  // try again at something it already said it was unsure about is how an unsure
  // guess becomes a confident one with no new information behind it.
  const unsure = sanitizeGuideTurn(
    {
      intent: "answer",
      claims: [claim("heroes", ["Maya"], "Maya", 0.05)],
      reply: "Maya?",
      confidence: 0.3,
    },
    reading("maybe Maya"),
  );
  cases += 1;
  if (describeClaimProblems(unsure.refused) !== "") {
    fail("A low-confidence claim was sent back for repair.");
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
