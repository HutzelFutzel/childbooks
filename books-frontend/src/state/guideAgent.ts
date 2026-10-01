/**
 * The Chat's skill adapter: the one place a plan touches the book or the network.
 *
 * `core/guide/agent/plan.ts` decides what a message does; this carries it out.
 * Writes re-run each skill against the book as it is at write time (the same
 * rule as the fact patch in `guideTurn.ts`), so a render landing mid-turn is
 * never rolled back. Effects run after the writes are saved, in order. What the
 * book looked like before is captured for undo, and the reader sees one message
 * phrased in the persona (`composeUtterance`) with the configured wording as the
 * fallback whenever the composer is off, slow or breaks a rule.
 */
"use client";

import { resolveAudienceProfile } from "../core/config/audience";
import { dimensionDef } from "../core/config/audienceCatalog";
import { storyTextHash } from "../core/story/revision";
import { selectionForMark, type StoryMark } from "../core/story/storyMark";
import type { StoryFitCard } from "../core/guide/session";
import { resolveArtStyles } from "../core/config/artStyles";
import { BOOK_LANGUAGES, getBookLanguage } from "../core/config/bookLanguages";
import type { GuideAgentConfig } from "../core/config/guideAgent";
import { guideCopy, type GuideCopyOverrides } from "../core/guide/copy";
import { validateComposed } from "../core/guide/agent/compose";
import { addedPeople, personFollowUp } from "../core/guide/agent/followUps";
import { presentBeats, type Utterance } from "../core/guide/agent/present";
import { confirmStillValid, planTurn, type PendingConfirm, type Plan } from "../core/guide/agent/plan";
import { GUIDE_COMMANDS } from "../core/guide/agent/registry";
import { RESTORE_FIELDS, snapshotJson } from "../core/guide/agent/restore";
import { beat, withPersonAsk } from "../core/guide/agent/commands/shared";
import type {
  AskOption,
  Beat,
  CommandArgs,
  CommandCall,
  CommandContext,
  CommandEffect,
  Remedy,
} from "../core/guide/agent/types";
import type { BookViewId } from "../core/guide/journey";
import type { GuideTarget } from "../core/guide/target";
import type { RedrawMode } from "../core/guide/redrawMode";
import { castOf } from "../core/guide/agent/resolve";
import type { GuideEntry, Project } from "../core/types";
import { deleteLikenessPhoto } from "../platform/likeness";
import { guideComposeRemote, storyFitRemote } from "../platform/aiClient";
import { startStoryRevision } from "../platform/storyRevisions";
import { confirmCoverWords, setAuthor, setSubtitle, setTitle, stepPicture, updateCastMember } from "../ui/guide/bookActions";
import { useGuidePreference } from "../ui/guide/guidePreference";
import { useAppConfigStore } from "./appConfigStore";
import { useAuthStore } from "./authStore";
import { useProjectsStore } from "./projectsStore";

/** What the composer well shows because the reader asked for it. */
export type AgentWell =
  | { kind: "agentConfirm"; confirm: PendingConfirm }
  | { kind: "agentAsk"; call: CommandCall; arg: string; options: AskOption[] }
  | { kind: "agentBlocked"; remedy: Remedy }
  | { kind: "sparksOffer" }
  | { kind: "agentSignIn" }
  | { kind: "agentPortraits"; castIds: string[]; names: string[] }
  | { kind: "agentDrawBook" };

/** A question the guide asked, so the next short reply ("5", "skip") finds its skill. */
export interface AgentPending {
  /** For the interpreter: "setPersonAge for Christopher". */
  expects: string;
  person?: { id: string; fields: string[] };
}

export interface AgentTurn {
  beats: Beat[];
  well: AgentWell | null;
  view: BookViewId | null;
  /** JSON of the top-level book fields before this turn's writes; null when nothing was written. */
  restore: string | null;
  pending: AgentPending | null;
  redraw: { castId: string; name: string; instruction: string; mode?: RedrawMode } | null;
  entry: GuideEntry | null;
  undo: boolean;
  skip: boolean;
  /** The turn asked, confirmed or blocked: the journey's own next question waits. */
  holdsFloor: boolean;
  wrote: boolean;
}

function live(): Project | null {
  return useProjectsStore.getState().current();
}

export function agentConfig(): GuideAgentConfig {
  return useAppConfigStore.getState().guide.agent;
}

function wording(): GuideCopyOverrides {
  return useAppConfigStore.getState().guide.wording;
}

export function agentContext(): CommandContext {
  const { artStyles } = useAppConfigStore.getState();
  return {
    now: Date.now(),
    guest: useAuthStore.getState().accessLevel === "guest",
    styles: resolveArtStyles(artStyles).map((style) => ({ id: style.id, label: style.label })),
    languages: BOOK_LANGUAGES.flatMap((language) => [
      { id: language.id, label: language.englishName },
      { id: language.id, label: language.endonym },
    ]),
  };
}

/** The top-level book fields undo puts back, as JSON. */
export function snapshot(project: Project): string {
  return snapshotJson(project);
}

/** The well id a skill's well shows under (`GuideMessage.well`); paid steps share the journey's own. */
export function agentWellTopic(well: AgentWell): string {
  switch (well.kind) {
    case "agentConfirm":
      return `confirm:${well.confirm.hash}`;
    case "agentAsk":
      return `ask:${well.call.id}:${well.arg}`;
    case "agentBlocked":
      return `blocked:${well.remedy.requirement}`;
    case "agentPortraits":
      return "portraits";
    case "agentDrawBook":
      return "drawBook";
    case "agentSignIn":
      return "account";
    case "sparksOffer":
      return "sparksOffer";
  }
}

/** Put back the fields a skill turn changed. Fields that did not exist come back as absent. */
export function applyRestore(project: Project, restore: string): Project {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(restore) as Record<string, unknown>;
  } catch {
    return project;
  }
  const next = { ...project } as unknown as Record<string, unknown>;
  for (const key of RESTORE_FIELDS) {
    if (!(key in saved)) continue;
    if (saved[key] === null) delete next[key];
    else next[key] = saved[key];
  }
  return next as unknown as Project;
}

function writeCalls(plan: Plan): CommandCall[] {
  return plan.steps.filter((step) => step.result.kind === "write").map((step) => step.call);
}

const FIT_HEADLINE: Record<StoryFitCard["verdict"], string> = {
  good: "It reads well for that age.",
  minor: "It fits that age, with a thought or two.",
  mismatch: "It reads a little differently for that age.",
};

/** The story check's answer as the thread's card: trusted structure, the checker's own words. */
function fitCardFor(project: Project, fit: Awaited<ReturnType<typeof storyFitRemote>>): StoryFitCard {
  const { audience, ageWriting, storyCraft } = useAppConfigStore.getState();
  const profile = resolveAudienceProfile(project.config.ageRangeId, { audience, ageWriting, storyCraft });
  const notes = (fit.notes ?? []).map((note) => note.trim()).filter(Boolean).slice(0, 3);
  const headline = fit.headline?.trim() || notes[0] || FIT_HEADLINE[fit.verdict];
  return {
    verdict: fit.verdict,
    headline: headline.slice(0, 400),
    notes: fit.headline?.trim() ? notes : notes.slice(1),
    dimensions: (fit.dimensions ?? [])
      .filter((d) => d.fit !== "typical")
      .map((d) => ({ label: dimensionDef(d.id)?.label ?? d.id, fit: d.fit === "lighter" ? ("lighter" as const) : ("richer" as const) })),
    band: profile.label,
    textHash: storyTextHash(project.config.storyText),
  };
}

async function runEffect(effect: CommandEffect, turn: AgentTurn, mark: StoryMark | null): Promise<void> {
  switch (effect.kind) {
    case "title":
      await setTitle(effect.title);
      return;
    case "subtitle":
      await setSubtitle(effect.subtitle);
      return;
    case "author":
      await setAuthor(effect.author);
      return;
    case "coverWords":
      await confirmCoverWords();
      return;
    case "coverText":
      if (effect.title !== undefined) await setTitle(effect.title);
      if (effect.subtitle !== undefined) await setSubtitle(effect.subtitle);
      return;
    case "storyDone": {
      const { useChatStudio } = await import("./chatStudio");
      await useChatStudio.getState().finishManuscript();
      turn.view = "story";
      return;
    }
    case "reviseStory": {
      const project = live();
      if (!project) return;
      // A marked passage limits the change to exactly that span. If the story is
      // no longer the one it was marked in, say so and do nothing: the request
      // must never fall back to reworking the whole story.
      const selection = effect.scoped ? (mark ? selectionForMark(mark, project.config.storyText) : null) : undefined;
      if (effect.scoped && !selection) {
        turn.beats = turn.beats.filter((b) => b.key !== "storyRevising");
        turn.beats.push(beat("markStale", undefined, { priority: "answer" }));
        turn.view = "story";
        return;
      }
      await startStoryRevision(project, effect.instruction, selection ?? undefined);
      turn.view = "story";
      return;
    }
    case "draftStory": {
      const { useChatStudio } = await import("./chatStudio");
      const project = live();
      // Before the first draft this is the go-ahead; the turn's end starts the story.
      if (project && !project.config.storyText.trim()) await useChatStudio.getState().markStoryStart();
      else void useChatStudio.getState().retryStory();
      turn.view = "story";
      return;
    }
    case "checkStory": {
      const project = live();
      if (!project) return;
      // Awaited: the composer shows the guide working, and the answer is one
      // message with its card, said when the turn ends.
      try {
        const card = fitCardFor(project, await storyFitRemote(project));
        turn.beats.push(beat("storyFit", { what: card.headline }, { priority: "answer", fit: card }));
        turn.view = "story";
      } catch {
        turn.beats.push(beat("answerFallback", undefined, { priority: "answer" }));
      }
      return;
    }
    case "portraits": {
      const project = live();
      if (!project) return;
      const names = castOf(project)
        .filter((m) => effect.castIds.includes(m.id))
        .map((m) => m.name.trim());
      turn.view = "cast";
      // A named person is a clear request: start when it is cheap and affordable,
      // otherwise the priced button (or the top-up) takes over and says why.
      const { autoStartNamedPortraits } = await import("./typedPictures");
      const outcome = await autoStartNamedPortraits(effect.castIds);
      turn.beats = turn.beats.filter((b) => b.key !== "quoteReady");
      if (outcome === "started") {
        turn.beats.push(beat("portraitsStarting", { names }, { priority: "result" }));
        return;
      }
      turn.beats.push(
        outcome === "needsSparks"
          ? beat("portraitsNeedSparks", { names }, { priority: "result" })
          : beat("quoteReady"),
      );
      turn.well = { kind: "agentPortraits", castIds: effect.castIds, names };
      return;
    }
    case "redraw":
      turn.redraw = {
        castId: effect.castId,
        name: effect.name,
        instruction: effect.instruction,
        ...(effect.mode ? { mode: effect.mode } : {}),
      };
      return;
    case "drawBook":
      turn.well = { kind: "agentDrawBook" };
      return;
    case "sparks":
      turn.well = { kind: "sparksOffer" };
      return;
    case "signIn":
      turn.well = { kind: "agentSignIn" };
      return;
    case "view":
      turn.view = effect.view;
      return;
    case "entry":
      turn.entry = effect.entry;
      return;
    case "undo":
      turn.undo = true;
      return;
    case "picture":
      if (!(await stepPicture(effect.target, effect.delta))) {
        turn.beats = turn.beats.filter((b) => b.key !== "pictureBack");
        turn.beats.push(beat("noEarlierPicture"));
      }
      turn.view = effect.target.kind === "person" ? "cast" : "pages";
      return;
    case "skip":
      turn.skip = true;
      return;
    case "deletePhoto": {
      const project = live();
      const member = project ? castOf(project).find((m) => m.id === effect.castId) : null;
      if (!project || !member?.likenessPhoto) return;
      await deleteLikenessPhoto({ projectId: project.id, subjectId: member.id }).catch(() => {});
      await updateCastMember(member.id, { likenessPhoto: undefined, moreLikenessPhotos: undefined });
      return;
    }
  }
}

/**
 * Plan and carry out one message's skill calls. `later` receives beats that
 * arrive after the turn, to be said as their own message. No skill needs it
 * today: the story check is awaited so its card is part of the turn's message.
 */
export async function executeAgentCalls(
  calls: readonly CommandCall[],
  options: {
    overflow?: readonly CommandCall[];
    confirmed?: boolean;
    later: (beats: Beat[]) => void;
    /**
     * The passage the reader marked for this message, taken when they sent it.
     * Passed in rather than read from the store: the turn outlives the click,
     * and a mark made while it runs belongs to the next message.
     */
    mark?: StoryMark | null;
    /** The picture the reader had selected when they sent the message. */
    chip?: GuideTarget | null;
  },
): Promise<AgentTurn> {
  const turn: AgentTurn = {
    beats: [],
    well: null,
    view: null,
    restore: null,
    pending: null,
    redraw: null,
    entry: null,
    undo: false,
    skip: false,
    holdsFloor: false,
    wrote: false,
  };
  const project = live();
  if (!project) return turn;
  const config = agentConfig();
  const mark = options.mark ?? null;
  const ctx: CommandContext = {
    ...agentContext(),
    ...(mark ? { marked: true } : {}),
    ...(options.chip ? { chip: options.chip } : {}),
  };
  const plan = planTurn({ project, calls, ctx, config, overflow: options.overflow, confirmed: options.confirmed });
  turn.beats.push(...plan.beats);
  turn.view = plan.views[plan.views.length - 1] ?? null;

  const writes = writeCalls(plan);
  if (writes.length > 0) {
    let before: string | null = null;
    await useProjectsStore.getState().patchCurrent((latest) => {
      before = snapshot(latest);
      const writeCtx = { ...ctx, now: Date.now() };
      let next = latest;
      for (const call of writes) {
        const result = GUIDE_COMMANDS[call.id].run(next, call.args, writeCtx);
        if (result.kind === "write") next = result.project;
      }
      return next;
    });
    turn.restore = before;
    turn.wrote = true;
  }

  for (const effect of plan.effects) await runEffect(effect, turn, mark);

  if (plan.confirm) turn.well = { kind: "agentConfirm", confirm: plan.confirm };
  else if (plan.ask) turn.well = { kind: "agentAsk", call: plan.ask.call, arg: plan.ask.arg, options: plan.ask.options };
  else if (plan.blocked.length > 0 && !turn.well) turn.well = { kind: "agentBlocked", remedy: plan.blocked[0]!.remedy };

  if (plan.ask) {
    turn.pending = { expects: `${plan.ask.call.id} (${plan.ask.arg}) with ${JSON.stringify(plan.ask.call.args)}` };
  }
  turn.holdsFloor = Boolean(plan.confirm || plan.ask || plan.blocked.length > 0);

  // One follow-up for the people this turn added, read from the saved book.
  const after = live();
  if (after && !turn.holdsFloor) {
    const follow = personFollowUp(after, config.people, addedPeople(project, after));
    if (follow) {
      turn.beats.push(follow.beat);
      turn.pending = { expects: follow.expects, ...(follow.ask ? { person: { id: follow.ask.personId, fields: follow.ask.fields } } : {}) };
      turn.holdsFloor = true;
      if (follow.ask) {
        const { personId, fields } = follow.ask;
        await useProjectsStore.getState().patchCurrent((latest) =>
          fields.reduce((p, field) => withPersonAsk(p, personId, field), latest),
        );
      }
    }
  }
  return turn;
}

/** Re-check and run a confirmation card's calls. Returns null when it went stale. */
export async function confirmAgentCalls(
  pending: PendingConfirm,
  choice: CommandArgs | null,
  later: (beats: Beat[]) => void,
): Promise<AgentTurn | null> {
  const project = live();
  if (!project || !confirmStillValid(pending, project, agentContext())) return null;
  const calls = pending.calls.map((call) => ({ ...call, args: { ...call.args, ...(choice ?? {}) }, source: "tap" as const }));
  return executeAgentCalls(calls, { confirmed: true, later });
}

/** Mark the open per-person question as skipped, so it is never asked again. */
export async function skipPersonAsk(pending: AgentPending | null): Promise<boolean> {
  const person = pending?.person;
  if (!person) return false;
  await useProjectsStore.getState().patchCurrent((latest) =>
    person.fields.reduce((p, field) => withPersonAsk(p, person.id, field, true), latest),
  );
  return true;
}

// --- Speech -------------------------------------------------------------------------

export function utteranceFor(beats: readonly Beat[]): Utterance | null {
  return presentBeats(beats, wording(), 3);
}

/**
 * Phrase an utterance in the persona. Resolves to the configured meaning when
 * the composer is off, slower than its budget, fails, or breaks a rule.
 */
export async function composeUtterance(
  utterance: Utterance,
  args: { projectId: string; locale: string; transcript: string },
): Promise<{ text: string; composed: boolean }> {
  const config = agentConfig();
  const fallback = { text: utterance.meaning, composed: false };
  if (!config.enabled || !config.composer.enabled || !config.persona.enabled) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.composer.budgetMs);
  try {
    const language = `${getBookLanguage(args.locale).endonym} (${args.locale})`;
    const { text } = await guideComposeRemote(
      {
        projectId: args.projectId,
        language,
        locale: args.locale,
        names: utterance.names,
        meanings: utterance.meanings,
        transcript: args.transcript,
        guidePreference: useGuidePreference.getState().preference,
      },
      controller.signal,
    );
    const problems = validateComposed(text, {
      meaning: utterance.meaning,
      mustSay: [...utterance.mustSay, ...utterance.names],
      question: utterance.question,
      style: config.style.lines,
      persona: config.persona,
      locale: args.locale,
      kind: "line",
    });
    return problems.length === 0 ? { text: text.trim(), composed: true } : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export function configuredLine(key: Parameters<typeof guideCopy>[1]): string {
  return guideCopy(wording(), key);
}
