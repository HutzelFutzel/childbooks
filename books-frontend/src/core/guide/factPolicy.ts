/**
 * Which facts the Chat collects, and what happens when the reader didn't say one.
 *
 * Code owns the list and how each fact is read off the book; admins own the
 * policy (`appConfig/guide.facts`). There is deliberately no timer anywhere in
 * here: the story starts on the patch that resolves the last open item, never on
 * silence.
 */
import { z } from "zod";
import { audienceSourceCharacter, briefOf, namedCast, namedHeroes } from "../story/brief";
import type { Project } from "../types";
import { GUIDE_SLOTS, type GuideSlotId } from "./slots";
import { authoringOf } from "./projectState";

export const GUIDE_FACT_IDS = ["names", "ages", "idea", "readingAge", "language"] as const;
export type GuideFactId = (typeof GUIDE_FACT_IDS)[number];

/**
 * - `use`: save the derived value and move on.
 * - `confirmOnce`: say the derived value once; continuing accepts it.
 * - `never`: leave the fact empty unless the reader said it.
 */
export const GUIDE_FACT_UNSAID = ["use", "confirmOnce", "never"] as const;
export type GuideFactUnsaid = (typeof GUIDE_FACT_UNSAID)[number];

export interface GuideFactPolicy {
  required: boolean;
  /** May be asked inside "Who is it for, and what should happen?". */
  askInBroad: boolean;
  whenUnsaid: GuideFactUnsaid;
}

export type GuideFactPolicies = Record<GuideFactId, GuideFactPolicy>;

export interface GuideFactInfo {
  id: GuideFactId;
  label: string;
  help: string;
  slot: GuideSlotId;
  /** Whether the fact has a value on the book right now. */
  has: (project: Project) => boolean;
  /** Whether a value can be derived when unsaid (a default exists). */
  derivable: boolean;
}

export const GUIDE_FACTS: Record<GuideFactId, GuideFactInfo> = {
  names: {
    id: "names",
    label: "Who it's for",
    help: "The names of the children the book is about.",
    slot: "heroes",
    has: (p) => namedHeroes(briefOf(p.config)).length > 0,
    derivable: false,
  },
  ages: {
    id: "ages",
    label: "Ages",
    help: "How old each named child is. The first child's age sets the reading age.",
    slot: "heroAges",
    has: (p) => {
      const cast = namedCast(briefOf(p.config));
      return cast.length > 0 && cast.every((m) => m.age !== undefined || m.ageMonths !== undefined);
    },
    derivable: false,
  },
  idea: {
    id: "idea",
    label: "What should happen",
    help: "A theme, occasion or place. Invented from the other facts when unsaid.",
    slot: "storyIdea",
    has: (p) => GUIDE_SLOTS.storyIdea.describe(p) !== null,
    derivable: true,
  },
  readingAge: {
    id: "readingAge",
    label: "Reading age",
    help: "Taken from the first child's age.",
    slot: "audience",
    has: (p) =>
      p.config.audienceFromCast === "custom" ||
      Boolean(audienceSourceCharacter(briefOf(p.config).cast)),
    derivable: true,
  },
  language: {
    id: "language",
    label: "Book language",
    help: "The chat language, unless the reader asks for another.",
    slot: "language",
    has: (p) => Boolean(p.config.contentLocale),
    derivable: true,
  },
};

export function createDefaultGuideFactPolicies(): GuideFactPolicies {
  return {
    names: { required: true, askInBroad: true, whenUnsaid: "never" },
    ages: { required: true, askInBroad: true, whenUnsaid: "never" },
    idea: { required: false, askInBroad: true, whenUnsaid: "use" },
    readingAge: { required: true, askInBroad: false, whenUnsaid: "confirmOnce" },
    language: { required: true, askInBroad: false, whenUnsaid: "use" },
  };
}

const policySchema = z.object({
  required: z.boolean(),
  askInBroad: z.boolean(),
  whenUnsaid: z.enum(GUIDE_FACT_UNSAID),
});

export const guideFactPoliciesSchema = z.object(
  Object.fromEntries(GUIDE_FACT_IDS.map((id) => [id, policySchema])) as Record<
    GuideFactId,
    typeof policySchema
  >,
);

/** Field by field onto the defaults; names are always required and always asked. */
export function normalizeGuideFactPolicies(input: unknown): GuideFactPolicies {
  const defaults = createDefaultGuideFactPolicies();
  const stored = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = {} as GuideFactPolicies;
  for (const id of GUIDE_FACT_IDS) {
    const raw = (stored[id] ?? {}) as Partial<GuideFactPolicy>;
    const base = defaults[id];
    out[id] = {
      required: typeof raw.required === "boolean" ? raw.required : base.required,
      askInBroad: typeof raw.askInBroad === "boolean" ? raw.askInBroad : base.askInBroad,
      whenUnsaid: GUIDE_FACT_UNSAID.includes(raw.whenUnsaid as GuideFactUnsaid)
        ? (raw.whenUnsaid as GuideFactUnsaid)
        : base.whenUnsaid,
    };
  }
  // Nothing can be drawn for nobody: the story needs someone to be about.
  out.names = { ...out.names, required: true };
  return out;
}

export type GuideFactState =
  | "filled"
  /** Derived and saved without a word (`use`). */
  | "derived"
  /** Derived; the guide still has to say it once (`confirmOnce`, not yet said). */
  | "toConfirm"
  /** Required, no value, nothing to derive from: the guide must ask. */
  | "missing"
  /** Optional and unsaid under `never`, or skipped. Holds nothing back. */
  | "empty";

/** Where one fact stands on this book under this policy. */
export function guideFactState(
  project: Project,
  id: GuideFactId,
  policies: GuideFactPolicies,
): GuideFactState {
  const info = GUIDE_FACTS[id];
  const policy = policies[id];
  const state = authoringOf(project);
  if (state.skippedFacts?.includes(id)) return "empty";
  const has = info.has(project);
  if (has && !info.derivable) return "filled";
  if (has) {
    // A derivable fact always "has" its default. Whether the reader heard it is
    // what confirm-once tracks.
    if (policy.whenUnsaid === "confirmOnce" && !state.saidFacts?.includes(id)) return "toConfirm";
    if (policy.whenUnsaid === "never" && !stated(project, id)) return policy.required ? "missing" : "empty";
    return has && stated(project, id) ? "filled" : "derived";
  }
  if (info.derivable && policy.whenUnsaid !== "never") return "derived";
  return policy.required ? "missing" : "empty";
}

/** Whether the reader stated a derivable fact themselves rather than inheriting a default. */
function stated(project: Project, id: GuideFactId): boolean {
  switch (id) {
    case "readingAge":
      return project.config.audienceFromCast === "custom";
    case "idea":
      return GUIDE_SLOTS.storyIdea.describe(project) !== null;
    case "language":
      return authoringOf(project).languageSaid === true;
    default:
      return GUIDE_FACTS[id].has(project);
  }
}

/** Required facts that still need a question, in catalog order. */
export function missingGuideFacts(project: Project, policies: GuideFactPolicies): GuideFactId[] {
  return GUIDE_FACT_IDS.filter((id) => guideFactState(project, id, policies) === "missing");
}

/** Facts whose derived value must be said once before the story starts. */
export function factsToConfirm(project: Project, policies: GuideFactPolicies): GuideFactId[] {
  return GUIDE_FACT_IDS.filter((id) => guideFactState(project, id, policies) === "toConfirm");
}

/** The facts the broad opening question covers. */
export function broadFacts(policies: GuideFactPolicies): GuideFactId[] {
  return GUIDE_FACT_IDS.filter((id) => policies[id].askInBroad);
}
