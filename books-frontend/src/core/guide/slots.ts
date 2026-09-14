/**
 * Slots — the facts a book is made of, named so the guide can talk about them.
 *
 * A slot is one thing the guide might have to find out ("who is this for", "how
 * old are they") or one thing the pipeline produces ("the page pictures"). The
 * distinction is load-bearing rather than descriptive:
 *
 *   - a `fact` slot can be written by a conversation, so it needs a schema and a
 *     writer (`core/guide/patch.ts`);
 *   - an `artifact` slot is produced by generation and can only be written by the
 *     pipeline that made it.
 *
 * Nothing derived from a model may write an artifact slot. That is the point of
 * splitting them here rather than at the call site: an interpreter that decides
 * the reader "said" their illustrations are finished cannot make it so, because
 * there is no writer to reach.
 *
 * `describe` exists so a slot can render as a chip the reader can revisit — the
 * facts strip. It returns null for "not set yet", which is also what the
 * components use to explain what is still missing.
 */
import { getBookLayout } from "../book/layouts";
import { bookProductForConfig } from "../book";
import { ageBandLabel, storyModeInfo } from "../config/storyCraftCatalog";
import { readingModeLabel } from "../config/readingModes";
import { getBookLanguage } from "../config/bookLanguages";
import { currentAnchorImage } from "../pipeline/provenance";
import { illustrationUnits } from "../book/units";
import { unitIsDone } from "../book/pageCompletion";
import { getCursor } from "../versioning";
import { briefOf, namedCast, namedHeroes, wordCount } from "../story/brief";
import type { Project } from "../types";

export const GUIDE_SLOT_IDS = [
  "storyMode",
  "heroes",
  "heroAges",
  "audience",
  "language",
  "storyIdea",
  "storyText",
  "artStyle",
  "castLooks",
  "pagePlan",
  "pageArt",
  "trim",
  "layout",
] as const;

export type GuideSlotId = (typeof GUIDE_SLOT_IDS)[number];

/** Whether a conversation may write this slot, or only the pipeline. */
export type GuideSlotKind = "fact" | "artifact";

export interface GuideSlot {
  id: GuideSlotId;
  /** Chip label in the facts strip. */
  label: string;
  kind: GuideSlotKind;
  /** The current value as one short phrase, or null when it isn't set. */
  describe: (project: Project) => string | null;
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export const GUIDE_SLOTS: Record<GuideSlotId, GuideSlot> = {
  storyMode: {
    id: "storyMode",
    label: "How it's written",
    kind: "fact",
    // The absence of a PERSISTED brief is the honest signal that nobody has
    // chosen yet; `briefOf` defaults to guided for readers, which would report a
    // choice the reader never made.
    describe: (p) => (p.config.storyBrief ? storyModeInfo(p.config.storyBrief.mode).label : null),
  },
  heroes: {
    id: "heroes",
    label: "Who it's for",
    kind: "fact",
    describe: (p) => {
      const names = namedHeroes(briefOf(p.config));
      return names.length > 0 ? joinNames(names) : null;
    },
  },
  heroAges: {
    id: "heroAges",
    label: "Ages",
    kind: "fact",
    describe: (p) => {
      const cast = namedCast(briefOf(p.config));
      const known = cast.filter((person) => person.age !== undefined || person.ageMonths !== undefined);
      if (known.length === 0) return null;
      const parts = known.map((person) =>
        person.ageMonths !== undefined && (person.ageMonths < 24 || person.ageMonths % 12 !== 0)
          ? `${person.name} ${person.ageMonths}m`
          : `${person.name} ${person.age}`,
      );
      return `${joinNames(parts)}${known.length < cast.length ? " (some missing)" : ""}`;
    },
  },
  audience: {
    id: "audience",
    label: "Reading age",
    kind: "fact",
    describe: (p) => {
      const band = ageBandLabel(p.config.ageRangeId);
      const mode = readingModeLabel(p.config.readingModeId);
      return [band, mode].filter(Boolean).join(" · ") || null;
    },
  },
  language: {
    id: "language",
    label: "Language",
    kind: "fact",
    describe: (p) => getBookLanguage(p.config.contentLocale).englishName || null,
  },
  storyIdea: {
    id: "storyIdea",
    label: "Story idea",
    kind: "fact",
    describe: (p) => {
      const brief = briefOf(p.config);
      const bits = [
        brief.customTheme?.trim(),
        brief.occasion?.trim(),
        brief.customSetting?.trim(),
        brief.themeId ?? undefined,
        brief.settingId ?? undefined,
      ].filter((bit): bit is string => Boolean(bit));
      return bits[0] ?? null;
    },
  },
  storyText: {
    id: "storyText",
    label: "The story",
    kind: "fact",
    describe: (p) => {
      const words = wordCount(p.config.storyText);
      return words > 0 ? `${words} words` : null;
    },
  },
  artStyle: {
    id: "artStyle",
    label: "Art style",
    kind: "fact",
    // Only ids and free text: the RENDERED look is an artifact of the cast
    // sheets, not something this slot can claim.
    describe: (p) =>
      p.config.styleReady === false
        ? null
        : p.config.artStyle.presetId ?? p.config.artStyle.customDescription?.trim() ?? null,
  },
  castLooks: {
    id: "castLooks",
    label: "Character looks",
    kind: "artifact",
    describe: (p) => {
      const cast = (p.anchors ?? []).filter((anchor) => anchor.include);
      if (cast.length === 0) return null;
      const ready = cast.filter((anchor) => currentAnchorImage(anchor)).length;
      return `${ready} / ${cast.length}`;
    },
  },
  pagePlan: {
    id: "pagePlan",
    label: "Page plan",
    kind: "artifact",
    describe: (p) => {
      if (!p.screenplay) return null;
      const doc = getCursor(p.screenplay).content;
      return `${doc.spreads.length} spreads`;
    },
  },
  pageArt: {
    id: "pageArt",
    label: "Page pictures",
    kind: "artifact",
    describe: (p) => {
      const units = illustrationUnits(p);
      if (units.length === 0) return null;
      return `${units.filter((unit) => unitIsDone(p, unit)).length} / ${units.length}`;
    },
  },
  trim: {
    id: "trim",
    label: "Book size",
    kind: "fact",
    describe: (p) => bookProductForConfig(p.config).label,
  },
  layout: {
    id: "layout",
    label: "Layout",
    kind: "fact",
    describe: (p) => getBookLayout(p.config.layoutId).label,
  },
};

export const GUIDE_FACT_SLOT_IDS: GuideSlotId[] = GUIDE_SLOT_IDS.filter(
  (id) => GUIDE_SLOTS[id].kind === "fact",
);

export function guideSlot(id: GuideSlotId): GuideSlot {
  return GUIDE_SLOTS[id];
}
