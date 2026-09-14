/**
 * The component catalog — every unit of work the guide can put in front of a
 * reader, and the one place that says when each one is finished.
 *
 * A component is a question (or a piece of generation) with a satisfaction
 * predicate. The guide never stores "which step are we on": it asks the catalog
 * what is still unsatisfied and works on that. Refreshing, switching device or
 * arriving with a half-finished book from the old wizard therefore all resolve
 * the same way, because the answer is derived from the book rather than from a
 * cursor that can drift out of sync with it.
 *
 * **Satisfaction delegates; it does not restate.** `story-cast` calls
 * `isBriefReady` / `briefBlockers`, `cast-looks` and `page-art` read the same
 * provenance and completion helpers the wizard's progress rail reads. A second
 * definition of "ready" that agrees today is a second definition that disagrees
 * after the next edit, and the two flows have to stay portable: a book started in
 * one must be finishable in the other.
 *
 * **`legacyDestination` is the bridge, and it is temporary.** While the wizard is
 * still the shipped UI, the engine's answer has to be expressible as a wizard
 * destination, so each component names the one that hosts it. It is the only
 * field here that knows the old UI exists, and it goes away with it.
 *
 * Two subtleties worth knowing before changing a predicate:
 *
 *   - **Story components go quiet once the story exists.** A book that arrived
 *     from the old wizard, or one whose reader typed their own words, can have a
 *     story without ever having answered "who is it for". Asking again would send
 *     them backwards, so every story-side component treats a written story as
 *     settling its question. `story-approve` is the deliberate exception: it is
 *     the reader's confirmation, so only the reader can satisfy it.
 *   - **`review` is never satisfied.** Placing an order is not a fact about the
 *     book, so it can't be one of these predicates. It is marked `terminal`,
 *     which keeps it out of the progress ratio and stops "100% complete" from
 *     meaning "already bought".
 */
import { currentAnchorImage } from "../pipeline/provenance";
import { illustrationUnits } from "../book/units";
import { unitIsDone } from "../book/pageCompletion";
import {
  audienceSourceCharacter,
  briefBlockers,
  briefOf,
  isBriefReady,
} from "../story/brief";
import type { Project } from "../types";
import type { GuideSlotId } from "./slots";

export const GUIDE_COMPONENT_IDS = [
  "story-mode",
  "story-cast",
  "audience",
  "story-idea",
  "story-draft",
  "story-approve",
  "art-style",
  "cast-looks",
  "page-plan",
  "page-art",
  "review",
] as const;

export type GuideComponentId = (typeof GUIDE_COMPONENT_IDS)[number];

/**
 * What the artifact pane shows while a component is active. Each value maps to a
 * component that already exists — the guide opens the manuscript, the cast shelf,
 * the page canvas and the flip-through, it does not reimplement them.
 */
export type GuideCanvasKind = "none" | "manuscript" | "cast" | "pages" | "preview";

/** Durable generation a component kicks off. Wired to jobs in a later phase. */
export type GuideEffectId = "storyDraft" | "castArt" | "screenplay" | "pageArt";

/** The wizard destination that hosts a component while both flows ship. */
export type GuideLegacyDestination = "story" | "style" | "cast" | "pages" | "order";

export interface GuideComponent {
  id: GuideComponentId;
  /** Short name, shown on the progress rail and in the admin playlist editor. */
  title: string;
  /** What the guide is trying to find out or produce here. */
  purpose: string;
  slots: GuideSlotId[];
  /** Components whose facts this one is meaningless without. */
  requires: GuideComponentId[];
  canvas: GuideCanvasKind;
  effect?: GuideEffectId;
  /** Whether the reader may decline it and still finish a book. */
  skippable: boolean;
  /** Excluded from completion counting (see the `review` note above). */
  terminal?: boolean;
  isSatisfied: (project: Project) => boolean;
  /** Why it isn't satisfied yet, in the reader's words. Empty when satisfied. */
  blockers: (project: Project) => string[];
  legacyDestination: GuideLegacyDestination;
}

/**
 * Whether the story exists as far as the reader is concerned — either they
 * confirmed it and moved on, or there is text on the page. Every story-side
 * question stops asking at this point.
 */
function storySettled(project: Project): boolean {
  return project.stage === "studio" || project.config.storyText.trim().length > 0;
}

/** The cast references the book actually needs, as the progress rail counts them. */
function requiredAnchors(project: Project) {
  return (project.anchors ?? []).filter((anchor) => anchor.include);
}

/**
 * Whether the cast is finished: analysed, every required reference drawn, and the
 * reader's confirmation on it.
 *
 * One function rather than a predicate and a matching explanation, because they
 * drifted the moment they were written twice — the legacy inference for
 * `castReady === undefined` lived in one and not the other, so a book from before
 * that flag existed read as both finished and blocked.
 */
function castReady(project: Project): boolean {
  if (!project.analysis) return false;
  const anchors = requiredAnchors(project);
  const drawn = anchors.filter((anchor) => currentAnchorImage(anchor)).length;
  if (anchors.length > 0 && drawn !== anchors.length) return false;
  // Mirrors the progress rail: an explicit confirmation, with the inference for
  // books made before that flag existed.
  return project.config.castReady ?? (anchors.length > 0 && drawn === anchors.length);
}

const CATALOG: GuideComponent[] = [
  {
    id: "story-mode",
    title: "How to write it",
    purpose: "Whether the story is written by AI, from your details, or by you.",
    slots: ["storyMode"],
    requires: [],
    canvas: "none",
    skippable: false,
    isSatisfied: (p) => Boolean(p.config.storyBrief) || storySettled(p),
    blockers: (p) =>
      Boolean(p.config.storyBrief) || storySettled(p)
        ? []
        : ["Choose whether we write the story, or you do."],
    legacyDestination: "story",
  },
  {
    id: "story-cast",
    title: "Who it's for",
    purpose: "The children the book is about, and how old they are.",
    slots: ["heroes", "heroAges"],
    requires: ["story-mode"],
    canvas: "none",
    skippable: false,
    // Delegated wholesale: the draft pipeline and the backend route both gate on
    // `isBriefReady`, so anything else here would let the guide promise a story
    // the generator refuses to write.
    isSatisfied: (p) => isBriefReady(briefOf(p.config)) || storySettled(p),
    blockers: (p) => (storySettled(p) ? [] : briefBlockers(briefOf(p.config))),
    legacyDestination: "story",
  },
  {
    id: "audience",
    title: "Reading age & language",
    purpose: "The age band the writing is pitched at, and the language it's in.",
    // Language rides along: it is the other fact about who reads this, it has a
    // working default, and the same thing settles both — a written story was
    // written for an age, in a language.
    slots: ["audience", "language"],
    requires: ["story-mode"],
    canvas: "none",
    skippable: true,
    // Settled when it can be derived (the first named child's age drives the
    // band), or chosen outright, or the story is already written for a band.
    isSatisfied: (p) =>
      p.config.audienceFromCast === "custom" ||
      Boolean(audienceSourceCharacter(briefOf(p.config).cast)) ||
      storySettled(p),
    blockers: (p) =>
      p.config.audienceFromCast === "custom" ||
      Boolean(audienceSourceCharacter(briefOf(p.config).cast)) ||
      storySettled(p)
        ? []
        : ["Tell us the reading age, or the age of the child it's for."],
    legacyDestination: "story",
  },
  {
    id: "story-idea",
    title: "Story idea",
    purpose: "A theme, an occasion or a place to build the story around.",
    slots: ["storyIdea"],
    requires: ["story-mode"],
    canvas: "none",
    skippable: true,
    isSatisfied: (p) => {
      const brief = briefOf(p.config);
      return (
        Boolean(
          brief.themeId ||
            brief.customTheme?.trim() ||
            brief.settingId ||
            brief.customSetting?.trim() ||
            brief.occasion?.trim(),
        ) || storySettled(p)
      );
    },
    blockers: () => [],
    legacyDestination: "story",
  },
  {
    id: "story-draft",
    title: "The story",
    purpose: "The words themselves.",
    slots: ["storyText"],
    requires: ["story-cast"],
    canvas: "manuscript",
    effect: "storyDraft",
    skippable: false,
    isSatisfied: (p) => p.config.storyText.trim().length > 0,
    blockers: (p) => (p.config.storyText.trim() ? [] : ["The story hasn't been written yet."]),
    legacyDestination: "story",
  },
  {
    id: "story-approve",
    title: "Happy with the story",
    purpose: "Your go-ahead, before we spend anything on pictures.",
    slots: [],
    requires: ["story-draft"],
    canvas: "manuscript",
    skippable: false,
    // The one story-side question a written story does NOT settle: this IS the
    // reader saying yes, and everything downstream costs money.
    isSatisfied: (p) => p.stage === "studio",
    blockers: (p) => (p.stage === "studio" ? [] : ["Read the story over and approve it."]),
    legacyDestination: "story",
  },
  {
    id: "art-style",
    title: "Art style",
    purpose: "The look every picture in the book is drawn in.",
    slots: ["artStyle"],
    requires: ["story-approve"],
    canvas: "cast",
    skippable: false,
    // `styleReady === false` is the explicit gate the story step sets on the way
    // out; `undefined` means a project from before the gate existed.
    isSatisfied: (p) => p.config.styleReady !== false,
    blockers: (p) => (p.config.styleReady === false ? ["Pick the look for your book."] : []),
    legacyDestination: "style",
  },
  {
    id: "cast-looks",
    title: "Characters & places",
    purpose: "A reference picture for everyone and everywhere that recurs.",
    slots: ["castLooks"],
    requires: ["art-style"],
    canvas: "cast",
    effect: "castArt",
    skippable: false,
    isSatisfied: castReady,
    blockers: (p) => {
      if (castReady(p)) return [];
      if (!p.analysis) return ["We're still reading the story for its characters and places."];
      const anchors = requiredAnchors(p);
      const missing = anchors.filter((anchor) => !currentAnchorImage(anchor)).length;
      if (missing > 0) {
        const one = missing === 1;
        return [
          `${missing} character${one ? "" : "s"} or place${one ? "" : "s"} still ${one ? "needs" : "need"} a picture.`,
        ];
      }
      return ["Confirm the cast looks right."];
    },
    legacyDestination: "cast",
  },
  {
    id: "page-plan",
    title: "Page plan",
    purpose: "The story split into spreads, each with what it shows.",
    slots: ["pagePlan"],
    requires: ["cast-looks"],
    canvas: "pages",
    effect: "screenplay",
    skippable: false,
    isSatisfied: (p) => Boolean(p.screenplay),
    blockers: (p) => (p.screenplay ? [] : ["We're still turning the story into pages."]),
    // The wizard has no surface of its own for the wait, so it holds on Cast
    // while the screenplay drafts. The guide narrates it instead.
    legacyDestination: "cast",
  },
  {
    id: "page-art",
    title: "The pictures",
    purpose: "An illustration on every page.",
    slots: ["pageArt"],
    requires: ["page-plan"],
    canvas: "pages",
    effect: "pageArt",
    skippable: false,
    isSatisfied: (p) => {
      const units = illustrationUnits(p);
      return units.length > 0 && units.every((unit) => unitIsDone(p, unit));
    },
    blockers: (p) => {
      const units = illustrationUnits(p);
      if (units.length === 0) return ["There are no pages to illustrate yet."];
      const missing = units.filter((unit) => !unitIsDone(p, unit)).length;
      if (missing === 0) return [];
      return [`${missing} page${missing === 1 ? " still needs" : "s still need"} a picture.`];
    },
    legacyDestination: "pages",
  },
  {
    id: "review",
    title: "Review & order",
    purpose: "Read it end to end, check the size and binding, then order the print.",
    // Size and layout live here rather than in a step of their own. Both ship
    // with working defaults (that is what makes Pages open as a book), so there is
    // no question to ask — but they are the last thing worth checking before
    // paying for a physical object, and the review IS that check.
    slots: ["trim", "layout"],
    requires: ["page-art"],
    canvas: "preview",
    skippable: false,
    terminal: true,
    isSatisfied: () => false,
    blockers: () => [],
    legacyDestination: "order",
  },
];

export const GUIDE_COMPONENTS: Record<GuideComponentId, GuideComponent> = Object.fromEntries(
  CATALOG.map((component) => [component.id, component]),
) as Record<GuideComponentId, GuideComponent>;

/** The catalog in its shipped order — also the default playlist. */
export const GUIDE_CATALOG: readonly GuideComponent[] = CATALOG;

export function guideComponent(id: GuideComponentId): GuideComponent {
  return GUIDE_COMPONENTS[id];
}

export function isGuideComponentId(value: unknown): value is GuideComponentId {
  return typeof value === "string" && value in GUIDE_COMPONENTS;
}

/**
 * Whether a component's facts are in place, ignoring the playlist entirely.
 *
 * Deliberately answered from the catalog rather than from the resolved playlist:
 * a requirement that an admin disabled is still a fact about the book, so
 * disabling "art style" must not make the pictures that depend on it look
 * blocked.
 */
export function isComponentSatisfied(id: GuideComponentId, project: Project): boolean {
  return GUIDE_COMPONENTS[id].isSatisfied(project);
}
