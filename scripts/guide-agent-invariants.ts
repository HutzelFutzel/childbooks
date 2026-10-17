/**
 * Invariants for the Chat studio's skills: the catalog, the gate in front of it,
 * the planner, the follow-up questions, the composer's validator, language
 * following and the suggestion chips.
 *
 * The claims worth checking are the ones a parent would be hurt by:
 *
 * - a skill runs only on the reader's own words, never on a model's invention;
 * - one message never starts two paid steps, and never spends without a tap;
 * - anything that removes something is confirmed, with the impact the code
 *   computed, and a confirmation goes stale when the book changes under it;
 * - a missing step answers with its remedy instead of failing;
 * - "Add Christopher" asks his age, and an optional detail is asked once;
 * - the guide says "du", never "Sie", and writes American English;
 * - every admin setting explains what it changes.
 *
 * Offline and deterministic: pure functions over synthesized books.
 */
import en from "../books-frontend/messages/en.json";
import de from "../books-frontend/messages/de.json";
import {
  GUIDE_AGENT_META,
  createDefaultGuideAgentConfig,
  guideAgentSettingPaths,
  normalizeGuideAgentConfig,
  type GuideAgentConfig,
} from "../books-frontend/src/core/config/guideAgent";
import { britishSpellingsIn, validateComposed } from "../books-frontend/src/core/guide/agent/compose";
import { acceptGuideQuestion } from "../books-frontend/src/core/guide/speech";
import { addedPeople, personFollowUp } from "../books-frontend/src/core/guide/agent/followUps";
import { DEFAULT_HELP_ARTICLES, resolveHelpArticles } from "../books-frontend/src/core/guide/agent/help";
import {
  GUIDE_IDEA_GROUPS,
  GUIDE_IDEA_IDS,
  ideaMenuFor,
  questionIdeasFor,
  suggestionsFor,
} from "../books-frontend/src/core/guide/agent/ideas";
import { GUIDE_FACT_IDS, createDefaultGuideFactPolicies } from "../books-frontend/src/core/guide/factPolicy";
import {
  GUIDE_QUESTION_IDS,
  QUESTION_EXAMPLES,
  activeQuestion,
  questionExampleId,
} from "../books-frontend/src/core/guide/questions";
import { guideMessage, type GuideMessage } from "../books-frontend/src/core/guide/session";
import { storyTextHash } from "../books-frontend/src/core/story/revision";
import { GUIDE_COMMAND_IDS } from "../books-frontend/src/core/guide/agent/ids";
import { nextChatLocale } from "../books-frontend/src/core/guide/agent/language";
import { confirmStillValid, planTurn } from "../books-frontend/src/core/guide/agent/plan";
import { presentBeats } from "../books-frontend/src/core/guide/agent/present";
import { commandCoverageProblems, commandPromptLines, GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import { personNeedsStatedAge, REQUIREMENTS } from "../books-frontend/src/core/guide/agent/requirements";
import { screenCommandCalls } from "../books-frontend/src/core/guide/agent/screen";
import type { Beat, CommandCall, CommandContext } from "../books-frontend/src/core/guide/agent/types";
import { withMemberChanges, withPersonAsk } from "../books-frontend/src/core/guide/agent/commands/shared";
import { resolveTextColor } from "../books-frontend/src/core/guide/agent/commands/design";
import { restoreDesign, snapshotForChange } from "../books-frontend/src/core/guide/agent/restore";
import {
  asksForEarlierPicture,
  pictureHistory,
  withPortraitVersion,
} from "../books-frontend/src/core/guide/history";
import { currentPortrait, portraitEditPrompt, portraitInputs, portraitStatus, withPortrait } from "../books-frontend/src/core/guide/portrait";
import { asksForNewPicture, hasPicture, isBareRestart, redrawModeFor } from "../books-frontend/src/core/guide/redrawMode";
import { plannedPortraitReferences } from "../books-frontend/src/core/billing/referencePlan";
import { createDefaultPromptsConfig } from "../books-frontend/src/core/prompts/registry";
import { buildModifySubjectPrompt } from "../books-frontend/src/core/pipeline/illustration";
import { singleSubjectEdit } from "../books-frontend/src/core/pipeline/intentResolve";
import { partOnSubject } from "../books-frontend/src/core/pipeline/localize";
import { IN_PLACE_EDIT_FAILED } from "../books-frontend/src/core/pipeline/inPlaceMessage";
import { renderTextPrompt } from "../books-frontend/src/core/prompts/render";
import { resolvePromptsConfig } from "../books-frontend/src/core/prompts/context";
import type { Anchor } from "../books-frontend/src/core/types";
import { updateNodeContent } from "../books-frontend/src/core/versioning";
import { DEFAULT_GUIDE_COPY } from "../books-frontend/src/core/guide/copy";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { availableViews, BOOK_VIEWS, deriveJourney } from "../books-frontend/src/core/guide/journey";
import { briefOf, createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { createDefaultConfig, type Project, type StoryCastMember } from "../books-frontend/src/core/types";

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

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

// --- Books -----------------------------------------------------------------

function book(cast: StoryCastMember[], storyText = ""): Project {
  return {
    id: "agent-book",
    title: "Amanda and the Sea",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: {
      ...createDefaultConfig(),
      storyText,
      storyBrief: { ...createDefaultStoryBrief("guided"), cast },
    },
  };
}

const STORY = "Amanda and Arthur went to the sea. Arthur found a shell and gave it to Amanda.";
const twins = book(
  [
    { id: "c1", name: "Amanda", age: 4 },
    { id: "c2", name: "Arthur", age: 6 },
  ],
  STORY,
);

const ctx: CommandContext = {
  now: 1_000_000,
  guest: false,
  styles: [
    { id: "watercolor", label: "Watercolor" },
    { id: "crayon", label: "Crayon" },
  ],
  languages: [
    { id: "en-US", label: "English" },
    { id: "de-DE", label: "German" },
  ],
};

function call(id: CommandCall["id"], args: Record<string, string> = {}): CommandCall {
  return { id, args, evidence: "", confidence: 1, source: "tap" };
}

function castOf(project: Project) {
  return briefOf(project.config).cast ?? [];
}

const defaults = createDefaultGuideAgentConfig();

// --- Catalog ---------------------------------------------------------------

for (const problem of commandCoverageProblems()) check(false, `Skill catalog: ${problem}.`);
for (const id of GUIDE_COMMAND_IDS) {
  const def = GUIDE_COMMANDS[id];
  if (!def) continue;
  check(def.summary.trim().length > 10, `${id} has no summary for the interpreter.`);
  check(def.help.trim().length > 10, `${id} has no help line for answers.`);
  check(def.examples.length >= 2, `${id} needs at least two example phrasings.`);
  for (const requirement of def.requires) {
    check(Boolean(REQUIREMENTS[requirement]), `${id} requires unknown "${requirement}".`);
  }
  for (const text of [def.summary, def.help, ...def.examples]) {
    const british = britishSpellingsIn(text);
    check(british.length === 0, `${id} uses British spelling (${british.join(", ")}): "${text}".`);
  }
  check(!(def.paid && def.alwaysConfirm), `${id} is paid and always confirms: paid skills confirm with their button.`);
}
check(
  commandPromptLines(GUIDE_COMMAND_IDS).split("\n- ").length === GUIDE_COMMAND_IDS.length,
  "The interpreter's skill list does not name every skill once.",
);
check(
  !commandPromptLines(["removePerson"]).includes("story?:"),
  "An app-only argument (removePerson.story) is described to the interpreter.",
);

// --- Admin settings explain themselves ---------------------------------------

for (const path of guideAgentSettingPaths()) {
  const info = GUIDE_AGENT_META[path];
  check(Boolean(info), `Admin setting ${path} has no hint (GUIDE_AGENT_META).`);
  if (!info) continue;
  check(info.label.trim().length > 0 && info.effect.trim().length > 20, `Admin setting ${path} doesn't say what it changes.`);
  check(info.appearsIn.trim().length > 0, `Admin setting ${path} doesn't say where a parent would notice it.`);
  for (const text of [info.label, info.effect, info.appearsIn, info.example ?? "", info.caution ?? ""]) {
    const british = britishSpellingsIn(text);
    check(british.length === 0, `Admin hint for ${path} uses British spelling (${british.join(", ")}).`);
  }
}
{
  const normalized = normalizeGuideAgentConfig(undefined);
  check(JSON.stringify(normalized) === JSON.stringify(defaults), "An empty agent config does not normalize to the defaults.");
  check(defaults.persona.address === "informal", "The default persona is not informal (du, not Sie).");
  check(defaults.persona.register === "casual", "The default persona is not casual.");
  const junk = normalizeGuideAgentConfig({
    turn: { maxCommands: 99, commandFloor: -3 },
    persona: { address: "royal", avoid: "not a list" },
    skills: { removePerson: { enabled: "yes" }, madeUp: { enabled: true } },
  });
  check(junk.turn.maxCommands <= 6 && junk.turn.commandFloor >= 0.3, "Out-of-range turn limits are not clamped.");
  check(junk.persona.address === "informal", "An unknown address value is not replaced by the default.");
  check(!("madeUp" in junk.skills), "An unknown skill id survives normalization.");
}

// --- Screening: only the reader's own words run ----------------------------------

{
  const enabled = [...GUIDE_COMMAND_IDS];
  const message = "Add another character named Brian and make Amanda 2";
  const screened = screenCommandCalls({
    raw: [
      { id: "addPerson", args: [{ name: "name", value: "Brian" }], evidence: "Add another character named Brian", confidence: 0.9 },
      { id: "addPerson", args: [{ name: "name", value: "Bartholomew" }], evidence: "Add another character", confidence: 0.9 },
      { id: "setPersonAge", args: { person: "Amanda", age: "2" }, evidence: "make Amanda 2", confidence: 0.9 },
      { id: "removePerson", args: { person: "Amanda", story: "rewrite" }, evidence: "delete everyone", confidence: 0.99 },
      { id: "setTitle", args: { title: "Brian" }, evidence: "Brian", confidence: 0.2 },
      { id: "launchRockets", args: {}, evidence: "Add", confidence: 1 },
    ],
    message,
    enabled,
    floor: defaults.turn.commandFloor,
    max: defaults.turn.maxCommands,
  });
  check(screened.kept.length === 2, `Screening kept ${screened.kept.length} calls; expected the two grounded ones.`);
  const reasons = screened.refused.map((r) => r.reason).join(" | ");
  check(/Bartholomew/.test(reasons), "A name that isn't in the message was not refused.");
  check(/own words/.test(reasons), "Evidence that isn't in the message was not refused.");
  check(/floor/.test(reasons), "A call under the confidence floor was not refused.");
  check(/unknown skill/.test(reasons), "An unknown skill id was not refused.");

  const appArgs = screenCommandCalls({
    raw: [{ id: "removePerson", args: { person: "Arthur", story: "rewrite", id: "x" }, evidence: "remove Arthur", confidence: 0.9 }],
    message: "Please remove Arthur",
    enabled,
    floor: 0.6,
    max: 4,
  });
  check(
    appArgs.kept.length === 1 && !("story" in appArgs.kept[0]!.args) && !("id" in appArgs.kept[0]!.args),
    "An app-only argument from the model survives screening (it could skip the rewrite choice).",
  );

  const off = screenCommandCalls({
    raw: [{ id: "removePerson", args: { person: "Arthur" }, evidence: "remove Arthur", confidence: 0.9 }],
    message: "remove Arthur",
    enabled: enabled.filter((id) => id !== "removePerson"),
    floor: 0.6,
    max: 4,
  });
  check(off.kept.length === 0, "A skill the admin turned off still runs.");

  const many = screenCommandCalls({
    raw: ["Amanda", "Arthur", "Brian"].map((name) => ({
      id: "setPersonAge",
      args: { person: name, age: "3" },
      evidence: `${name} is 3`,
      confidence: 0.9,
    })),
    message: "Amanda is 3, Arthur is 3, Brian is 3",
    enabled,
    floor: 0.6,
    max: 2,
  });
  check(many.kept.length === 2 && many.overflow.length === 1, "Calls past the per-message cap are not held as overflow.");
}

// --- Planner ----------------------------------------------------------------------

{
  // "Amanda is 2 years old and I want to buy Sparks": both happen.
  const plan = planTurn({
    project: twins,
    calls: [call("setPersonAge", { person: "Amanda", age: "2" }), call("offerSparks")],
    ctx,
    config: defaults,
  });
  check(castOf(plan.project).find((m) => m.id === "c1")?.age === 2, "A combined request did not set Amanda's age.");
  check(plan.effects.some((e) => e.kind === "sparks"), "A combined request did not open the Sparks packs.");
  check(!plan.confirm && plan.blocked.length === 0, "A combined age + Sparks request asked or blocked.");
  const said = presentBeats(plan.beats, undefined);
  check(Boolean(said && said.meanings.length === 2), "A combined request did not say both results.");
}

{
  // A change to the people after the pages are drawn: one plain line, and nowhere to be "shown".
  const drawn = { ...twins, authoringState: { ...(twins.authoringState ?? {}), lockedAt: 1 } } as unknown as typeof twins;
  const plan = planTurn({ project: drawn, calls: [call("removePerson", { person: "Arthur" })], ctx, config: defaults });
  check(plan.steps.length === 0 && plan.blocked.length === 1, "Removing a person from a drawn book was not blocked.");
  check(plan.beats.some((b) => b.key === "lockedBlocked"), "A drawn book's blocked change did not use the plain line.");
  check(!plan.beats.some((b) => b.key === "blocked"), "A drawn book's blocked change still says the app's raw reason.");
  check(plan.views.length === 0 && !plan.blocked[0]!.remedy.view, "A drawn book's blocked change sends the reader to a view it does not help.");
}

{
  // Removing someone the story mentions: confirm, with the choice.
  const plan = planTurn({ project: twins, calls: [call("removePerson", { person: "Arthur" })], ctx, config: defaults });
  check(plan.steps.length === 0, "Removing a person ran before it was confirmed.");
  check(Boolean(plan.confirm), "Removing a person did not ask for confirmation.");
  const mentions = plan.confirm?.impact.effects.find((e) => e.kind === "storyMentions");
  check(mentions?.kind === "storyMentions" && mentions.count === 2, "The confirmation doesn't count Arthur's two mentions.");
  check(plan.confirm?.choices?.length === 2, "The confirmation doesn't offer rewrite-or-keep.");
  check(plan.beats.some((b) => b.key === "removeMentionsAsk"), "The guide doesn't ask whether to rewrite the story.");

  if (plan.confirm) {
    check(confirmStillValid(plan.confirm, twins, ctx), "A fresh confirmation is not valid on the same book.");
    check(
      !confirmStillValid(plan.confirm, twins, { ...ctx, now: plan.confirm.expiresAt + 1 }),
      "An expired confirmation still works.",
    );
    const edited = { ...twins, config: { ...twins.config, storyText: `${STORY} Arthur laughed.` } };
    check(!confirmStillValid(plan.confirm, edited, ctx), "A confirmation still works after the story changed under it.");

    const rewrite = planTurn({
      project: twins,
      calls: plan.confirm.calls.map((c) => ({ ...c, args: { ...c.args, story: "rewrite" } })),
      ctx,
      config: defaults,
      confirmed: true,
    });
    check(!castOf(rewrite.project).some((m) => m.name === "Arthur"), "Confirmed removal kept Arthur.");
    check(rewrite.effects.some((e) => e.kind === "reviseStory"), "Rewrite-without did not revise the story.");
    const keep = planTurn({
      project: twins,
      calls: plan.confirm.calls.map((c) => ({ ...c, args: { ...c.args, story: "keep" } })),
      ctx,
      config: defaults,
      confirmed: true,
    });
    check(!keep.effects.some((e) => e.kind === "reviseStory"), "Keep-the-story still revised the story.");
    check(keep.project.config.storyText === STORY, "Keep-the-story changed the story text.");
    check(
      (keep.project.authoringState?.removedNames ?? []).includes("Arthur"),
      "A removed person is not remembered, so the story's cast would add them back.",
    );
  }
}

{
  // "Remove Zed" when nobody is called Zed: asked, not confirmed.
  const plan = planTurn({ project: twins, calls: [call("removePerson", { person: "Zed" })], ctx, config: defaults });
  check(!plan.confirm, "An unresolvable removal showed a confirmation card.");
  check(Boolean(plan.ask), "An unresolvable removal did not ask who was meant.");
}

{
  // Rename everywhere, without a confirmation (it's reversible).
  const plan = planTurn({
    project: twins,
    calls: [call("renamePerson", { person: "Arthur", newName: "Artie" })],
    ctx,
    config: defaults,
  });
  check(!plan.confirm, "Renaming asked for confirmation.");
  check(/Artie found a shell/.test(plan.project.config.storyText), "Renaming did not rename the story text.");
  check(!/Arthur/.test(plan.project.config.storyText), "Renaming left the old name in the story.");
  const titled = planTurn({
    project: { ...twins, title: "Arthur's Shell" },
    calls: [call("renamePerson", { person: "Arthur", newName: "Artie" })],
    ctx,
    config: defaults,
  });
  check(
    titled.effects.some((e) => (e.kind === "title" || e.kind === "coverText") && e.title === "Artie's Shell"),
    "Renaming did not carry the new name into the title.",
  );
}

{
  // A refusal says why. Renaming onto a name that is taken is not "can't do that here".
  const taken = planTurn({ project: twins, calls: [call("renamePerson", { person: "Amanda", newName: "Arthur" })], ctx, config: defaults });
  const said = taken.beats.find((b) => b.key === "cannotDoThat");
  check(Boolean(said?.text?.includes("Arthur") && /already/i.test(said.text)), "A refused rename did not say that the name is taken.");
  check(!/here/i.test(DEFAULT_GUIDE_COPY.cannotDoThat), "The generic refusal still blames where the reader is.");
}

{
  // An age the drawing already has is not asked for.
  const estimated = book(
    [{ id: "c1", name: "Christopher", visualAge: { years: 2, source: "suggested" as const } }],
    STORY,
  );
  check(!personNeedsStatedAge(castOf(estimated)[0]!), "A person with a drawing estimate is still asked for an age.");
  const plan = planTurn({ project: estimated, calls: [call("drawPortraits")], ctx, config: defaults });
  check(plan.blocked[0]?.remedy.requirement !== "castAges", "Portraits wait for an age that has an estimate.");
}

{
  // Drawing the book before portraits: the remedy, not a failure.
  const plan = planTurn({ project: twins, calls: [call("drawBook")], ctx, config: defaults });
  check(plan.steps.length === 0, "The book started drawing without portraits.");
  const remedy = plan.blocked[0]?.remedy;
  check(remedy?.requirement === "portraitsDrawn", `Drawing the book blocked on ${remedy?.requirement ?? "nothing"}, not portraits.`);
  check(remedy?.command === "drawPortraits", "The portraits remedy doesn't offer drawing the portraits.");
  check(plan.beats[0]?.priority === "blocking", "The blocked line is not said first.");
}

{
  // Portraits need ages.
  const ageless = book([{ id: "c1", name: "Christopher" }], STORY);
  const plan = planTurn({ project: ageless, calls: [call("drawPortraits")], ctx, config: defaults });
  check(plan.blocked[0]?.remedy.requirement === "castAges", "Portraits were allowed without an age.");
}

{
  // "It's open on the right" is only said about a tab that exists. A tab that is not there yet is
  // explained, in words that never say it opened.
  const blank = { ...book([]), title: "" } as Project;
  const states: Record<string, Project> = {
    "no book yet": withAuthoring(blank, { entry: "guided" }),
    "story and people": twins,
    "no look chosen": { ...twins, config: { ...twins.config, styleReady: false } } as Project,
  };
  for (const [name, project] of Object.entries(states)) {
    const open = availableViews(project);
    for (const view of BOOK_VIEWS) {
      const result = GUIDE_COMMANDS.openView.run(project, { view }, ctx);
      check(
        (result.kind === "effect") === open.includes(view),
        `Showing the ${view} tab (${name}): ${result.kind}, but the tab is ${open.includes(view) ? "there" : "not there"}.`,
      );
      if (!open.includes(view)) {
        check(result.kind === "invalid" && result.say === true && !/open/i.test(result.reason), `The missing ${view} tab (${name}) is not explained.`);
        const plan = planTurn({ project, calls: [call("openView", { view })], ctx, config: defaults });
        check(!plan.beats.some((b) => b.key === "openedView") && plan.views.length === 0, `The missing ${view} tab (${name}) was reported open.`);
      }
    }
  }
  const drawn = GUIDE_COMMANDS.openView.run(states["no book yet"]!, { view: "cast" }, { ...ctx, portraitsRunning: true });
  check(drawn.kind === "invalid", "A running portrait opened the Characters tab with no book.");
}

{
  // One paid step per message.
  const plan = planTurn({
    project: twins,
    calls: [call("editPersonLook", { person: "Amanda", change: "darker hair" }), call("drawPortraits")],
    ctx,
    config: defaults,
  });
  const paid = plan.steps.filter((s) => GUIDE_COMMANDS[s.call.id].paid).length;
  check(paid <= 1, `One message ran ${paid} paid skills.`);
  check(plan.deferred.some((c) => c.id === "drawPortraits"), "A second paid skill was not deferred.");
  check(plan.beats.some((b) => b.key === "tooMany"), "The guide doesn't say it did the first part only.");
}

{
  // "Make Amanda and Arthur blonde": the same look change for two people is one batch, not a second purchase.
  const plan = planTurn({
    project: twins,
    calls: [
      call("editPersonLook", { person: "Amanda", change: "blonde hair" }),
      call("editPersonLook", { person: "Arthur", change: "blonde hair" }),
    ],
    ctx,
    config: defaults,
  });
  check(GUIDE_COMMANDS.editPersonLook.batchable === true, "editPersonLook doesn't batch several people.");
  check(
    plan.steps.filter((s) => s.call.id === "editPersonLook").length === 2,
    "The second person's look change was held back instead of run with the first.",
  );
  check(!plan.beats.some((b) => b.key === "tooMany"), "The guide says it only did part of a change that was done whole.");
  const noted = plan.beats.filter((b) => b.key === "lookNoted");
  check(noted.length <= 1, "Two people's look notes are said as two lines.");
  const named = noted.flatMap((b) => (Array.isArray(b.vars?.names) ? b.vars.names : [b.vars?.names]));
  check(
    noted.length === 0 || (named.includes("Amanda") && named.includes("Arthur")),
    "The look note names only one of the people it was about.",
  );
  // A different paid skill is still the second purchase.
  const mixed = planTurn({
    project: twins,
    calls: [
      call("editPersonLook", { person: "Amanda", change: "blonde hair" }),
      call("editPersonLook", { person: "Arthur", change: "blonde hair" }),
      call("drawPortraits"),
    ],
    ctx,
    config: defaults,
  });
  check(mixed.deferred.some((c) => c.id === "drawPortraits"), "A different paid skill ran in the same batch.");
}

{
  // An admin "always confirm" makes a safe skill confirm; it can't remove a code confirmation.
  const strict: GuideAgentConfig = {
    ...defaults,
    skills: { ...defaults.skills, setTitle: { enabled: true, confirm: true } },
  };
  const plan = planTurn({ project: twins, calls: [call("setTitle", { title: "The Big Shell" })], ctx, config: strict });
  check(Boolean(plan.confirm), "An admin's always-confirm was ignored.");
  const loose: GuideAgentConfig = {
    ...defaults,
    skills: { ...defaults.skills, removePerson: { enabled: true, confirm: false } },
  };
  const unnamed = book(
    [
      { id: "c1", name: "Amanda", age: 4 },
      { id: "c2", name: "Arthur", age: 6 },
      { id: "c3", name: "Leo", age: 5 },
    ],
    STORY,
  );
  const removal = planTurn({ project: unnamed, calls: [call("removePerson", { person: "Leo" })], ctx, config: loose });
  check(!removal.confirm && removal.steps.length === 1, "Removing a person the story never names still asked for confirmation; Undo is the safety.");
  check(!castOf(removal.project).some((m) => m.name === "Leo"), "Removing a person did not remove them.");
  const cautious: GuideAgentConfig = {
    ...defaults,
    skills: { ...defaults.skills, removePerson: { enabled: true, confirm: true } },
  };
  const asked = planTurn({ project: unnamed, calls: [call("removePerson", { person: "Leo" })], ctx, config: cautious });
  check(Boolean(asked.confirm) && asked.steps.length === 0, "An admin's always-confirm on removal was ignored.");
  const mentioned = planTurn({ project: twins, calls: [call("removePerson", { person: "Arthur" })], ctx, config: loose });
  check(Boolean(mentioned.confirm), "Removing someone the story names skipped the rewrite-or-keep question.");
  const redraft = planTurn({ project: twins, calls: [call("draftStory")], ctx, config: defaults });
  check(Boolean(redraft.confirm) || redraft.steps.length === 0, "Replacing an existing story ran without confirmation; Undo can't bring it back.");
  const photo = planTurn({ project: twins, calls: [call("deletePhoto", { person: "Amanda" })], ctx, config: defaults });
  check(!photo.steps.length, "Deleting a photo ran without a confirmation.");
}

{
  // A skill that's off is refused and said as such.
  const off: GuideAgentConfig = { ...defaults, skills: { ...defaults.skills, setTitle: { enabled: false, confirm: false } } };
  const plan = planTurn({ project: twins, calls: [call("setTitle", { title: "Nope" })], ctx, config: off });
  check(plan.steps.length === 0 && plan.refused.length === 1, "A disabled skill ran.");
  check(plan.beats.some((b) => b.key === "cannotDoThat"), "A disabled skill didn't say it can't do that here.");
}

{
  // The planner runs calls in order: "add Brian and make him 6" finds Brian.
  const plan = planTurn({
    project: twins,
    calls: [call("addPerson", { name: "Brian" }), call("setPersonAge", { person: "Brian", age: "6" })],
    ctx,
    config: defaults,
  });
  check(castOf(plan.project).find((m) => m.name === "Brian")?.age === 6, "A later call couldn't see a person added earlier.");
}

// --- Follow-ups: "how old is Christopher?" -------------------------------------------

{
  const before = twins;
  const plan = planTurn({ project: before, calls: [call("addPerson", { name: "Christopher" })], ctx, config: defaults });
  const added = addedPeople(before, plan.project);
  check(added.length === 1, "Adding Christopher did not add one person.");
  const first = personFollowUp(plan.project, defaults.people, added);
  check(first?.beat.key === "missingAges", "Adding Christopher did not ask his age first.");
  check(Boolean(first?.beat.mustSay?.includes("Christopher")), "The age question doesn't name Christopher.");

  const aged = planTurn({
    project: plan.project,
    calls: [call("setPersonAge", { person: "Christopher", age: "3" })],
    ctx,
    config: defaults,
  });
  const second = personFollowUp(aged.project, defaults.people, added);
  check(second?.beat.key === "askPersonDetail", "After his age, the optional detail wasn't asked.");
  const skipped = withPersonAsk(withPersonAsk(aged.project, added[0]!, "role", true), added[0]!, "look", true);
  check(personFollowUp(skipped, defaults.people, added) === null, "A skipped optional detail was asked again.");
  const quiet = personFollowUp(aged.project, { ...defaults.people, role: { askWhen: "never" } }, added);
  check(quiet === null, "The optional question was asked with the policy set to never.");
}

// --- Presenting: blocking stands alone, at most three lines --------------------------

{
  const beats: Beat[] = [
    { key: "done", priority: "result" },
    { key: "personAdded", priority: "result", vars: { names: "Brian" } },
    { key: "missingAges", priority: "question", vars: { names: ["Brian"] } },
    { key: "sparksOffer", priority: "result" },
    { key: "tooMany", priority: "answer", vars: { count: 2 } },
  ];
  const said = presentBeats(beats, undefined, 3);
  check(Boolean(said && said.meanings.length <= 3), "More than three lines in one message.");
  check(said?.keys[said.keys.length - 1] === "missingAges", "The question is not the last thing said.");
  const blocked = presentBeats([...beats, { key: "blocked", priority: "blocking", vars: { what: "a story." } }], undefined);
  check(blocked?.keys.length === 1 && blocked.keys[0] === "blocked", "A blocking line didn't stand alone.");
}

// --- The composer's validator ---------------------------------------------------------

{
  const expect = (locale: string, meaning: string, extra: Partial<Parameters<typeof validateComposed>[1]> = {}) => ({
    meaning,
    mustSay: [] as string[],
    question: meaning.trim().endsWith("?"),
    style: defaults.style.lines,
    persona: defaults.persona,
    locale,
    kind: "line" as const,
    ...extra,
  });
  const ok = (text: string, e: ReturnType<typeof expect>) => validateComposed(text, e).length === 0;
  const has = (text: string, e: ReturnType<typeof expect>, problem: string) =>
    (validateComposed(text, e) as string[]).includes(problem);

  check(ok("Alles klar, Amanda ist jetzt 2.", expect("de", "Got it—Amanda is 2.")), "A plain German line was rejected.");
  check(ok("Magst du noch jemanden dazunehmen?", expect("de", "Anyone else?")), "An informal German question was rejected.");
  check(has("Möchten Sie noch jemanden dazunehmen?", expect("de", "Anyone else?"), "address"), "German 'Sie' passed the informal persona.");
  check(has("Das zeige ich Ihnen gleich.", expect("de", "I'll show you."), "address"), "German 'Ihnen' passed the informal persona.");
  check(ok("Sie ist jetzt 2.", expect("de", "She is 2 now.")), "Sentence-initial 'Sie' (she) was mistaken for formal address.");
  check(has("Voulez-vous continuer ?", expect("fr", "Continue?"), "address"), "French 'vous' passed the informal persona.");
  check(has("Your favourite colour is ready.", expect("en-US", "Your favorite color is ready."), "britishSpelling"), "British spelling passed.");
  check(has("That costs 20 Sparks.", expect("en-US", "That uses Sparks."), "price"), "A price in a chat line passed.");
  check(has("Amanda is 3 now.", expect("en-US", "Got it—Amanda is 2."), "newNumber"), "A number the meaning doesn't contain passed.");
  check(
    has("Got it, she's two.", expect("en-US", "Got it—Amanda is 2.", { mustSay: ["Amanda"] }), "missingName"),
    "A line that dropped the name passed.",
  );
  check(has("Done. Anything else?", expect("en-US", "Done."), "questionAdded"), "A question the meaning didn't ask passed.");
  check(has("Done 🎉", expect("en-US", "Done."), "emoji"), "An emoji passed with emoji set to never.");
  check(
    has("Awesome, done.", expect("en-US", "Done.", { persona: { ...defaults.persona, avoid: ["awesome"] } }), "avoided"),
    "A word on the avoid list passed.",
  );
  check(has("**Done.**", expect("en-US", "Done."), "markup"), "Markdown passed.");
  check(
    has("What is the name of the other child?", expect("en-US", "What's their name?"), "inventedChild"),
    "A rephrasing that invented another child passed.",
  );
  check(
    ok("How old is the other child?", expect("en-US", "How old is the other child?")),
    "Asking about the other child was rejected when the meaning already said it.",
  );
}

{
  const open = {
    asks: ["names"],
    missing: ["names"],
    requiredMissing: ["names"],
    ageNames: [] as string[],
    sameAgeGroups: [] as string[][],
  };
  check(
    !acceptGuideQuestion({ ...open, text: "What is the name of the other child?", knownNames: [] }),
    "A follow-up invented another child when nobody is in the book.",
  );
  check(
    !acceptGuideQuestion({ ...open, text: "What is the name of the other child?", knownNames: ["Shiloh"] }),
    "A follow-up invented another child after one name.",
  );
  check(
    acceptGuideQuestion({ ...open, text: "Who should be in the story?", knownNames: [] }),
    "The plain names question was rejected.",
  );
  check(
    acceptGuideQuestion({
      text: "How old is Leo, the other child?",
      asks: ["ages"],
      missing: ["ages"],
      requiredMissing: ["ages"],
      ageNames: ["Leo"],
      sameAgeGroups: [],
      knownNames: ["Maya", "Leo"],
    }),
    "Asking the other child's age was rejected when two children are in the book.",
  );
}

// --- Language follow ---------------------------------------------------------------------

{
  const rule = defaults.language;
  const base = { current: "en-US", rule };
  check(
    nextChatLocale({ ...base, detected: "de", confidence: 0.97, message: "Kannst du Amanda bitte etwas älter machen?" })?.startsWith("de") ===
      true,
    "A clear German message did not switch the chat to German.",
  );
  check(nextChatLocale({ ...base, detected: "de", confidence: 0.97, message: "ok" }) === null, "'ok' switched the chat language.");
  check(nextChatLocale({ ...base, detected: "it", confidence: 0.6, message: "Amanda Paris Roma Milano" }) === null, "A low-confidence guess switched the language.");
  check(
    nextChatLocale({ ...base, rule: { ...rule, followMessage: false }, detected: "de", confidence: 0.99, message: "Mach sie bitte älter, danke dir" }) === null,
    "The chat followed the message language with following turned off.",
  );
  check(
    nextChatLocale({ ...base, detected: "de", confidence: 0.99, message: "Mach sie bitte älter, danke dir", bookLocale: "de-AT" }) === "de-AT",
    "The chat did not prefer the book's own German.",
  );
}

// --- Suggestion chips ------------------------------------------------------------------------

/** What the finished pages offer: how the words look, nothing about the story or the people. */
const FINISHED = ["largerText", "smallerText", "centerText", "textColor", "changeFont", "moveText", "pageColor", "changePicture", "addPage", "addBubble"];

{
  const ideas = suggestionsFor(twins, defaults, { guest: false });
  check(ideas.length > 0 && ideas.length <= defaults.ideas.max, `Suggestions for a drafted book: ${ideas.length}.`);
  for (const idea of ideas) {
    if (!idea.command) continue;
    check(
      !planTurn({ project: twins, calls: [call(idea.command, { person: idea.vars?.name ?? "", view: "cover", instruction: "shorter", style: "crayon", change: "x", look: "x", title: "x", name: "Brian" })], ctx, config: defaults }).blocked.length,
      `Suggestion "${idea.id}" leads to a blocked skill.`,
    );
  }
  const locked = withAuthoring(twins, { lockedAt: 1 });
  check(
    suggestionsFor(locked, defaults, { guest: false }).every((i) => ["showCover", "whatHappensNext", ...FINISHED].includes(i.id)),
    "Suggestions for a change show after the pages started.",
  );
  check(
    suggestionsFor(locked, { ...defaults, ideas: { ...defaults.ideas, max: 20 } }, { guest: false, view: "pages" }).some((i) =>
      FINISHED.includes(i.id),
    ),
    "A finished book offers nothing to try on its pages.",
  );
  check(
    !suggestionsFor(twins, { ...defaults, ideas: { ...defaults.ideas, max: 50 } }, { guest: false, view: "pages" }).some((i) =>
      FINISHED.includes(i.id),
    ),
    "The finished pages' ideas show before the pages are drawn.",
  );
  const hidden = suggestionsFor(twins, { ...defaults, ideas: { ...defaults.ideas, disabled: ideas.map((i) => i.id) } }, { guest: false });
  check(!hidden.some((i) => ideas.some((j) => j.id === i.id)), "A hidden suggestion still shows.");
  check(suggestionsFor(twins, { ...defaults, enabled: false }, { guest: false }).length === 0, "Suggestions show with skills off.");

  // The open tab leads: on Story, the story's own ideas come first and a few show only there.
  const wide = { ...defaults, ideas: { ...defaults.ideas, max: 12 } };
  const onStory = suggestionsFor(twins, wide, { guest: false, view: "story" });
  const elsewhere = suggestionsFor(twins, wide, { guest: false, view: "cast" });
  check(onStory[0]?.id === "checkStory", `The Story tab leads with "${onStory[0]?.id}", not the age check.`);
  for (const only of ["simplerStory", "warmerEnding", "readAloudRhythm", "storyHelp"] as const) {
    check(onStory.some((i) => i.id === only), `Story tab suggestions miss "${only}".`);
    check(!elsewhere.some((i) => i.id === only), `"${only}" shows outside the Story tab.`);
  }
  for (const idea of onStory) {
    if (idea.command !== "reviseStory" && idea.command !== "checkStory") continue;
    check(idea.instant === true, `"${idea.id}" asks for a typed sentence but its result is reviewed or advisory anyway.`);
  }
  check(
    onStory.filter((i) => i.command === "reviseStory").every((i) => i.instant),
    "A story change suggestion only fills the composer.",
  );
  check(
    suggestionsFor(twins, defaults, { guest: false, view: "story" }).length <= defaults.ideas.max,
    "The Story tab shows more suggestions than the admin allows.",
  );

  // Discovery: every skill decides what it suggests, the open tab decides what shows, and the book offers one next step.
  const enIdeas = (en.guide as unknown as Record<string, Record<string, string>>).ideas ?? {};
  const deIdeas = (de.guide as unknown as Record<string, Record<string, string>>).ideas ?? {};
  const seenIdeas = new Set<string>();
  for (const id of GUIDE_COMMAND_IDS) {
    const def = GUIDE_COMMANDS[id];
    if (!def) continue;
    check(def.suggest === false || (Array.isArray(def.suggest) && def.suggest.length > 0), `${id} does not say what it suggests (a list, or false on purpose).`);
    for (const idea of def.suggest || []) {
      check(!seenIdeas.has(idea.id), `Suggestion "${idea.id}" is declared twice.`);
      seenIdeas.add(idea.id);
      check(!idea.group || (GUIDE_IDEA_GROUPS as readonly string[]).includes(idea.group), `Suggestion "${idea.id}" has an unknown group.`);
      check(!(idea.marked && idea.lead), `Suggestion "${idea.id}" is marked and leads; a next step never needs a mark.`);
      check(!(idea.lead && idea.views && idea.views.length === 0), `Suggestion "${idea.id}" leads but names no tab to lead on.`);
    }
  }
  check(GUIDE_IDEA_IDS.length === new Set(GUIDE_IDEA_IDS).size, "A suggestion id is used twice.");
  const menuKeys = [
    "menuLabel",
    "menuTitle",
    "menuMarkTip",
    "menuElsewhere",
    "nextSuggested",
    "dismissNext",
    "groupQuestion",
    ...GUIDE_IDEA_GROUPS.map((g) => `group${g[0]!.toUpperCase()}${g.slice(1)}`),
  ];
  for (const key of menuKeys) {
    check(Boolean(enIdeas[key]), `The ideas menu has no English text for ${key}.`);
    check(Boolean(deIdeas[key]), `The ideas menu has no German text for ${key}.`);
  }
  for (const key of Object.keys(enIdeas)) {
    check(
      (GUIDE_IDEA_IDS as readonly string[]).includes(key) || menuKeys.includes(key),
      `guide.ideas.${key} is text for a suggestion that no skill declares any more.`,
    );
  }

  const longStory = `${STORY} `.repeat(3).trim();
  const long = book(twins.config.storyBrief.cast, longStory);
  const styled = long;
  const unstyled = { ...long, config: { ...long.config, styleReady: false } } as Project;
  const lookup = (project: Project, view: "story" | "cast" | "style" | "pages", extra: Record<string, unknown> = {}) =>
    suggestionsFor(project, wide, { guest: false, view, ...extra });
  const STORY_ONLY = ["checkStory", "shorterStory", "simplerStory", "warmerEnding", "readAloudRhythm", "storyHelp", "markNicer"];

  // Each tab suggests what is done on it, and the story's ideas stay on the story.
  for (const view of ["cast", "style", "pages"] as const) {
    const ids = lookup(styled, view).map((i) => i.id);
    check(ids.length > 0, `The ${view} tab has nothing to suggest.`);
    check(!ids.some((id) => STORY_ONLY.includes(id)), `The ${view} tab suggests a story idea: ${ids.join(", ")}.`);
    check(lookup(styled, view).every((i) => !i.elsewhere), `The ${view} tab's chips include another tab's idea.`);
  }
  const castIds = lookup(styled, "cast").map((i) => i.id);
  for (const id of ["renamePerson", "addPerson", "setAge", "relatePeople"]) {
    check(castIds.includes(id), `The Characters tab misses "${id}": ${castIds.join(", ")}.`);
  }
  check(!castIds.includes("describePlace"), "Describing a place is offered when the book has no places yet.");
  const withPlace: Project = {
    ...styled,
    anchors: [{ id: "a-house", type: "place", name: "Beach House", description: "", include: true, mode: "auto", sourceArt: [] } as Anchor],
  };
  check(lookup(withPlace, "cast").some((i) => i.id === "describePlace"), 'The Characters tab misses "describePlace" once a place exists.');
  check(lookup(unstyled, "style").some((i) => i.id === "chooseLook"), "The Look tab does not offer to pick a look.");
  check(lookup(styled, "style").some((i) => i.id === "changeLook") && !lookup(styled, "style").some((i) => i.id === "chooseLook"), "The Look tab offers to pick a look that is already picked.");
  for (const id of ["changeSubtitle", "changeAuthor", "changeCoverWords"]) {
    check(lookup(styled, "pages").some((i) => i.id === id), `The Pages tab misses "${id}".`);
  }

  // Nothing is offered that the book is not ready for: a size or layout can be changed once it was chosen,
  // a look is offered once there is a story to draw in it.
  const sizeChosen = withAuthoring(styled, { bookSetup: { formatConfirmedAt: 1 } });
  check(lookup(sizeChosen, "pages").some((i) => i.id === "changeSize"), 'The Pages tab misses "changeSize" once the size was chosen.');
  check(!lookup(styled, "pages").some((i) => i.id === "changeSize"), "A size nobody chose yet is offered for change.");
  const noStoryYet = { ...unstyled, config: { ...unstyled.config, storyText: "" } } as Project;
  check(!lookup(noStoryYet, "style").some((i) => i.id === "chooseLook"), "A look is offered before there is a story to draw in it.");

  // Before there is a book there is nothing to change: no chips and no menu entries about the book, only
  // the way back from the guided start. Nothing at all before the reader has chosen how to begin.
  const blank = { ...book([]), title: "" } as Project;
  const fresh = withAuthoring(blank, { entry: "guided" });
  const freshIds = suggestionsFor(fresh, wide, { guest: false, view: null }).map((i) => i.id);
  check(freshIds.join() === "writeMyself", `An empty book suggests something about a book that is not there: ${freshIds.join(", ")}.`);
  const freshMenu = ideaMenuFor(fresh, defaults, { guest: false, view: null }).flatMap((g) => g.ideas.map((i) => i.id));
  check(freshMenu.join() === "writeMyself", `An empty book's ideas menu lists the book's skills: ${freshMenu.join(", ")}.`);
  check(suggestionsFor(blank, wide, { guest: false, view: null }).length === 0, "Chips show before the reader has chosen how to begin.");
  check(!suggestionsFor(withAuthoring(blank, { entry: "own" }), wide, { guest: false, view: null }).some((i) => i.id === "writeMyself"), "Writing it yourself is offered to someone who already does.");
  check(!suggestionsFor(twins, wide, { guest: false, view: "story" }).some((i) => i.id === "writeMyself"), "Writing it yourself is offered once a story exists.");
  const writingStory = withAuthoring(fresh, { storyRun: { signature: "s", startedAt: 1, status: "running" } });
  check(!suggestionsFor(writingStory, wide, { guest: false, view: "story" }).some((i) => i.id === "writeMyself"), "Writing it yourself is offered while the story is being written.");
  check(!suggestionsFor(writingStory, wide, { guest: false, view: "story" }).some((i) => i.id === "changeLanguage"), "Changing the language is offered while the story is being written.");
  check(!ideaMenuFor(writingStory, defaults, { guest: false, view: "story" }).some((g) => g.ideas.some((i) => i.id === "writeMyself" || i.id === "changeLanguage")), "The ideas menu offers to switch mode or language while the story is being written.");
  check(!ideaMenuFor(twins, defaults, { guest: false, view: "story" }).some((g) => g.ideas.some((i) => i.id === "writeMyself" || i.id === "changeLanguage")), "The ideas menu offers to switch mode or language after the story is written.");
  const langCtx: CommandContext = { ...ctx, languages: [{ id: "de-DE", label: "German" }] };
  check(
    planTurn({ project: writingStory, calls: [call("chooseEntry", { entry: "own" })], ctx: langCtx, config: defaults }).blocked[0]?.remedy.requirement === "storyIdle",
    "Switching to own words ran while the story was being written.",
  );
  check(
    planTurn({ project: writingStory, calls: [call("setBookLanguage", { language: "German" })], ctx: langCtx, config: defaults }).blocked[0]?.remedy.requirement === "storyIdle",
    "Switching the book language ran while the story was being written.",
  );
  check(
    GUIDE_COMMANDS.setBookLanguage.run(twins, { language: "German" }, langCtx).kind === "noop",
    "Switching the book language succeeded after the story was written.",
  );

  // Example answers: one entry per question the guide asks, read from the journey, never from the skills.
  {
    const enEx = (en.guide as unknown as { examples?: Record<string, Record<string, string>> }).examples ?? {};
    const deEx = (de.guide as unknown as { examples?: Record<string, Record<string, string>> }).examples ?? {};
    for (const fact of GUIDE_FACT_IDS) {
      check((GUIDE_QUESTION_IDS as string[]).includes(fact), `The guide can ask for "${fact}" but has no example answers for it (or none on purpose).`);
    }
    for (const question of GUIDE_QUESTION_IDS) {
      const { examples, tip } = QUESTION_EXAMPLES[question];
      const wanted = [...Array.from({ length: examples }, (_, i) => String(i + 1)), ...(tip ? ["tip"] : [])].sort();
      for (const [name, catalog] of [["English", enEx], ["German", deEx]] as const) {
        const have = Object.keys(catalog[question] ?? {}).sort();
        check(have.join() === wanted.join(), `${name} example answers for "${question}" are ${have.join(", ") || "missing"}; expected ${wanted.join(", ") || "none"}.`);
        for (const key of have) {
          const text = catalog[question]?.[key] ?? "";
          check(text.trim().length > 0, `${name} example "${question}.${key}" is empty.`);
          // Chips are short; the tip is a sentence the menu shows.
          if (key !== "tip") check(text.length <= 60, `${name} example "${question}.${key}" is too long for a chip (${text.length}).`);
          if (name === "German") check(!/\b(Sie|Ihnen|Ihr|Ihre|Ihren)\b/.test(text), `German example "${question}.${key}" addresses the parent formally.`);
          if (name === "English") check(britishSpellingsIn(text).length === 0, `English example "${question}.${key}" uses British spelling.`);
          check(!text.endsWith("…"), `Example "${question}.${key}" ends in "…", which means "finish this sentence" to the chips.`);
        }
      }
    }
    for (const catalog of [enEx, deEx]) {
      for (const key of Object.keys(catalog)) check((GUIDE_QUESTION_IDS as string[]).includes(key), `guide.examples.${key} is text for a question the guide no longer asks.`);
    }
    // The first question is where people learn that pets, toys and made-up creatures count.
    check(QUESTION_EXAMPLES.names.examples >= 3 && QUESTION_EXAMPLES.names.tip, "Who is in the book has too few example answers, or no tip.");
    check(/pet/i.test(enEx.names?.tip ?? "") && /toy/i.test(enEx.names?.tip ?? ""), "The characters tip doesn't say pets and toys count.");
    check(Object.values(enEx.names ?? {}).some((text) => /hedgehog/i.test(text)), "No example shows an animal character.");

    // What shows, and what turns it off.
    const shown = questionIdeasFor("names", defaults);
    check(shown?.examples.length === QUESTION_EXAMPLES.names.examples && shown.tip, "Example answers for the open question don't show.");
    check(questionIdeasFor(null, defaults) === null, "Examples show with no question open.");
    check(questionIdeasFor("readingAge", defaults) === null, "A question a tap answers shows example answers.");
    check(questionIdeasFor("names", { ...defaults, ideas: { ...defaults.ideas, questionExamples: false } }) === null, "The admin's switch doesn't turn example answers off.");
    check(questionIdeasFor("names", { ...defaults, ideas: { ...defaults.ideas, enabled: false } }) === null, "Turning suggestions off leaves example answers.");
    check(questionIdeasFor("names", { ...defaults, enabled: false }) === null, "Turning the guide off leaves example answers.");
    const tried = questionIdeasFor("names", defaults, { [questionExampleId("names", 1)]: 2 });
    check(tried?.examples.at(-1)?.id === questionExampleId("names", 1), "An example the reader already tried doesn't give way to one they haven't.");
    check(new Set(shown?.examples.map((e) => e.id)).size === shown?.examples.length, "Two example answers share an id.");
    check(normalizeGuideAgentConfig({ ideas: { questionExamples: "yes" } }).ideas.questionExamples === defaults.ideas.questionExamples, "A bad value for the example-answers switch was kept.");

    // The question comes from the journey: the first fact still missing, or the card that is up.
    const policies = createDefaultGuideFactPolicies();
    const journeyOf = (project: Project) => deriveJourney(project, policies);
    check(activeQuestion(journeyOf(blank), null) === null, "A question is open before the reader chose how to begin.");
    check(activeQuestion(journeyOf(fresh), null) === "names", `A guided book with nobody in it is not asking who: ${activeQuestion(journeyOf(fresh), null)}.`);
    check(activeQuestion(journeyOf(withAuthoring(blank, { entry: "own" })), null) === null, "Someone writing their own story is asked a guided question.");
    check(activeQuestion(journeyOf(fresh), { kind: "storyBrief" }) === "storyBrief", "The story card isn't the open question.");
    check(activeQuestion(journeyOf(fresh), { kind: "coverWords" }) === "coverWords", "The cover card isn't the cover question.");
    check(activeQuestion(journeyOf(fresh), { kind: "castLooks" }) === "castLooks", "The looks card isn't the looks question.");
    check(activeQuestion(journeyOf(fresh), { kind: "castAges" }) === "ages", "The ages card isn't the ages question.");
    check(activeQuestion(journeyOf(fresh), { kind: "audienceConfirm" }) === "readingAge", "The reading-age card isn't the reading-age question.");
    check(activeQuestion(journeyOf(fresh), { kind: "drawBook" }) === null, "A card that asks nothing in words has example answers.");
  }

  // The next step follows what the book is waiting on, and only leads on its own tab.
  const lead = (project: Project, view: "story" | "cast" | "style" | "pages", extra: Record<string, unknown> = {}) =>
    suggestionsFor(project, defaults, { guest: false, view, ...extra });
  check(lead(unstyled, "style")[0]?.id === "chooseLook" && lead(unstyled, "style")[0]?.next === true, "A book without a look is not offered one on the Look tab.");
  check(!lead(unstyled, "cast").some((i) => i.next), "The look is offered as the next step on the Characters tab.");
  check(lead(styled, "cast")[0]?.id === "drawPortraits" && lead(styled, "cast")[0]?.next === true, "A book ready for portraits is not offered them on the Characters tab.");
  check(!lead(styled, "style").some((i) => i.next), "A step already done is still offered on the Look tab.");
  const noAges = { ...styled, config: { ...styled.config, storyBrief: { ...styled.config.storyBrief, cast: [{ id: "c1", name: "Amanda" }] } } } as Project;
  const ageLead = lead(noAges, "cast")[0];
  check(ageLead?.id === "setAge" && ageLead.next === true && ageLead.vars?.name === "Amanda", `A person without an age is not the next step: ${ageLead?.id}.`);
  check(
    !lead(noAges, "cast", { dismissed: [ageLead?.dismissKey ?? "x"] }).some((i) => i.next),
    "A next step that was set aside came back for the same state.",
  );
  check(
    lead(noAges, "cast", { dismissed: [ageLead?.dismissKey ?? "x"] }).length > 0,
    "Setting a next step aside removed the other chips.",
  );
  check(
    !suggestionsFor(styled, { ...defaults, skills: { ...defaults.skills, drawPortraits: { ...defaults.skills.drawPortraits, enabled: false } } }, { guest: false, view: "cast" }).some((i) => i.id === "drawPortraits"),
    "A suggestion for a skill the admin turned off is still shown.",
  );
  check(!lead(styled, "cast").some((i) => i.dismissKey && !i.next), "A chip carries a dismiss key without leading.");

  // The story check is offered once per version of the story.
  const hash = storyTextHash(longStory);
  const checked: GuideMessage = guideMessage("guide", "It reads well.", {
    fit: { verdict: "good", headline: "Fits", notes: [], dimensions: [], band: "4-6", textHash: hash },
  });
  const storyLead = (project: Project, extra: Record<string, unknown> = {}) => lead(project, "story", extra)[0];
  const first = storyLead(long);
  check(first?.id === "checkStory" && first.next === true && Boolean(first.dismissKey), "An unchecked story is not offered for its age check.");
  check(!lead(long, "story", { messages: [checked] }).some((i) => i.next), "A story already checked in this form is offered again.");
  check(!lead(long, "story", { dismissed: [first?.dismissKey ?? "x"] }).some((i) => i.next), "A dismissed offer came back for the same text.");
  const revised = { ...long, config: { ...long.config, storyText: `${longStory} They waved goodbye.` } };
  check(
    storyLead(revised, { messages: [checked], dismissed: [first?.dismissKey ?? "x"] })?.id === "checkStory",
    "A revised story is not offered for a fresh check.",
  );
  check(!lead(twins, "story").some((i) => i.next), "A story too short to read for its audience is offered a check.");
  check(lead(long, "story").length <= defaults.ideas.max, "The offer pushes the chips past the admin's maximum.");
  check(new Set(lead(long, "story").map((i) => i.id)).size === lead(long, "story").length, "The offer repeats a chip.");
  check(!suggestionsFor(long, defaults, { guest: false, view: "story", marked: true }).some((i) => i.next || !i.marked), "A marked passage shows an idea that does not act on it.");
  const drawing = withAuthoring(long, { lockedAt: 1 });
  check(!lead(drawing, "story").some((i) => i.next), "An offer was shown after the pages started.");
  check(lead(drawing, "story").length > 0, "Nothing is suggested while the pages draw.");
  check(
    lead(drawing, "story").every((i) => ["showCover", "whatHappensNext"].includes(i.id)),
    "Something that no longer applies is suggested while the pages draw.",
  );
  const tried = lead(long, "story", { used: { shorterStory: 3 } }).filter((i) => !i.next).map((i) => i.id);
  check(!tried.slice(0, 1).includes("shorterStory"), "A chip the reader keeps using does not give way to one they have not met.");
  check(
    lead(long, "story", { used: {} }).map((i) => i.id).join() === lead(long, "story").map((i) => i.id).join(),
    "No history changed the chips' order.",
  );

  // The menu lists the open tab's ideas first, then the other tabs'.
  const menu = ideaMenuFor(long, defaults, { guest: false, view: "story" });
  const menuIds = menu.flatMap((g) => g.ideas.map((i) => i.id));
  check(menu.length > 1 && new Set(menuIds).size === menuIds.length, "The ideas menu is empty or repeats an idea.");
  check(menu.every((g) => g.ideas.length > 0 && g.ideas.every((i) => i.group === g.group && (i.elsewhere === true) === g.elsewhere)), "A menu group holds another group's idea.");
  check(menu.every((g) => g.ideas.every((i) => !i.marked)), "The menu lists an idea that needs a marked passage.");
  for (const id of ["checkStory", "simplerStory", "warmerEnding", "readAloudRhythm", "renamePerson", "changeSubtitle"]) {
    check(menuIds.includes(id), `The Story tab's menu misses "${id}".`);
  }
  check(menu[0]?.elsewhere === false && menu[0].ideas.some((i) => i.id === "checkStory"), "The open tab's ideas do not lead the menu.");
  const firstElsewhere = menu.findIndex((g) => g.elsewhere);
  check(firstElsewhere > 0 && menu.slice(firstElsewhere).every((g) => g.elsewhere), "Other tabs' ideas are mixed in with this tab's.");
  check(menu.some((g) => g.elsewhere && g.ideas.some((i) => i.id === "renamePerson")), "Another tab's idea is not listed under the other tabs.");
  const castMenu = ideaMenuFor(long, defaults, { guest: false, view: "cast" });
  check(
    castMenu.filter((g) => !g.elsewhere).every((g) => g.ideas.every((i) => !STORY_ONLY.includes(i.id))),
    "A story idea is listed as this tab's on the Characters tab.",
  );
  check(
    ideaMenuFor(drawing, defaults, { guest: false, view: "story" }).every((g) => g.ideas.every((i) => ["showCover", "whatHappensNext", ...FINISHED].includes(i.id))),
    "The menu offers a change after the pages started.",
  );
  check(ideaMenuFor(long, { ...defaults, ideas: { ...defaults.ideas, enabled: false } }, { guest: false }).length === 0, "The menu ignores the admin's switch for ideas.");
  check(
    ideaMenuFor(long, { ...defaults, ideas: { ...defaults.ideas, disabled: ["simplerStory"] } }, { guest: false, view: "story" })
      .every((g) => g.ideas.every((i) => i.id !== "simplerStory")),
    "A hidden idea is in the menu.",
  );

  // Every suggestion the menu can show leads to a skill that plans without being blocked.
  for (const view of ["story", "cast", "style", "pages"] as const) {
    for (const group of ideaMenuFor(styled, defaults, { guest: false, view })) {
      for (const idea of group.ideas) {
        if (!idea.command) continue;
        check(
          !planTurn({ project: styled, calls: [call(idea.command, { person: idea.vars?.name ?? "", view: "cover", instruction: "shorter", style: "crayon", change: "x", look: "x", title: "x", name: "Brian" })], ctx, config: defaults }).blocked.length,
          `Menu suggestion "${idea.id}" on ${view} leads to a blocked skill.`,
        );
      }
    }
  }
}

// --- Copy: localized, casual, American -----------------------------------------------------------

{
  const enGuide = en.guide as unknown as Record<string, Record<string, string>>;
  const deGuide = de.guide as unknown as Record<string, Record<string, string>>;
  for (const id of GUIDE_IDEA_IDS) {
    check(Boolean(enGuide.ideas?.[id]), `Suggestion ${id} has no English text (guide.ideas).`);
    check(Boolean(deGuide.ideas?.[id]), `Suggestion ${id} has no German text (guide.ideas).`);
  }
  const enAgent = Object.keys(enGuide.agent ?? {}).sort().join(",");
  const deAgent = Object.keys(deGuide.agent ?? {}).sort().join(",");
  check(enAgent === deAgent, "guide.agent keys differ between English and German.");
  for (const section of ["agent", "ideas", "labels", "chrome"]) {
    for (const [key, value] of Object.entries(deGuide[section] ?? {})) {
      check(!/\b(Sie|Ihnen|Ihr|Ihre|Ihren)\b/.test(value.replace(/^Sie\b/, "")), `German guide.${section}.${key} addresses the parent formally: "${value}".`);
    }
  }
  for (const id of GUIDE_COMMAND_IDS) {
    const choices = GUIDE_COMMANDS[id].choices?.(twins, { person: "Arthur" }) ?? [];
    for (const choice of choices) {
      check(Boolean(enGuide.labels?.[choice.label]), `${id} offers "${choice.label}", which has no English label.`);
      check(Boolean(deGuide.labels?.[choice.label]), `${id} offers "${choice.label}", which has no German label.`);
    }
  }
  const shipped = [
    ...Object.values(DEFAULT_GUIDE_COPY),
    ...DEFAULT_HELP_ARTICLES.flatMap((a) => [a.title, a.body]),
  ];
  for (const text of shipped) {
    const british = britishSpellingsIn(text);
    check(british.length === 0, `Shipped guide copy uses British spelling (${british.join(", ")}): "${text}".`);
  }
  for (const article of DEFAULT_HELP_ARTICLES) {
    check(!/\d+\s*(sparks?|€|\$)|[€$]\s*\d/i.test(article.body), `Help article "${article.id}" states a price.`);
  }
  const disabled = resolveHelpArticles([{ id: "privacy", title: "", body: "", enabled: false }]);
  check(!disabled.some((a) => a.id === "privacy"), "A disabled help article is still used.");
  const custom = resolveHelpArticles([{ id: "custom-1", title: "Gift wrap", body: "We don't gift wrap yet.", enabled: true }]);
  check(custom.some((a) => a.id === "custom-1"), "An admin's own help article is not used.");
}

// --- Picture history: step back for free, a portrait takes its description with it ----------

{
  const amanda = castOf(twins)[0]!;
  const image = (project: Project, blobId: string, createdAt: number) => ({
    blobId,
    mimeType: "image/png",
    inputs: portraitInputs(project, castOf(project)[0]!),
    createdAt,
  });
  const drawn1 = withPortrait(twins, image(twins, "b1", 1));
  check(drawn1.committed, "A first portrait was not kept.");
  const withNote = withMemberChanges(drawn1.project, amanda.id, { portraitNote: "blue hair" });
  check(portraitStatus(withNote, amanda.id) === "stale", "A changed description did not date the portrait.");
  const drawn2 = withPortrait(withNote, image(withNote, "b2", 2));
  check(drawn2.committed, "A redrawn portrait was not kept.");
  const target = { kind: "person" as const, castId: amanda.id, name: "Amanda" };
  const history = pictureHistory(drawn2.project, target);
  check(history?.count === 2 && history.at === 1, "A redrawn portrait did not show two versions with the new one in the book.");
  check(pictureHistory(drawn1.project, target) === null, "A picture with one version offered a history.");
  const back = withPortraitVersion(drawn2.project, amanda.id, history!.ids[0]!);
  check(currentPortrait(back, amanda.id)?.blobId === "b1", "Stepping back did not show the earlier portrait.");
  check(portraitStatus(back, amanda.id) === "current", "An earlier portrait was flagged out of date for the description it was drawn from.");
  check(!castOf(back)[0]!.portraitNote, "Stepping back left the later description on the person.");
  const forward = withPortraitVersion(back, amanda.id, history!.ids[1]!);
  check(castOf(forward)[0]!.portraitNote === "blue hair" && portraitStatus(forward, amanda.id) === "current", "Stepping forward did not bring the later description back.");
  const tree = authoringOf(drawn2.project).portraits![amanda.id]!;
  const otherStyle = withAuthoring(drawn2.project, {
    portraits: {
      [amanda.id]: updateNodeContent(tree, history!.ids[0]!, {
        ...tree.nodes[history!.ids[0]!]!.content,
        inputs: { ...tree.nodes[history!.ids[0]!]!.content.inputs, styleKey: "another-style" },
      }),
    },
  });
  check(
    portraitStatus(withPortraitVersion(otherStyle, amanda.id, history!.ids[0]!), amanda.id) === "stale",
    "A portrait drawn in another art style was shown as current.",
  );
  const locked = withAuthoring(drawn2.project, { lockedAt: 5 });
  check(pictureHistory(locked, target) === null, "A portrait offered a history after the pages were drawn from it.");
  check(withPortraitVersion(locked, amanda.id, history!.ids[0]!) === locked, "A portrait changed after the pages were drawn from it.");

  // The skill: free, aimed by name or the selection, and quiet when there's nothing earlier.
  const named = planTurn({ project: drawn2.project, calls: [call("restorePicture", { person: "Amanda" })], ctx, config: defaults });
  check(named.effects.some((e) => e.kind === "picture" && e.delta === -1) && !named.confirm, "Going back to Amanda's earlier picture did not run at once.");
  const none = planTurn({ project: drawn1.project, calls: [call("restorePicture", { person: "Amanda" })], ctx, config: defaults });
  check(none.effects.length === 0 && none.beats.some((b) => b.key === "noEarlierPicture"), "Going back with one version said nothing useful.");
  const selected = planTurn({ project: drawn2.project, calls: [call("restorePicture")], ctx: { ...ctx, chip: target }, config: defaults });
  check(selected.effects.some((e) => e.kind === "picture"), "Going back did not use the selected picture.");
  check(GUIDE_COMMANDS.restorePicture.paid !== true, "Going back to an earlier picture is priced.");

  for (const [text, wants] of [
    ["Go back to the earlier picture", true],
    ["I liked the old portrait better", true],
    ["Bring back the previous version", true],
    ["Mach das frühere Bild wieder", true],
    ["Make dad's hair blue", false],
    ["Make the old man's hair blue", false],
    ["Draw Amanda", false],
  ] as const) {
    check(asksForEarlierPicture(text) === wants, `"${text}" ${wants ? "was not" : "was"} read as going back to an earlier picture.`);
  }
}

// --- Changing a picture edits it; a new picture only when asked --------------------------------

{
  const amanda = castOf(twins)[0]!;
  const target = { kind: "person" as const, castId: amanda.id, name: "Amanda" };
  const drawn = withPortrait(twins, {
    blobId: "b1",
    mimeType: "image/png",
    inputs: portraitInputs(twins, amanda),
    createdAt: 1,
  }).project;
  check(redrawModeFor(twins, target) === "new", "A change to a picture nobody has drawn yet was treated as an edit.");
  check(redrawModeFor(drawn, target) === "edit", "A change to a drawn portrait did not edit it.");
  check(redrawModeFor(drawn, target, { restart: true }) === "new", "Starting over still edited the picture.");
  check(redrawModeFor(drawn, target, { canEdit: false }) === "new", "A model that can't edit was asked to.");
  check(hasPicture(drawn, target) && !hasPicture(twins, target), "A drawn portrait was not told apart from none.");

  for (const [text, wants] of [
    ["Start over", true],
    ["Draw her again", true],
    ["Give me a completely different picture", true],
    ["Zeichne sie ganz neu, von vorne", true],
    ["Mach das nochmal neu", false],
    ["Make dad's hair blue", false],
    ["Make the hat a different color", false],
    ["Give her a red scarf", false],
  ] as const) {
    check(asksForNewPicture(text) === wants, `"${text}" ${wants ? "was not" : "was"} read as asking for a new picture.`);
  }
  check(isBareRestart("Start over.") && isBareRestart("try again"), "A bare request to start over kept text as a description.");
  check(!isBareRestart("Start over with a red scarf"), "A request with a change in it was treated as bare.");

  // The skill edits unless the reader said otherwise.
  const edit = planTurn({ project: drawn, calls: [call("editPersonLook", { person: "Amanda", change: "blue hair" })], ctx, config: defaults });
  const redraw = edit.effects.find((e) => e.kind === "redraw");
  check(Boolean(redraw) && redraw?.kind === "redraw" && redraw.mode === undefined, "A portrait change did not ask for the redraw that edits.");
  const fresh = planTurn({ project: drawn, calls: [call("editPersonLook", { person: "Amanda", change: "blue hair", mode: "new" })], ctx, config: defaults });
  const asked = fresh.effects.find((e) => e.kind === "redraw");
  check(asked?.kind === "redraw" && asked.mode === "new", "Asking for a new picture was lost on the way to the redraw.");

  // What the model is told and what the edit sends.
  const prompt = portraitEditPrompt(amanda, "make the hair blue", createDefaultPromptsConfig());
  check(prompt.includes("Amanda") && prompt.includes("make the hair blue"), "The portrait edit prompt lost the name or the change.");
  check(/only/i.test(prompt) && /exactly as it is/i.test(prompt), "The portrait edit prompt doesn't say to keep everything else.");
  check(!/art style:/i.test(prompt), "The portrait edit prompt restates the art style, which pulls toward a redraw.");
  const limits = { maxReferenceImages: 4, maxImages: 2, referenceEditing: true };
  check(plannedPortraitReferences(drawn, amanda.id, limits, { edit: true }) === 1, "A portrait edit isn't priced as sending the portrait.");
  check(plannedPortraitReferences(drawn, amanda.id, { ...limits, referenceEditing: false }, { edit: true }) === 0, "A portrait edit was planned on a model that can't edit.");
}

// --- A small change stays small: only the named part is redrawn ---------------------------------
{
  const arthur = { id: "a1", name: "Arthur", type: "character", description: "a small boy" } as unknown as Anchor;
  const mia = { id: "a2", name: "Mia", type: "character", description: "his sister" } as unknown as Anchor;
  const unsure = [{ op: "freeform" as const, instruction: "make Arthur's hair yellow", confidence: 0 }];

  // The resolver failing must not turn "make Arthur's hair yellow" into a page redraw.
  const one = singleSubjectEdit("make arthurs hair yellow", unsure, [arthur, mia]);
  check(one?.length === 1 && one[0]?.op === "modify" && one[0].targetAnchorId === "a1", "An unsure resolver on a one-subject change did not become an in-place change.");
  check(singleSubjectEdit("make Arthur's hair yellow", null, [arthur, mia])?.[0]?.targetAnchorId === "a1", "A failed resolver on a one-subject change did not become an in-place change.");
  check(singleSubjectEdit("make Arthur and Mia wave", unsure, [arthur, mia]) === null, "A change naming two subjects was forced into one.");
  check(singleSubjectEdit("make it night", unsure, [arthur, mia]) === null, "A change naming nobody was forced onto a subject.");
  const confident = [{ op: "freeform" as const, instruction: "Arthur sits under a tree at night", confidence: 0.9 }];
  check(singleSubjectEdit("Arthur sits under a tree at night", confident, [arthur, mia]) === null, "A confident whole-picture change was forced onto one subject.");
  const structured = [{ op: "remove" as const, targetAnchorId: "a2", confidence: 0.9 }];
  check(singleSubjectEdit("remove Mia, Arthur stays", structured, [arthur, mia]) === null, "A resolved change was overridden.");

  // The part a change is about must sit on the subject it is about.
  const box = { x: 0.4, y: 0.3, width: 0.2, height: 0.4 };
  check(partOnSubject(box, { x: 0.43, y: 0.27, width: 0.14, height: 0.1 }), "Hair on top of the subject was refused.");
  check(!partOnSubject(box, { x: 0.8, y: 0.8, width: 0.1, height: 0.1 }), "A part far from the subject was accepted.");
  check(!partOnSubject(box, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }), "A part much bigger than the subject was accepted.");

  // What the model is told when only a part is repainted.
  const partPrompt = buildModifySubjectPrompt({ anchor: arthur, instruction: "make Arthur's hair yellow", config: createDefaultConfig(), maskMode: true, hasSheetRef: false, part: "hair" });
  check(/only Arthur's hair/i.test(partPrompt) && /shape/i.test(partPrompt), "The part edit prompt doesn't limit the repaint to the part.");
  const wholePrompt = buildModifySubjectPrompt({ anchor: arthur, instruction: "make Arthur's hair yellow", config: createDefaultConfig(), maskMode: true, hasSheetRef: false });
  check(!/only Arthur's/i.test(wholePrompt), "The part wording leaked into an edit of the whole subject.");
  const ask = renderTextPrompt(resolvePromptsConfig(createDefaultPromptsConfig()), "localize/part", { vars: { name: "Arthur", descriptionSuffix: "", instruction: "make Arthur's hair yellow" } });
  check(ask.user.includes("Arthur") && ask.user.includes("make Arthur's hair yellow"), "The part-finding prompt lost the subject or the change.");

  check(IN_PLACE_EDIT_FAILED.length > 0 && DEFAULT_GUIDE_COPY.pageKeepFailed.includes("{n}"), "The words for a change that could not stay in place are missing.");
}

// --- Typed pictures: the admin's cap on what starts without a tap -------------------------------

{
  const cap = (value: unknown) =>
    normalizeGuideAgentConfig({ turn: { autoSpendSparks: value } }).turn.autoSpendSparks;
  check(cap(undefined) === defaults.turn.autoSpendSparks && defaults.turn.autoSpendSparks > 0, "The default cap for starting a typed picture is missing.");
  check(cap(5000) === 200 && cap(-3) === 0, "The cap for starting a typed picture is not bounded.");
}

{
  const limit = (key: "pictureBatchMax" | "extrasPagesMax" | "refreshBatchMax", value: unknown) =>
    normalizeGuideAgentConfig({ turn: { [key]: value } }).turn[key];
  check(limit("pictureBatchMax", undefined) === defaults.turn.pictureBatchMax && defaults.turn.pictureBatchMax >= 1, "The default picture batch limit is missing.");
  check(limit("pictureBatchMax", 500) === 24 && limit("pictureBatchMax", 0) === 1, "The picture batch limit is not bounded.");
  check(limit("extrasPagesMax", 500) === 40 && limit("refreshBatchMax", 500) === 60, "The page extras and refresh limits are not bounded.");
}

{
  const palette = normalizeGuideAgentConfig({
    palette: {
      colors: [
        { name: "  Sunset   Orange ", hex: "#FF7A3D" },
        { name: "sunset orange", hex: "#000000" },
        { name: "bad", hex: "red" },
        { name: "", hex: "#123456" },
        { name: "gold", hex: "#ffd700" },
      ],
      hidden: ["Lila", "lila", " "],
    },
  }).palette;
  check(palette.colors.length === 2 && palette.colors[0]!.name === "sunset orange" && palette.colors[0]!.hex === "#ff7a3d", "The palette keeps one valid color per name and folds the name.");
  check(palette.hidden.length === 1 && palette.hidden[0] === "lila", "The refused color names are not folded and unique.");
  check(resolveTextColor("Sunset Orange", palette) === "#ff7a3d" && resolveTextColor("sunset orange") === null, "A custom color name works only with the admin's palette.");
  check(resolveTextColor("gold", palette) === "#ffd700", "A custom name beats the built-in of the same name.");
  check(resolveTextColor("lila", palette) === null && resolveTextColor("lila") !== null, "A refused built-in name is not accepted, and only with the palette.");
  check(resolveTextColor("#abc", palette) === "#aabbcc", "A hex code always works, whatever the palette.");
  check(normalizeGuideAgentConfig({ palette: "nope" }).palette.colors.length === 0, "A broken palette falls back to empty.");
}

// --- The finished pages: size, color, alignment, font and position by words ----------------------

{
  type DBox = import("../books-frontend/src/core/design").TextBox;
  const box = (id: string, role: DBox["role"], size = 0.04, extra: Partial<DBox> = {}): DBox =>
    ({
      id,
      role,
      rect: { x: 0.1, y: 0.3, w: 0.8, h: 0.3 },
      z: 1,
      presetId: "plain",
      fontFamily: "Fredoka",
      fontSizePct: size,
      color: "#111111",
      align: "left",
      vAlign: "top",
      lineHeight: 1.3,
      paragraphs: [{ align: "right", spans: [{ text: "Once", color: "#ff0000", fontFamily: "Lora" }] }],
      ...extra,
    }) as DBox;
  const design = (pages: Record<string, DBox[]>) =>
    ({
      defaultFontFamily: "Fredoka",
      defaultFontSizePct: 0.04,
      pages: Object.fromEntries(Object.entries(pages).map(([id, textBoxes]) => [id, { textBoxes }])),
    }) as unknown as NonNullable<Project["design"]>;
  const finished = withAuthoring(
    {
      ...twins,
      design: design({
        "cover-front": [box("t", "book-title", 0.08), box("a", "book-author", 0.03)],
        p1: [box("p1b", "story-body")],
        p2: [box("p2b", "story-body")],
      }),
    },
    { lockedAt: 1 },
  );
  const fonts = [
    { id: "Lora", label: "Lora", category: "serif" },
    { id: "Merriweather", label: "Merriweather", category: "serif" },
    { id: "Fredoka", label: "Fredoka", category: "rounded" },
  ];
  const dctx: CommandContext = { ...ctx, fonts, pages: ["p1"] };
  const run = (id: CommandCall["id"], args: Record<string, string>, pages: string[] = ["p1"]) =>
    GUIDE_COMMANDS[id].run(finished, args, { ...dctx, pages });
  const sizeOf = (project: Project, page: string) => project.design?.pages[page]?.textBoxes[0]?.fontSizePct;
  const written = (result: ReturnType<typeof run>): Project | null => (result.kind === "write" ? result.project : null);

  // Larger: the whole book by default, so the type matches from page to page.
  const larger = written(run("setTextSize", { size: "larger" }));
  check(
    !!larger && sizeOf(larger, "p1")! > 0.04 && sizeOf(larger, "p1") === sizeOf(larger, "p2") && sizeOf(larger, "cover-front") === 0.08,
    "\"Larger\" did not grow every story page and only the story text.",
  );
  check(larger?.design?.sharedTextStyles?.["story-body"]?.fontSizePct === sizeOf(larger!, "p1"), "The book-wide text style did not follow a size change.");
  // "This page" is only that page.
  const onePage = written(run("setTextSize", { size: "smaller", scope: "page" }));
  check(!!onePage && sizeOf(onePage, "p1")! < 0.04 && sizeOf(onePage, "p2") === 0.04, "\"This page\" changed more than the page.");
  // Never past the floor or the ceiling.
  let size = finished;
  for (let i = 0; i < 40; i++) size = written(GUIDE_COMMANDS.setTextSize.run(size, { size: "larger" }, dctx)) ?? size;
  check(sizeOf(size, "p1")! <= 0.12 && sizeOf(size, "p1")! > 0.04, "Repeated \"larger\" went past the ceiling.");
  check(GUIDE_COMMANDS.setTextSize.run(size, { size: "larger" }, dctx).kind === "noop", "A size at its ceiling did not say so.");
  size = finished;
  for (let i = 0; i < 40; i++) size = written(GUIDE_COMMANDS.setTextSize.run(size, { size: "smaller" }, dctx)) ?? size;
  check(sizeOf(size, "p1")! >= 0.02, "Repeated \"smaller\" went below what prints legibly.");
  // The words on the cover.
  const title = written(run("setTextSize", { size: "smaller", part: "title" }));
  check(!!title && sizeOf(title, "cover-front")! < 0.08 && sizeOf(title, "p1") === 0.04, "\"Smaller title\" did not touch only the title.");
  // A title painted into the cover picture is explained, not edited.
  const baked: Project = {
    ...finished,
    design: design({ "cover-front": [box("t", "book-title", 0.08, { hidden: true })], p1: [box("p1b", "story-body")] }),
  };
  const bakedTitle = GUIDE_COMMANDS.setTextSize.run(baked, { size: "larger", part: "title" }, dctx);
  check(bakedTitle.kind === "invalid" && bakedTitle.say === true && /picture/i.test(bakedTitle.reason), "A painted-in title was edited or refused without a reason.");
  // A locked box is left alone.
  const pinned: Project = { ...finished, design: design({ p1: [box("p1b", "story-body", 0.04, { locked: true })] }) };
  check(GUIDE_COMMANDS.setTextSize.run(pinned, { size: "larger" }, dctx).kind === "invalid", "A locked box was resized.");

  // Color: a name or hex, never an invention; the words' own colours give way to it.
  const blue = written(run("setTextColor", { color: "dark blue" }));
  const spanColor = blue?.design?.pages.p1?.textBoxes[0]?.paragraphs[0]?.spans[0]?.color;
  check(blue?.design?.pages.p1?.textBoxes[0]?.color === "#1e3a8a" && spanColor === undefined, "A named color did not replace the box's and the words' colors.");
  check(written(run("setTextColor", { color: "#abc" }))?.design?.pages.p1?.textBoxes[0]?.color === "#aabbcc", "A short hex color was not widened.");
  check(["", "banana", "#12", "ffff"].every((c) => resolveTextColor(c) === null), "A made-up color was accepted.");
  check(resolveTextColor("Dunkelblau") === "#1e3a8a", "Color names in German are not understood.");
  check(run("setTextColor", { color: "banana" }).kind === "invalid", "An unknown color was applied.");

  // Alignment.
  const centered = written(run("setTextAlign", { align: "center" }));
  check(
    centered?.design?.pages.p1?.textBoxes[0]?.align === "center" && centered.design.pages.p1.textBoxes[0].paragraphs[0]?.align === undefined,
    "Centering did not override a paragraph's own alignment.",
  );
  check(run("setTextAlign", { align: "diagonal" }).kind === "invalid", "An alignment that doesn't exist was applied.");
  check(GUIDE_COMMANDS.setTextAlign.run(centered!, { align: "center" }, dctx).kind === "noop", "Centering centered text did not say it already was.");

  // Font: a name from the book's own list, a kind asks which, anything else is said no to.
  const lora = written(run("setTextFont", { font: "lora" }));
  check(lora?.design?.pages.p1?.textBoxes[0]?.fontFamily === "Lora" && lora.design.pages.p1.textBoxes[0].paragraphs[0]?.spans[0]?.fontFamily === undefined, "A named font was not applied cleanly.");
  const kind = run("setTextFont", { font: "a serif font" });
  check(kind.kind === "ask" && kind.options.length === 2, "A kind of font did not ask which.");
  const nope = run("setTextFont", { font: "Comic Sans" });
  check(nope.kind === "invalid" && nope.say === true, "A font the book does not offer was applied.");

  // Position: a small step, on the page in view, inside the page, kept where it is put.
  const up = written(run("moveText", { direction: "up" }));
  const moved = up?.design?.pages.p1?.textBoxes[0];
  check(!!moved && moved.rect.y < 0.3 && moved.placedByReader === true && up?.design?.pages.p2?.textBoxes[0]?.rect.y === 0.3, "Moving the text up moved the wrong thing.");
  let edge = finished;
  for (let i = 0; i < 30; i++) edge = written(GUIDE_COMMANDS.moveText.run(edge, { direction: "down" }, dctx)) ?? edge;
  const bottom = edge.design?.pages.p1?.textBoxes[0]?.rect;
  check(!!bottom && bottom.y + bottom.h <= 1.0001, "Repeated moves took the text off the page.");

  // They need pages, change no one's story, and one Undo takes them back.
  for (const id of ["setTextSize", "setTextColor", "setTextAlign", "setTextFont", "moveText"] as const) {
    const def = GUIDE_COMMANDS[id];
    check(def.requires.includes("pagesStarted") && def.undoable === true && !def.paid, `${id} is not a free, undoable change that waits for the pages.`);
    const early = planTurn({ project: twins, calls: [call(id, { size: "larger", align: "left", color: "red", font: "Lora", direction: "up" })], ctx: dctx, config: defaults });
    check(early.blocked.length === 1 && early.blocked[0]!.remedy.requirement === "pagesStarted", `${id} ran before the pages started.`);
  }
  const planned = planTurn({ project: finished, calls: [call("setTextSize", { size: "larger" })], ctx: dctx, config: defaults });
  check(planned.blocked.length === 0 && !planned.confirm && planned.steps.length === 1, "A text size change asked for confirmation instead of just happening.");
  const wrote = written(run("setTextSize", { size: "larger" }))!;
  check(JSON.stringify(wrote.config) === JSON.stringify(finished.config), "A text change touched the story's settings.");
  const back = restoreDesign(
    { ...wrote } as Project,
    JSON.parse(snapshotForChange(finished, wrote)) as Record<string, unknown>,
  );
  check(JSON.stringify(back.design) === JSON.stringify(finished.design), "Undo did not restore the pages' design.");
}

report.push("Chat skills");
report.push(`  ${GUIDE_COMMAND_IDS.length} skills, ${Object.keys(REQUIREMENTS).length} requirements, ${guideAgentSettingPaths().length} admin settings with hints`);
report.push(`  ${GUIDE_IDEA_IDS.length} suggestion chips, ${DEFAULT_HELP_ARTICLES.length} shipped help articles`);
notes.push(
  `Chat skills: ${GUIDE_COMMAND_IDS.filter((id) => GUIDE_COMMANDS[id].paid).length} paid, ` +
    `${GUIDE_COMMAND_IDS.filter((id) => GUIDE_COMMANDS[id].impact || GUIDE_COMMANDS[id].alwaysConfirm).length} with a computed impact`,
);

export function checkGuideAgent(): CheckResult {
  return { failures, notes, report, cases };
}
