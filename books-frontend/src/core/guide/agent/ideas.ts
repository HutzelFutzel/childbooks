/**
 * Suggestions: what the chat can do next, for this book, right now.
 *
 * Nothing is listed here by hand. Every skill declares its own suggestions
 * (`CommandDef.suggest`, or `false` on purpose), so adding, changing or turning
 * off a skill changes what is suggested with no second list to keep in step.
 * A suggestion shows only while its skill is on and its requirements are met,
 * so it never leads to "that needs something first". Its text is localized
 * (`guide.ideas.<id>`), and the invariants fail when a suggestion has none.
 *
 * The open tab decides what shows. A skill's `area` says which tab it belongs
 * to (people on Characters, style on Look, and so on), and a suggestion shows
 * on its own tab; the few that name no tab show everywhere. The menu beside
 * the composer lists the rest under "elsewhere". A tap on an `instant`
 * suggestion runs it, because its result is reviewed or advisory anyway; any
 * other tap fills the composer so the reader can finish the sentence.
 *
 * One suggestion leads when the book has a next step: the first thing
 * `drawBook` is still waiting on, followed through the remedy chain to a skill
 * that can run now, or an advisory offer a skill makes itself (such as reading
 * a story nobody has checked). It is shown once per state of the book and can
 * be set aside.
 */
import type { GuideAgentConfig } from "../../config/guideAgent";
import { isSkillEnabled } from "../../config/guideAgent";
import type { Project } from "../../types";
import type { BookViewId } from "../journey";
import { authoringOf } from "../projectState";
import { portraitStatus } from "../portrait";
import type { GuideMessage } from "../session";
import { GUIDE_COMMAND_IDS, type GuideCommandId } from "./ids";
import { GUIDE_COMMANDS } from "./registry";
import { firstUnmet } from "./requirements";
import { castOf } from "./resolve";
import { whenStory } from "./commands/relevance";
import { GUIDE_IDEA_GROUPS, type CommandArea, type CommandIdea, type GuideIdeaGroup } from "./types";

export { GUIDE_IDEA_GROUPS };
export type { GuideIdeaGroup };

/** The id of a suggestion, which is also the key of its text in `guide.ideas`. */
export type GuideIdeaId = string;

export interface GuideIdea {
  id: GuideIdeaId;
  /** The skill this demonstrates; null for questions. */
  command: GuideCommandId | null;
  group: GuideIdeaGroup;
  vars?: { name?: string };
  /** A tap runs it, instead of filling the composer. */
  instant?: boolean;
  /** Acts on the marked passage, so it must never run without one. */
  marked?: boolean;
  /** The one thing the book suggests right now, led by the chips. */
  next?: boolean;
  /** Set with `next`: what to record so setting the offer aside lasts for this state only. */
  dismissKey?: string;
  /** Belongs to another tab: only the menu lists it. */
  elsewhere?: boolean;
}

/** Where each area of skills lives. An empty list is every tab. */
const AREA_VIEWS: Record<CommandArea, readonly BookViewId[]> = {
  path: [],
  book: ["pages"],
  story: ["story"],
  people: ["cast"],
  places: ["cast"],
  style: ["style"],
  generation: [],
  account: [],
  conversation: [],
};

const AREA_GROUPS: Record<CommandArea, GuideIdeaGroup> = {
  path: "help",
  book: "book",
  story: "story",
  people: "people",
  places: "people",
  style: "book",
  generation: "book",
  account: "help",
  conversation: "help",
};

interface IdeaSource extends CommandIdea {
  command: GuideCommandId | null;
  group: GuideIdeaGroup;
  views: readonly BookViewId[];
  /** The tabs its skill's area belongs to: a suggestion on a tab it merely visits comes after these. */
  home: readonly BookViewId[];
}

/** Questions the guide answers, which no skill covers. */
const ANSWER_IDEAS: readonly CommandIdea[] = [
  { id: "storyHelp", group: "help", views: ["story"], instant: true, relevant: whenStory },
  { id: "whatHappensNext", group: "help", views: [], instant: true, duringDrawing: true },
  {
    id: "whatAreSparks",
    group: "help",
    views: ["cast"],
    relevant: (p) => (castOf(p).length > 0 && castOf(p).every((m) => portraitStatus(p, m.id) === "none") ? {} : null),
  },
];

function buildSources(): IdeaSource[] {
  const out: IdeaSource[] = [];
  for (const id of GUIDE_COMMAND_IDS) {
    const def = GUIDE_COMMANDS[id];
    if (!def || def.suggest === false) continue;
    for (const idea of def.suggest) {
      out.push({
        ...idea,
        command: id,
        group: idea.group ?? AREA_GROUPS[def.area],
        views: idea.views ?? AREA_VIEWS[def.area],
        home: AREA_VIEWS[def.area],
      });
    }
  }
  for (const idea of ANSWER_IDEAS) {
    const views = idea.views ?? [];
    out.push({ ...idea, command: null, group: idea.group ?? "help", views, home: views });
  }
  return out;
}

const SOURCES: readonly IdeaSource[] = buildSources();

/** Every suggestion the app can make, for the admin list and the invariants. */
export const GUIDE_IDEA_IDS: readonly GuideIdeaId[] = SOURCES.map((source) => source.id);

interface IdeaContext {
  guest: boolean;
  view?: BookViewId | null;
  marked?: boolean;
}

interface Eligible {
  idea: GuideIdea;
  source: IdeaSource;
  /** Belongs to the open tab by name, not only because it names none. */
  onTab: boolean;
}

/** Every suggestion that applies to this book right now, the open tab's first. */
function eligibleIdeas(
  project: Project,
  config: GuideAgentConfig,
  ctx: IdeaContext,
  options: { used?: Readonly<Record<string, number>>; elsewhere?: boolean } = {},
): Eligible[] {
  if (!config.enabled || !config.ideas.enabled) return [];
  // Once the pages have started almost nothing can change; only what is still worth saying shows.
  const locked = Boolean(authoringOf(project).lockedAt);
  const view = ctx.view ?? null;
  const marked = ctx.marked === true && view === "story";
  // A marked passage narrows the suggestions to what can be done to it; without
  // one, suggestions about a marked passage have nothing to act on and stay hidden.
  const pool = SOURCES.filter(
    (source) => Boolean(source.marked) === marked && (!locked || source.duringDrawing === true),
  );
  const named = (source: IdeaSource) => view !== null && source.views.includes(view);
  const native = (source: IdeaSource) => view !== null && source.home.includes(view);
  const here = (source: IdeaSource) => view === null || source.views.length === 0 || source.views.includes(view);
  // The open tab's suggestions lead, then what the reader has tried least. The
  // sort is stable, so within a group the skills' own order holds.
  const ordered = pool
    .filter((source) => here(source) || options.elsewhere)
    .sort(
      (a, b) =>
        Number(named(b)) - Number(named(a)) ||
        Number(native(b)) - Number(native(a)) ||
        Number(here(b)) - Number(here(a)) ||
        (options.used?.[a.id] ?? 0) - (options.used?.[b.id] ?? 0) ||
        GUIDE_IDEA_GROUPS.indexOf(a.group) - GUIDE_IDEA_GROUPS.indexOf(b.group),
    );
  const out: Eligible[] = [];
  for (const source of ordered) {
    if (config.ideas.disabled.includes(source.id)) continue;
    if (source.command) {
      if (!isSkillEnabled(config, source.command)) continue;
      if (firstUnmet(project, GUIDE_COMMANDS[source.command].requires, ctx)) continue;
    } else if (!config.answers.enabled) {
      continue;
    }
    const vars = source.relevant ? source.relevant(project) : {};
    if (!vars) continue;
    out.push({
      source,
      onTab: named(source),
      idea: {
        id: source.id,
        command: source.command,
        group: source.group,
        ...(vars.name ? { vars } : {}),
        ...(source.instant ? { instant: true } : {}),
        ...(source.marked ? { marked: true } : {}),
        ...(here(source) ? {} : { elsewhere: true }),
      },
    });
  }
  return out;
}

/** The key that records an offer was set aside for this state of this book. */
export function offerKey(projectId: string, idea: GuideIdeaId, state: string): string {
  return `${projectId}:${idea}:${state}`;
}

/**
 * The skill that can run now and moves the book toward being drawn: what
 * `drawBook` still waits on, followed through each skill's own remedy until one
 * has nothing missing. Null when the next step is a card, not a skill.
 */
function stepTowardDrawing(project: Project, guest: boolean): { command: GuideCommandId; state: string } | null {
  const goal = GUIDE_COMMANDS.drawBook;
  const unmet = firstUnmet(project, goal.requires, { guest });
  if (!unmet) return { command: "drawBook", state: "ready" };
  let current: { command?: GuideCommandId; requirement: string } = unmet;
  for (let depth = 0; depth < 5 && current.command; depth += 1) {
    const next = firstUnmet(project, GUIDE_COMMANDS[current.command].requires, { guest });
    if (!next) return { command: current.command, state: current.requirement };
    current = next;
  }
  return null;
}

function leadingOffer(
  project: Project,
  ctx: IdeaContext,
  all: readonly Eligible[],
  messages: readonly GuideMessage[],
  dismissed: readonly string[],
): { entry: Eligible; key: string } | null {
  if (!ctx.view) return null;
  const open = (entry: Eligible, state: string) => {
    const key = offerKey(project.id, entry.idea.id, state);
    return dismissed.includes(key) ? null : key;
  };
  // A skill that asks to be offered (the story nobody has read yet) goes first.
  for (const entry of all) {
    if (!entry.onTab || !entry.source.offer) continue;
    const state = entry.source.offer(project, messages);
    const key = state ? open(entry, state) : null;
    if (key) return { entry, key };
  }
  const step = stepTowardDrawing(project, ctx.guest);
  if (!step) return null;
  const entry = all.find((candidate) => candidate.onTab && candidate.source.lead && candidate.source.command === step.command);
  const key = entry ? open(entry, `step:${step.state}`) : null;
  return entry && key ? { entry, key } : null;
}

/**
 * The few chips under the composer. The book's next step, if it has one, takes
 * the first place, inside the admin's maximum. `used` counts what the reader
 * has already tried, so a chip they know gives way to one they don't.
 */
export function suggestionsFor(
  project: Project,
  config: GuideAgentConfig,
  ctx: IdeaContext & {
    messages?: readonly GuideMessage[];
    dismissed?: readonly string[];
    used?: Readonly<Record<string, number>>;
  },
): GuideIdea[] {
  const all = eligibleIdeas(project, config, ctx, { used: ctx.used });
  const marked = ctx.marked === true && ctx.view === "story";
  const offer = marked ? null : leadingOffer(project, ctx, all, ctx.messages ?? [], ctx.dismissed ?? []);
  const rest = all.filter((entry) => entry !== offer?.entry).map((entry) => entry.idea);
  const list = offer ? [{ ...offer.entry.idea, next: true, dismissKey: offer.key }, ...rest] : rest;
  return list.slice(0, config.ideas.max);
}

export interface IdeaMenuGroup {
  group: GuideIdeaGroup;
  /** These belong to another tab. */
  elsewhere: boolean;
  ideas: GuideIdea[];
}

/**
 * Everything the chat can be asked to do, in groups: the menu next to the
 * composer. The open tab's come first and the other tabs' follow, so no skill
 * depends on the reader having met it at the right moment. Suggestions about a
 * marked passage are not here, since they need a mark; the menu tells the
 * reader how to make one instead.
 */
export function ideaMenuFor(project: Project, config: GuideAgentConfig, ctx: IdeaContext): IdeaMenuGroup[] {
  const all = eligibleIdeas(project, config, { ...ctx, marked: false }, { elsewhere: true });
  const groups: IdeaMenuGroup[] = [];
  for (const { idea } of all) {
    const elsewhere = idea.elsewhere === true;
    let entry = groups.find((candidate) => candidate.group === idea.group && candidate.elsewhere === elsewhere);
    if (!entry) {
      entry = { group: idea.group, elsewhere, ideas: [] };
      groups.push(entry);
    }
    entry.ideas.push(idea);
  }
  return groups.sort((a, b) => Number(a.elsewhere) - Number(b.elsewhere));
}
