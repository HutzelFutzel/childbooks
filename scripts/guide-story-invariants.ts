/**
 * Invariants for story details: what a parent can shape before the Chat writes
 * the story, and the admin policy in front of it.
 *
 * The claims worth checking are the ones a parent would notice:
 *
 * - nothing is written before they say go (under "wait"), and "go" always starts it;
 * - a detail they chose reaches the draft prompt, and changing it makes a
 *   running draft stale;
 * - undo restores exactly what was there (capture → apply is the identity);
 * - adding a detail is never mistaken for overwriting one;
 * - an option the age band doesn't offer is refused, not invented;
 * - every detail is labeled in English and German (casual "du"), has a
 *   question, a prompt line and an admin hint.
 *
 * Offline and deterministic: pure functions over synthesized books.
 */
import en from "../books-frontend/messages/en.json";
import de from "../books-frontend/messages/de.json";
import {
  BRIEF_STARTS,
  STORY_DETAIL_POLICIES,
  askedDetails,
  briefStage,
  createDefaultGuideBriefConfig,
  describeBriefPolicy,
  guideBriefConfigSchema,
  normalizeGuideBriefConfig,
  offeredDetails,
  type GuideBriefConfig,
} from "../books-frontend/src/core/guide/briefPolicy";
import { createDefaultGuideConfig, guideConfigSchema, normalizeGuideConfig } from "../books-frontend/src/core/config/guide";
import { resolveStoryCraft } from "../books-frontend/src/core/config/storyCraft";
import { claimOverwritesSettledFact } from "../books-frontend/src/core/guide/claims";
import { DEFAULT_GUIDE_COPY, GUIDE_COPY_HELP } from "../books-frontend/src/core/guide/copy";
import { createDefaultGuideFactPolicies } from "../books-frontend/src/core/guide/factPolicy";
import {
  audienceQuestion,
  deriveJourney,
  factsSettled,
  readyToDraft,
  storyBriefWell,
} from "../books-frontend/src/core/guide/journey";
import { applyGuidePatch, captureGuideFacts, guidePatchContext, guidePatchShapeLines } from "../books-frontend/src/core/guide/patch";
import { withAuthoring, withFactMarks } from "../books-frontend/src/core/guide/projectState";
import {
  readingAgeAskLine,
  readingAgeExpectation,
  suggestedAudience,
  withChosenAudience,
  withLinkedAudience,
} from "../books-frontend/src/core/guide/readingAge";
import {
  STORY_DETAIL_GROUPS,
  STORY_DETAIL_IDS,
  STORY_DETAILS,
  detailPromptLines,
  filledDetails,
  withStoryDetail,
  type DetailPatch,
  type StoryDetailId,
} from "../books-frontend/src/core/guide/storyDetails";
import { storyMoments } from "../books-frontend/src/core/guide/hardcover";
import { buildStoryDraftPrompt, buildStoryRevisionPrompt } from "../books-frontend/src/core/prompts/story";
import { parseStoryBeats, serializeStoryBeats } from "../books-frontend/src/core/story/beats";
import { restoreModelLineBreaks } from "../books-frontend/src/core/story/lineBreaks";
import {
  applyStoryRevision,
  assessStoryRevision,
  isEagerStoryEdit,
  proposalFromRewrite,
  rewritesWholeStory,
  validateStoryRevision,
} from "../books-frontend/src/core/story/revision";
import { briefOf, createDefaultStoryBrief, storyBriefSchema, storyBriefSignature } from "../books-frontend/src/core/story/brief";
import { createDefaultConfig, type Project } from "../books-frontend/src/core/types";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

const context = guidePatchContext({});
const policies = createDefaultGuideFactPolicies();

/** A guided book whose names, ages and reading age are known: the moment the story card appears. */
function readyBook(storyText = ""): Project {
  const project = unconfirmedBook(storyText);
  return withAuthoring(project, { answeredFacts: ["idea", "readingAge"] });
}

/** Names and ages known; "Maya is 4, so … for 4–5 years. Right?" not answered yet. */
function unconfirmedBook(storyText = "", age = 4): Project {
  const project: Project = {
    id: "story-book",
    title: "",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: {
      ...createDefaultConfig(),
      storyText,
      storyBrief: { ...createDefaultStoryBrief("guided"), cast: [{ id: "c1", name: "Maya", age }] },
    },
  };
  return withAuthoring(project, { entry: "guided", askedFacts: ["names", "ages", "idea"], answeredFacts: ["idea"] });
}

const craftOf = (project: Project) => resolveStoryCraft(project.config.ageRangeId, null);

/** One plausible value per detail, using the band's own ids where it has them. */
function sampleFor(id: StoryDetailId, project: Project): DetailPatch {
  const def = STORY_DETAILS[id];
  if (def.kind === "toggle") return { on: true };
  const options = def.options(craftOf(project));
  if (options.length > 0) return { ids: options.slice(0, Math.max(1, Math.min(def.maxIds, 2))).map((o) => o.id) };
  return { text: `something about ${id}` };
}

// --- The registry: labeled, asked, prompted, explained -------------------------------------------

{
  const enBrief = (en.guide as unknown as { brief: Record<string, Record<string, unknown>> }).brief;
  const deBrief = (de.guide as unknown as { brief: Record<string, Record<string, unknown>> }).brief;
  const groups = new Set(STORY_DETAIL_GROUPS.map((g) => g.id));
  const defaults = createDefaultGuideBriefConfig();
  const project = readyBook();
  for (const id of STORY_DETAIL_IDS) {
    const def = STORY_DETAILS[id];
    check(def.id === id, `Story detail ${id} is registered under another id (${def.id}).`);
    check(groups.has(def.group), `Story detail ${id} is in an unknown group "${def.group}".`);
    check(def.label.trim().length > 0 && def.effect.trim().length > 20, `Story detail ${id} has no admin label or hint.`);
    check(def.question.includes("?"), `Story detail ${id} has no question for Ask.`);
    check(STORY_DETAIL_POLICIES.includes(defaults.details[id]), `Story detail ${id} has no default policy.`);
    check(Boolean(enBrief.fields?.[id]), `Story detail ${id} has no English label (guide.brief.fields).`);
    check(Boolean(deBrief.fields?.[id]), `Story detail ${id} has no German label (guide.brief.fields).`);
    const takesWords = def.kind === "text" || (def.ownWords && def.kind !== "toggle");
    if (takesWords) {
      check(Boolean(enBrief.examples?.[id]), `Story detail ${id} takes the parent's words but has no English example for its field.`);
      check(Boolean(deBrief.examples?.[id]), `Story detail ${id} takes the parent's words but has no German example for its field.`);
    }
    // Fixed lists are labeled in the UI language; catalog ones use the admin's own labels.
    const fixed = def.options({ themes: [], settings: [], devices: [] });
    for (const option of fixed) {
      const enOptions = enBrief.options?.[id] as Record<string, string> | undefined;
      const deOptions = deBrief.options?.[id] as Record<string, string> | undefined;
      check(Boolean(enOptions?.[option.id]), `Story detail ${id} option ${option.id} has no English label.`);
      check(Boolean(deOptions?.[option.id]), `Story detail ${id} option ${option.id} has no German label.`);
      check(option.guidance.trim().length > 0, `Story detail ${id} option ${option.id} tells the prompt nothing.`);
    }
    const brief = withStoryDetail(briefOf(project.config), id, sampleFor(id, project));
    const line = detailPromptLines(brief, craftOf(project), []);
    check(line.trim().length > 0, `Story detail ${id} set on a book adds nothing to the draft prompt.`);
  }
  for (const section of ["fields", "examples", "title", "hint", "status", "ownWords", "ownWordsHint", "add", "cancel", "remove"]) {
    check(section in enBrief && section in deBrief, `guide.brief.${section} is missing in English or German.`);
  }
  const flat = (value: unknown): string[] =>
    typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(flat) : [];
  for (const text of flat(deBrief)) {
    check(!/\b(Sie|Ihnen|Ihr|Ihre|Ihren)\b/.test(text.replace(/^Sie\b/, "")), `German guide.brief addresses the parent formally: "${text}".`);
  }
  for (const key of ["briefOffer", "briefAsk", "briefMore", "briefRewriteOffer", "writeStory"] as const) {
    check(Boolean(DEFAULT_GUIDE_COPY[key]), `Guide copy ${key} has no default.`);
    check(Boolean(GUIDE_COPY_HELP[key]), `Guide copy ${key} has no admin hint.`);
  }
  const enLabels = (en.guide as unknown as { labels: Record<string, string> }).labels;
  const deLabels = (de.guide as unknown as { labels: Record<string, string> }).labels;
  check(Boolean(enLabels.writeStory && deLabels.writeStory), "The Write the story button has no English or German label.");
}

// --- Admin policy: defaults, schema, normalization ----------------------------------------------

{
  const defaults = createDefaultGuideBriefConfig();
  check(defaults.start === "wait", "By default the story no longer waits for the parent.");
  check(guideBriefConfigSchema.safeParse(defaults).success, "The default story options fail their own schema.");
  check(guideConfigSchema.safeParse(createDefaultGuideConfig()).success, "The default guide config fails its schema with story options.");
  const junk = normalizeGuideBriefConfig({ start: "later", details: { mood: "always", avoid: "ask", nope: "ask" } });
  check(junk.start === defaults.start, "An unknown start value was kept.");
  check(junk.details.mood === defaults.details.mood, "An unknown detail policy was kept.");
  check(junk.details.avoid === "ask", "A valid stored detail policy was dropped.");
  check(!("nope" in junk.details), "An unknown story detail was kept in the policy.");
  const legacy = normalizeGuideConfig({});
  check(JSON.stringify(legacy.brief) === JSON.stringify(defaults), "A stored guide config without story options doesn't get the defaults.");
  for (const start of BRIEF_STARTS) {
    for (const policy of STORY_DETAIL_POLICIES) {
      const config: GuideBriefConfig = {
        start,
        details: Object.fromEntries(STORY_DETAIL_IDS.map((id) => [id, policy])) as GuideBriefConfig["details"],
      };
      check(describeBriefPolicy(config).trim().length > 0, `No admin summary for start=${start}, all ${policy}.`);
    }
  }
}

// --- Stages: nothing before "go", and "go" always starts it ----------------------------------------

{
  const wait = createDefaultGuideBriefConfig();
  const fresh = readyBook();
  check(briefStage(fresh, wait).kind === "review", "Under 'wait' the story card doesn't appear once names and ages are known.");
  check(!readyToDraft(fresh, policies, { brief: wait }), "Under 'wait' the story starts before the parent says go.");
  check(storyBriefWell(fresh, policies, { brief: wait })?.kind === "storyBrief", "Under 'wait' there is no story card well.");
  check(readyToDraft(fresh, policies), "Without story options the story no longer starts once the facts are known.");

  const started = withAuthoring(fresh, { briefStartAt: 1 });
  check(briefStage(started, wait).kind === "go", "'Write the story' doesn't move the book to go.");
  check(readyToDraft(started, policies, { brief: wait }), "'Write the story' doesn't start the draft.");
  check(storyBriefWell(started, policies, { brief: wait }) === null, "The story card stays after 'Write the story'.");

  const auto: GuideBriefConfig = { ...wait, start: "auto" };
  check(readyToDraft(fresh, policies, { brief: auto }), "Under 'auto' with no questions the story doesn't start.");

  const asking: GuideBriefConfig = { ...auto, details: { ...auto.details, bedtime: "ask", avoid: "ask" } };
  const first = briefStage(fresh, asking);
  check(first.kind === "ask" && first.detail === askedDetails(asking)[0], "An Ask detail isn't asked first.");
  check(!readyToDraft(fresh, policies, { brief: asking }), "The story starts before an Ask question is asked.");
  const asked = withAuthoring(fresh, { briefAsked: ["bedtime"], briefOpen: "bedtime" });
  const open = briefStage(asked, asking);
  check(open.kind === "waiting" && open.detail === "bedtime", "The open question isn't waited on.");
  check(storyBriefWell(asked, policies, { brief: asking })?.focus === "bedtime", "The story card doesn't focus the asked detail.");
  const answered = withAuthoring(asked, { briefOpen: undefined });
  const next = briefStage(answered, asking);
  check(next.kind === "ask" && next.detail === "avoid", "A skipped question is asked again, or the next one isn't asked.");
  const done = withAuthoring(fresh, { briefAsked: ["bedtime", "avoid"] });
  check(readyToDraft(done, policies, { brief: asking }), "Under 'auto' the story doesn't start after the last question.");
  const filled = applyGuidePatch(fresh, { storyIdea: { bedtime: { on: true } } }, context).project;
  const afterFill = briefStage(filled, asking);
  check(afterFill.kind === "ask" && afterFill.detail === "avoid", "A detail the parent already gave is asked anyway.");

  const written = readyBook("Once upon a time, Maya found a shell on the beach and kept it.");
  check(storyBriefWell(written, policies, { brief: wait }) === null, "The story card shows after the story exists.");
  check(offeredDetails(wait).length > 0, "The default story card offers nothing.");
}

// --- Writes, undo and overwrites ------------------------------------------------------------

{
  const base = readyBook();
  let project = base;
  for (const id of STORY_DETAIL_IDS) {
    const result = applyGuidePatch(project, { storyIdea: { [id]: sampleFor(id, project) } }, context);
    check(result.applied.includes("storyIdea"), `Writing story detail ${id} through the interpreter failed: ${JSON.stringify(result.rejected)}`);
    project = result.project;
  }
  check(filledDetails(briefOf(project.config)).length === STORY_DETAIL_IDS.length, "Some story details didn't stick after writing them all.");
  check(storyBriefSchema.safeParse(briefOf(project.config)).success, "A brief with every story detail fails the backend's brief schema.");

  const again = applyGuidePatch(project, { storyIdea: { mood: sampleFor("mood", project) } }, context);
  check(again.unchanged.includes("storyIdea") && !again.applied.includes("storyIdea"), "Restating a story detail counts as a change.");

  // Undo: the capture of the empty book, applied over the full one, is the empty book again.
  const before = captureGuideFacts(base).storyIdea ?? {
    themeId: null, customTheme: null, settingId: null, customSetting: null, occasion: null, when: null, where: null,
    mustInclude: null, deviceIds: null, customDevice: null,
    ...Object.fromEntries(STORY_DETAIL_IDS.filter((id) => STORY_DETAILS[id].inDetails).map((id) => [id, null])),
  };
  const undone = applyGuidePatch(project, { storyIdea: before }, context).project;
  check(filledDetails(briefOf(undone.config)).length === 0, `Undo left story details behind: ${filledDetails(briefOf(undone.config)).join(", ")}.`);
  const full = captureGuideFacts(project).storyIdea;
  const redone = applyGuidePatch(undone, { storyIdea: full }, context).project;
  check(
    JSON.stringify(captureGuideFacts(redone).storyIdea) === JSON.stringify(full),
    "Restoring a captured brief doesn't give the same brief back (capture → apply is not the identity).",
  );

  const refused = applyGuidePatch(base, { storyIdea: { mood: { ids: ["spooky-made-up"] } } }, context);
  check(refused.rejected.length > 0 && !refused.applied.includes("storyIdea"), "An option the band doesn't offer was written.");
  const badTheme = applyGuidePatch(base, { storyIdea: { about: { ids: ["no-such-theme"] } } }, context);
  check(!badTheme.applied.includes("storyIdea"), "A theme the band doesn't offer was written.");

  const withMood = applyGuidePatch(base, { storyIdea: { mood: { ids: ["calm"] } } }, context).project;
  const claim = (value: unknown) => ({ slot: "storyIdea" as const, value, evidence: "", confidence: 0.5 });
  check(!claimOverwritesSettledFact(withMood, claim({ avoid: { text: "monsters" } })), "Adding a new story detail is treated as overwriting one.");
  check(claimOverwritesSettledFact(withMood, claim({ mood: { ids: ["funny"] } })), "Changing a chosen mood isn't treated as an overwrite.");
  check(!claimOverwritesSettledFact(withMood, claim({ mood: { ids: ["calm"] } })), "Restating the chosen mood is treated as an overwrite.");

  const shape = guidePatchShapeLines(context, base);
  for (const id of STORY_DETAIL_IDS) check(shape.includes(`    ${id} (`), `The interpreter isn't told about story detail ${id}.`);
  const firstTheme = craftOf(base).themes[0]?.id;
  if (firstTheme) check(shape.includes(firstTheme), "The interpreter isn't shown the band's theme ids.");
}

// --- The draft sees it, and a change makes a running draft stale ---------------------------------

{
  const base = readyBook();
  const sign = (p: Project) => storyBriefSignature(briefOf(p.config), p.config.ageRangeId, p.config.readingModeId, p.config.contentLocale);
  const plain = sign(base);
  check(plain === sign(readyBook()), "The brief signature isn't stable.");
  for (const id of STORY_DETAIL_IDS) {
    const changed = applyGuidePatch(base, { storyIdea: { [id]: sampleFor(id, base) } }, context).project;
    check(sign(changed) !== plain, `Changing story detail ${id} doesn't make a running draft stale.`);
  }
  const bedtime = withStoryDetail(briefOf(base.config), "bedtime", { on: true });
  check(/BEDTIME/.test(detailPromptLines(bedtime, craftOf(base), [])), "A bedtime story isn't told to the draft prompt.");
  const avoid = withStoryDetail(briefOf(base.config), "avoid", { text: "monsters" });
  check(/monsters/.test(detailPromptLines(avoid, craftOf(base), [])), "Things to leave out aren't told to the draft prompt.");
  check(detailPromptLines(avoid, craftOf(base), ["avoid"]) === "", "A detail the template renders itself is repeated in the details block.");
}

// --- Nothing the parent says is lost: words are added, not swapped ------------------------------

{
  const base = readyBook();
  const say = (project: Project, value: Record<string, unknown>) => applyGuidePatch(project, { storyIdea: value }, context);
  const first = say(base, { include: { add: "he loves trains" } });
  check(first.applied.includes("storyIdea"), `A first leftover detail wasn't written: ${JSON.stringify(first.rejected)}`);
  const second = say(first.project, { include: { add: "Grandpa always whistles when he cooks" } });
  const kept = briefOf(second.project.config).mustInclude ?? "";
  check(
    kept.includes("he loves trains") && kept.includes("Grandpa always whistles"),
    `A second leftover detail replaced the first: "${kept}".`,
  );
  const prompt = buildStoryDraftPrompt(second.project.config, briefOf(second.project.config), null);
  const text = `${prompt.system}\n${prompt.user}`;
  check(
    text.includes("he loves trains") && text.includes("Grandpa always whistles"),
    "Two leftover details don't both reach the story prompt.",
  );
  const repeat = say(second.project, { include: { add: "grandpa always whistles when he cooks" } });
  check(repeat.unchanged.includes("storyIdea"), "Saying a kept detail again adds it twice.");
  const replaced = say(second.project, { include: { text: "a blue balloon" } });
  check(briefOf(replaced.project.config).mustInclude === "a blue balloon", "Replacing a detail in words still keeps the old words.");

  const claim = (value: unknown) => ({ slot: "storyIdea" as const, value, evidence: "", confidence: 0.5 });
  check(
    !claimOverwritesSettledFact(first.project, claim({ include: { add: "a red balloon" } })),
    "Adding to a detail is held back as if it overwrote it.",
  );
  check(
    claimOverwritesSettledFact(first.project, claim({ include: { text: "a red balloon" } })),
    "Replacing a detail's words isn't treated as an overwrite.",
  );

  const avoid = say(say(base, { avoid: { add: "monsters" } }).project, { avoid: { add: "spiders" } });
  const avoided = STORY_DETAILS.avoid.read(briefOf(avoid.project.config))?.text ?? "";
  check(avoided.includes("monsters") && avoided.includes("spiders"), `Things to leave out replace each other: "${avoided}".`);

  const long = say(first.project, { include: { add: "x".repeat(500) } });
  const long2 = say(long.project, { include: { add: "y".repeat(500) } });
  check(
    !long2.applied.includes("storyIdea") && long2.rejected.length > 0,
    "A detail too long to store is cut or written instead of asked to be shorter.",
  );
  check(storyBriefSchema.safeParse(briefOf(long.project.config)).success, "A detail at the length limit fails the backend's brief schema.");

  const rule = DEFAULT_GUIDE_COPY.briefOffer;
  check(/anything else/i.test(rule) && /\bgo\b/.test(rule), "The story card's first line doesn't invite anything else, or doesn't say go skips it.");
  const shape = guidePatchShapeLines(context, base);
  check(/"add"/.test(shape), "The interpreter isn't told it can add to a detail.");
}

// --- Reading age: asked before the story, answered by a tap or by typing --------------------------

{
  const wait = createDefaultGuideBriefConfig();
  check(policies.readingAge.whenUnsaid === "ask", "By default the reading age is no longer asked before the story.");
  const toddler = unconfirmedBook("", 3);
  const question = audienceQuestion(toddler, policies);
  check(question?.kind === "audienceConfirm", "The reading-age question isn't asked once names and ages are known.");
  check(
    question?.bandId === "3y" && question.age === 3 && question.name === "Maya",
    `A 3-year-old hero doesn't suggest the 3-year band (got ${question?.bandId}).`,
  );
  check(!factsSettled(toddler, policies), "The facts count as settled while the reading age is unanswered.");
  check(!readyToDraft(toddler, policies), "The story starts before the reading age is answered.");
  check(storyBriefWell(toddler, policies, { brief: wait }) === null, "The story card shows before the reading age is answered.");
  const intake = deriveJourney(toddler, policies, { brief: wait }).well;
  check(intake?.kind === "audienceConfirm", `The intake well isn't the reading-age question (got ${intake?.kind}).`);

  // The story is written for the first child's band, not the default one.
  check(toddler.config.ageRangeId !== "3y", "The fixture already holds the 3-year band; the linked check proves nothing.");
  check(withLinkedAudience(toddler).config.ageRangeId === "3y", "The draft isn't written for the first child's age group.");

  const kept = withFactMarks(withChosenAudience(toddler, suggestedAudience(toddler)), "answeredFacts", ["readingAge"]);
  check(kept.config.ageRangeId === "3y" && kept.config.audienceFromCast === "custom", "A yes doesn't keep the suggested band.");
  check(audienceQuestion(kept, policies) === null, "The reading-age question stays after a yes.");
  check(storyBriefWell(kept, policies, { brief: wait })?.kind === "storyBrief", "The story card doesn't follow a yes.");

  const typed = applyGuidePatch(toddler, { audience: { ageRangeId: "4-5" } }, context);
  check(typed.applied.includes("audience"), "A typed reading age isn't written.");
  check(audienceQuestion(typed.project, policies) === null, "A typed reading age doesn't answer the question.");
  check(typed.project.config.ageRangeId === "4-5", "A typed reading age doesn't change the band.");
  check(withLinkedAudience(typed.project).config.ageRangeId === "4-5", "A picked band is replaced by the first child's before the draft.");

  const line = question ? readingAgeAskLine(question) : null;
  check(line?.key === "readingAgeAsk" && line.priority === "question", "The reading-age question isn't a question line.");
  check(Boolean(question && /3y/.test(readingAgeExpectation(question))), "The interpreter isn't told which band a yes keeps.");
  const oneYear = unconfirmedBook("", 1);
  const infant: Project = {
    ...oneYear,
    config: {
      ...oneYear.config,
      storyBrief: { ...briefOf(oneYear.config), cast: [{ id: "c1", name: "Maya", ageMonths: 18 }] },
    },
  };
  const baby = audienceQuestion(infant, policies);
  check(baby !== null && baby.months && baby.age === 18, "An 18-month-old's question doesn't name the age in months.");
  check(baby ? readingAgeAskLine(baby).key === "readingAgeAskMonths" : false, "An 18-month-old is asked about in years.");
  for (const key of [
    "readingAgeAsk",
    "readingAgeAskMonths",
    "readingAgeKept",
    "readingAgeChanged",
    "readingAgeAskOwnEarly",
    "readingAgeAskOwnFromAge",
    "readingAgeAskOwnDiffer",
    "readingAgeSkipOwn",
    "readingAgeKeptOwn",
    "castAgesAsk",
  ] as const) {
    check(Boolean(DEFAULT_GUIDE_COPY[key]) && Boolean(GUIDE_COPY_HELP[key]), `Guide copy ${key} has no default or admin hint.`);
  }
  const confirmOnce = { ...policies, readingAge: { ...policies.readingAge, whenUnsaid: "confirmOnce" as const } };
  check(readyToDraft(toddler, confirmOnce), "Under 'Say it once' the story waits for a reading-age answer.");
  const enChrome = (en.guide as unknown as { chrome: Record<string, string> }).chrome;
  const deChrome = (de.guide as unknown as { chrome: Record<string, string> }).chrome;
  for (const key of ["taskAudience", "taskAges", "audienceYes", "audienceKeep", "audienceOther", "changeAudience", "useTheseAges", "bandYear", "bandYears", "bandMonths"]) {
    check(Boolean(enChrome[key] && deChrome[key]), `guide.chrome.${key} is missing in English or German.`);
  }
}

{
  const escaped = 'Neil finds a box.\\n"A train!" says Neil.\\n\\nPhoebe finds a bell.';
  const broken = 'Neil finds a box.\n"A train!" says Neil.\n\nPhoebe finds a bell.';
  check(restoreModelLineBreaks(escaped) === broken, "A generated story keeps \\n as characters instead of line breaks.");
  check(restoreModelLineBreaks(broken) === broken, "Restoring line breaks rewrites a story that already has them.");
  const beats = parseStoryBeats(escaped);
  check(beats.length === 1 && beats[0]!.text === broken, "The story editor shows \\n for a generated manuscript.");
  check(serializeStoryBeats(beats) === broken, "Opening the story writes the escape characters back.");
  check(storyMoments(escaped) === 2, "Beats separated by \\n\\n count as one moment.");

  const prose = "Maya woke up.\n\nThe frost sparkled.";
  const copied = validateStoryRevision(prose, {
    summary: "Warmer.",
    changes: [{ before: "Maya woke up.\\n\\nThe frost sparkled.", after: "Maya woke up.\\n\\nThe garden sparkled.", reason: "warmer" }],
  });
  check(
    copied.changes[0]?.after === "Maya woke up.\n\nThe garden sparkled.",
    "A revision copies \\n into the replacement.",
  );
  check(
    applyStoryRevision(prose, copied, { [copied.changes[0]!.id]: "accepted" }) === "Maya woke up.\n\nThe garden sparkled.",
    "Applying a revision leaves \\n in the story.",
  );

  const stored = "Maya woke up.\\n\\nThe frost sparkled.";
  const patched = validateStoryRevision(stored, {
    summary: "Warmer.",
    changes: [{ before: "The frost sparkled.", after: "The garden sparkled.", reason: "warmer" }],
  });
  check(
    applyStoryRevision(stored, patched, { [patched.changes[0]!.id]: "accepted" }) === "Maya woke up.\n\nThe garden sparkled.",
    "Applying a revision leaves the rest of the story's \\n in place.",
  );

  const revisionPrompt = buildStoryRevisionPrompt(createDefaultConfig(), prose, "Make the ending warmer.");
  check(!revisionPrompt.system.includes("\\n"), "The revision prompt tells the model to write \\n.");

  check(rewritesWholeStory("make the text rhymy"), "A rhyme request was treated as a small edit.");
  check(rewritesWholeStory("Make the story a bit shorter"), "Shortening the story was treated as a small edit.");
  check(!rewritesWholeStory("Make the ending warmer"), "A warmer ending rewrote the whole story.");
  check(!isEagerStoryEdit("make Maya 5"), "Setting an age was queued as a story edit.");
  check(isEagerStoryEdit("Add a scene at the beach"), "Adding a scene was not recognized as a story edit.");
  check(isEagerStoryEdit("Make this nicer", true), "A marked 'make this nicer' waited for the interpreter.");

  const mixed = assessStoryRevision(prose, {
    summary: "Two tries",
    changes: [
      { before: "Maya woke up.", after: "Maya sprang up.", reason: "energy" },
      { before: "not in the story", after: "nope", reason: "miss" },
    ],
  });
  check(
    mixed.changes.length === 1 && mixed.problems.length === 1 && mixed.changes[0]?.before === "Maya woke up.",
    "One bad replacement threw away the replacement that matched.",
  );
  let rejected = "";
  try {
    validateStoryRevision(prose, {
      summary: "Two tries",
      changes: [
        { before: "Maya woke up.", after: "Maya sprang up.", reason: "energy" },
        { before: "not in the story", after: "nope", reason: "miss" },
      ],
    });
  } catch (error) {
    rejected = (error as Error).message;
  }
  check(rejected.includes("no longer matches"), "A patch with a bad replacement was accepted whole.");

  const rewritten = proposalFromRewrite(prose, "Maya woke up.\n\nThe garden sparkled.", "Warmer.");
  check(
    applyStoryRevision(prose, rewritten, { [rewritten.changes[0]!.id]: "accepted" }).includes("garden"),
    "A rewritten manuscript did not become a reviewable change.",
  );
  const rhymed = proposalFromRewrite(
    "Maya found a red ball.",
    "Sing a song, the day is long.",
    "Rhymed.",
  );
  check(rhymed.changes.length === 1, "A near-total rewrite was split into many hunks.");
}

report.push("Story options");
report.push(
  `  ${STORY_DETAIL_IDS.length} details in ${STORY_DETAIL_GROUPS.length} groups, ` +
    `${offeredDetails(createDefaultGuideBriefConfig()).length} offered by default, start: ${createDefaultGuideBriefConfig().start}`,
);
notes.push(`Story options: ${BRIEF_STARTS.length} start policies × ${STORY_DETAIL_POLICIES.length} detail policies checked`);

export function checkGuideStory(): CheckResult {
  return { failures, notes, report, cases };
}
