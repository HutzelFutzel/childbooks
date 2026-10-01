/**
 * Before the story is written: which story details the Chat offers or asks
 * about, and when the draft starts.
 *
 * Code owns what each detail means (`storyDetails.ts`); admins own this policy
 * (`appConfig/guide.brief`). Like the fact policy there is no timer: the story
 * starts when the parent says so, or — under `auto` — on the reply that settles
 * the last question.
 */
import { z } from "zod";
import { briefOf } from "../story/brief";
import type { Project } from "../types";
import { authoringOf } from "./projectState";
import { STORY_DETAIL_IDS, STORY_DETAILS, type StoryDetailId } from "./storyDetails";

/**
 * - `off`: never offered. The parent can still say it; the guide uses it.
 * - `offer`: a choice on the story card.
 * - `ask`: on the card, and the guide asks about it once before writing.
 */
export const STORY_DETAIL_POLICIES = ["off", "offer", "ask"] as const;
export type StoryDetailPolicy = (typeof STORY_DETAIL_POLICIES)[number];

/**
 * - `wait`: after names and ages, the story card waits for "Write the story".
 * - `auto`: the story starts as soon as the asked details are answered.
 */
export const BRIEF_STARTS = ["wait", "auto"] as const;
export type BriefStart = (typeof BRIEF_STARTS)[number];

export interface GuideBriefConfig {
  start: BriefStart;
  details: Record<StoryDetailId, StoryDetailPolicy>;
}

export function createDefaultGuideBriefConfig(): GuideBriefConfig {
  return {
    start: "wait",
    details: {
      about: "offer",
      bedtime: "offer",
      moment: "offer",
      place: "offer",
      mood: "offer",
      telling: "offer",
      include: "offer",
      interests: "offer",
      avoid: "offer",
      lesson: "off",
      ending: "off",
      time: "off",
      learning: "off",
      voice: "off",
      length: "off",
    },
  };
}

const policySchema = z.enum(STORY_DETAIL_POLICIES);

export const guideBriefConfigSchema = z.object({
  start: z.enum(BRIEF_STARTS),
  details: z.object(
    Object.fromEntries(STORY_DETAIL_IDS.map((id) => [id, policySchema])) as Record<StoryDetailId, typeof policySchema>,
  ),
});

/** Field by field onto the defaults; an unknown value keeps the shipped one. */
export function normalizeGuideBriefConfig(input: unknown): GuideBriefConfig {
  const defaults = createDefaultGuideBriefConfig();
  const stored = (input && typeof input === "object" ? input : {}) as Partial<GuideBriefConfig>;
  const details = (stored.details && typeof stored.details === "object" ? stored.details : {}) as Record<string, unknown>;
  return {
    start: BRIEF_STARTS.includes(stored.start as BriefStart) ? (stored.start as BriefStart) : defaults.start,
    details: Object.fromEntries(
      STORY_DETAIL_IDS.map((id) => [
        id,
        STORY_DETAIL_POLICIES.includes(details[id] as StoryDetailPolicy)
          ? (details[id] as StoryDetailPolicy)
          : defaults.details[id],
      ]),
    ) as Record<StoryDetailId, StoryDetailPolicy>,
  };
}

/** Details shown on the story card, in catalog order. */
export function offeredDetails(config: GuideBriefConfig): StoryDetailId[] {
  return STORY_DETAIL_IDS.filter((id) => config.details[id] !== "off");
}

/** Details the guide asks about before writing, in catalog order. */
export function askedDetails(config: GuideBriefConfig): StoryDetailId[] {
  return STORY_DETAIL_IDS.filter((id) => config.details[id] === "ask");
}

export type BriefStage =
  /** The parent said to write it, or nothing holds it back under `auto`. */
  | { kind: "go" }
  /** Ask this detail now. */
  | { kind: "ask"; detail: StoryDetailId }
  /** This detail was just asked; the next reply settles it. */
  | { kind: "waiting"; detail: StoryDetailId }
  /** The story card is up, waiting for "Write the story". */
  | { kind: "review" };

/** Where the book is between "who it's for" and the draft. */
export function briefStage(project: Project, config: GuideBriefConfig): BriefStage {
  const state = authoringOf(project);
  if (state.briefStartAt) return { kind: "go" };
  const brief = briefOf(project.config);
  const open = state.briefOpen;
  if (open && open in STORY_DETAILS && STORY_DETAILS[open as StoryDetailId].read(brief) === null) {
    return { kind: "waiting", detail: open as StoryDetailId };
  }
  const asked = new Set(state.briefAsked ?? []);
  const next = askedDetails(config).find((id) => !asked.has(id) && STORY_DETAILS[id].read(brief) === null);
  if (next) return { kind: "ask", detail: next };
  return config.start === "auto" ? { kind: "go" } : { kind: "review" };
}

/** The guide's question for a detail, with the first child's name filled in. */
export function detailQuestion(id: StoryDetailId, name: string): string {
  return STORY_DETAILS[id].question.replace(/\{names\}/g, name || "them");
}

/** One sentence for the admin panel: what a parent sees with this policy. */
export function describeBriefPolicy(config: GuideBriefConfig): string {
  const offered = offeredDetails(config).length;
  const asked = askedDetails(config).map((id) => STORY_DETAILS[id].label.toLowerCase());
  const askPart = asked.length > 0 ? ` Before writing, the guide asks about ${asked.join(", ")}.` : "";
  const start =
    config.start === "wait"
      ? `After names and ages, parents see a story card with ${offered} optional choice${offered === 1 ? "" : "s"} and a Write the story button. Nothing is written until they tap it or say so.`
      : offered > 0 || asked.length > 0
        ? `The story is written as soon as the guide knows who it's for${asked.length > 0 ? " and has asked its questions" : ""}. Parents can still mention any detail in their message.`
        : "The story is written as soon as the guide knows who it's for.";
  return `${start}${askPart}`;
}
