/**
 * Closed-world merge: the only way a conversation may change a book.
 *
 * Everything the interpreter produces arrives here as an untrusted object, and
 * this module is what makes that safe. "Closed world" means three things, and each
 * one is a hole that a plain `{ ...config, ...patch }` would leave open:
 *
 *   1. **Only known slots.** An unrecognised key is reported, never merged. A
 *      model that invents `{ price: 0 }` or `{ isAdmin: true }` cannot reach the
 *      project, because there is no writer for those names.
 *   2. **Only fact slots.** Artifact slots — the cast sheets, the page plan, the
 *      illustrations — have no writer at all (see `core/guide/slots.ts`). Nothing
 *      derived from a model can declare a picture finished; only the pipeline that
 *      rendered it can.
 *   3. **Only values from the world the CALLER declares.** Age bands, layouts and
 *      art styles are admin-configurable, so the valid ids aren't knowable here.
 *      The context is required rather than optional for exactly that reason: an
 *      optional allow-list is one that gets forgotten at the one call site that
 *      mattered.
 *
 * Failures are reported, not thrown. A turn where the reader said one usable
 * thing and one unusable thing should apply the usable half and be able to ask
 * about the rest, which is only possible if a rejection is data.
 *
 * The result is a NEW project; nothing is mutated. Persistence, undo and
 * conflict handling stay with the projects store, which already does all three.
 */
import { z } from "zod";
import { isKnownLayoutId } from "../book/layouts";
import { isReadingModeId } from "../config/readingModes";
import { isBookLanguageId } from "../config/bookLanguages";
import { briefOf, newCastMember } from "../story/brief";
import type { BookConfig, Project, StoryBrief, StoryCastMember } from "../types";
import { GUIDE_SLOT_IDS, GUIDE_SLOTS, type GuideSlotId } from "./slots";

/**
 * The worlds this patch is allowed to name. Supplied by the caller from the live
 * admin configuration, so a band an admin deleted stops being writable the moment
 * they delete it.
 */
export interface GuidePatchContext {
  /** Enabled age-band ids (`appConfig/audience`). */
  ageBandIds: readonly string[];
  /** Art-style preset ids (`appConfig/artStyles`). */
  artStylePresetIds: readonly string[];
  /** Product SKUs the catalog sells. */
  productSkus: readonly string[];
}

export interface GuidePatchRejection {
  key: string;
  reason: string;
}

export interface GuidePatchResult {
  project: Project;
  /** Slots that changed the book. A no-op write is not reported as applied. */
  applied: GuideSlotId[];
  rejected: GuidePatchRejection[];
}

const nameSchema = z.string().trim().min(1).max(80);
const proseSchema = z.string().trim().max(1000);

const ageSchema = z
  .object({
    name: nameSchema,
    age: z.number().int().min(0).max(120).optional(),
    ageMonths: z.number().int().min(0).max(1200).optional(),
  })
  .refine((value) => value.age !== undefined || value.ageMonths !== undefined, {
    message: "an age in years or months is required",
  });

/**
 * One slot's validate-then-write step, with its value type sealed inside.
 *
 * The table below holds writers for slots with unrelated value types, so the
 * type has to be existential — but casting each entry to a common supertype
 * would defeat the checking that is the entire point of this module. {@link writer}
 * closes over the value type instead: each entry is checked against its own
 * schema at the definition site, and only `unknown` crosses the table boundary.
 */
interface SlotWriter {
  apply: (
    project: Project,
    input: unknown,
    context: GuidePatchContext,
  ) => { ok: true; project: Project | null } | { ok: false; reason: string };
}

function writer<T>(
  schema: z.ZodType<T>,
  /** Returns the updated project, or null when the value changes nothing. */
  write: (project: Project, value: T, context: GuidePatchContext) => Project | null,
): SlotWriter {
  return {
    apply(project, input, context) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid value" };
      }
      return { ok: true, project: write(project, parsed.data, context) };
    },
  };
}

function withConfig(project: Project, patch: Partial<BookConfig>): Project {
  return { ...project, config: { ...project.config, ...patch } };
}

function withBrief(project: Project, next: StoryBrief): Project {
  return withConfig(project, { storyBrief: next });
}

/** Cast members keyed for name matching, so "leo" patches "Leo". */
function findByName(cast: StoryCastMember[], name: string): StoryCastMember | undefined {
  const key = name.trim().toLowerCase();
  return cast.find((member) => member.name.trim().toLowerCase() === key);
}

const WRITERS: { [K in GuideSlotId]?: SlotWriter } = {
  storyMode: writer(z.enum(["guided", "co-write", "own"]), (project, mode) => {
    const brief = briefOf(project.config);
    return brief.mode === mode ? null : withBrief(project, { ...brief, mode });
  }),

  /**
   * The FULL cast list, not an addition. "It's for Maya and Leo" replaces
   * whoever was there — anything else makes a correction impossible to express.
   * Ages and notes survive for names that stay, matched case-insensitively, so
   * re-stating the list never silently drops the ages already given.
   */
  heroes: writer(z.array(nameSchema).min(1).max(12), (project, names) => {
    const brief = briefOf(project.config);
    const existing = brief.cast ?? [];
    const seen = new Set<string>();
    const cast: StoryCastMember[] = [];
    for (const name of names) {
      const key = name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const kept = findByName(existing, name);
      cast.push(kept ? { ...kept, name: name.trim() } : { ...newCastMember(), name: name.trim() });
    }
    if (sameCast(existing, cast)) return null;
    return withBrief(project, { ...brief, cast, heroNames: cast.map((member) => member.name) });
  }),

  /**
   * Ages for people who are already in the cast. Deliberately cannot introduce
   * one: "Sam is 6" when there is no Sam is far more likely a misheard name than
   * a new character, and inventing a nameless-until-now hero from it is the kind
   * of thing a reader has to notice to undo.
   */
  heroAges: writer(z.array(ageSchema).min(1).max(12), (project, ages) => {
    const brief = briefOf(project.config);
    const existing = brief.cast ?? [];
    let changed = false;
    const cast = existing.map((member) => {
      const update = ages.find(
        (candidate) => candidate.name.trim().toLowerCase() === member.name.trim().toLowerCase(),
      );
      if (!update) return member;
      const next: StoryCastMember = { ...member };
      // One unit at a time: months and years for the same person disagree the
      // moment either is edited, and `characterAgeMonths` prefers months.
      if (update.ageMonths !== undefined) {
        next.ageMonths = update.ageMonths;
        delete next.age;
      } else {
        next.age = update.age;
        delete next.ageMonths;
      }
      if (next.age !== member.age || next.ageMonths !== member.ageMonths) changed = true;
      return next;
    });
    return changed ? withBrief(project, { ...brief, cast }) : null;
  }),

  audience: writer(
    z.object({
      ageRangeId: z.string().min(1).max(40),
      readingModeId: z.string().max(40).nullable().optional(),
    }),
    (project, value, context) => {
      if (!context.ageBandIds.includes(value.ageRangeId)) return null;
      if (
        value.readingModeId !== undefined &&
        value.readingModeId !== null &&
        !isReadingModeId(value.readingModeId)
      ) {
        return null;
      }
      const patch: Partial<BookConfig> = {
        ageRangeId: value.ageRangeId,
        // An age stated in conversation is an explicit choice, so it must stop
        // following the hero's age — otherwise the next cast edit silently
        // overwrites what the reader just asked for.
        audienceFromCast: "custom",
      };
      if (value.readingModeId !== undefined) patch.readingModeId = value.readingModeId ?? null;
      if (
        project.config.ageRangeId === patch.ageRangeId &&
        project.config.audienceFromCast === "custom" &&
        (patch.readingModeId === undefined || project.config.readingModeId === patch.readingModeId)
      ) {
        return null;
      }
      return withConfig(project, patch);
    },
  ),

  language: writer(z.string().min(2).max(35), (project, locale) => {
    if (!isBookLanguageId(locale) || project.config.contentLocale === locale) return null;
    return withConfig(project, { contentLocale: locale });
  }),

  storyIdea: writer(
    z.object({
      themeId: z.string().max(60).nullable().optional(),
      customTheme: proseSchema.optional(),
      settingId: z.string().max(60).nullable().optional(),
      customSetting: proseSchema.optional(),
      occasion: proseSchema.optional(),
      when: proseSchema.optional(),
      where: proseSchema.optional(),
      mustInclude: proseSchema.optional(),
    }),
    (project, value) => {
      const brief = briefOf(project.config);
      const next: StoryBrief = { ...brief };
      let changed = false;
      // Field by field and typed, rather than a spread: `undefined` has to mean
      // "not mentioned in this turn" while `null` means "clear it", and a merge
      // that treats them alike wipes a theme every time the reader talks about
      // something else.
      const assign = <K extends keyof StoryBrief>(key: K, incoming: StoryBrief[K] | undefined) => {
        if (incoming === undefined || next[key] === incoming) return;
        next[key] = incoming;
        changed = true;
      };
      assign("themeId", value.themeId);
      assign("customTheme", value.customTheme);
      assign("settingId", value.settingId);
      assign("customSetting", value.customSetting);
      assign("occasion", value.occasion);
      assign("when", value.when);
      assign("where", value.where);
      assign("mustInclude", value.mustInclude);
      // Catalog ids are scoped to the book's age band by
      // `normalizeStoryBriefForCraft`, which the story pipeline already applies —
      // an id from another band is dropped there rather than validated twice.
      return changed ? withBrief(project, next) : null;
    },
  ),

  storyText: writer(z.string().max(40_000), (project, text) =>
    project.config.storyText === text ? null : withConfig(project, { storyText: text }),
  ),

  artStyle: writer(
    z.object({
      presetId: z.string().min(1).max(60).nullable(),
      customDescription: proseSchema.optional(),
    }),
    (project, value, context) => {
      if (value.presetId !== null && !context.artStylePresetIds.includes(value.presetId)) return null;
      if (value.presetId === null && !value.customDescription?.trim()) return null;
      const current = project.config.artStyle;
      if (
        current.presetId === value.presetId &&
        (current.customDescription ?? "") === (value.customDescription ?? "") &&
        project.config.styleReady === true
      ) {
        return null;
      }
      return withConfig(project, {
        artStyle: {
          presetId: value.presetId,
          ...(value.customDescription?.trim()
            ? { customDescription: value.customDescription.trim() }
            : {}),
        },
        // Naming a style IS confirming it; the gate exists to stop the book
        // continuing without one, not to demand a second click.
        styleReady: true,
      });
    },
  ),

  trim: writer(z.string().min(1).max(60), (project, sku, context) => {
    if (!context.productSkus.includes(sku) || project.config.productSku === sku) return null;
    return withConfig(project, { productSku: sku });
  }),

  layout: writer(z.string().min(1).max(60), (project, layoutId) => {
    if (!isKnownLayoutId(layoutId) || project.config.layoutId === layoutId) return null;
    return withConfig(project, { layoutId });
  }),
};

function sameCast(a: StoryCastMember[], b: StoryCastMember[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((member, index) => {
    const other = b[index]!;
    return (
      member.name.trim() === other.name.trim() &&
      member.age === other.age &&
      member.ageMonths === other.ageMonths
    );
  });
}

export function isGuidePatchableSlot(id: string): id is GuideSlotId {
  return id in WRITERS;
}

/**
 * Slots a conversation can write, in catalog order. Everything else is an
 * artifact. Ordered by the catalog rather than by this file's table so the
 * ordering guarantee {@link applyGuidePatch} relies on is a property of the
 * slot list, not of how the writers happen to be typed out.
 */
export const GUIDE_PATCHABLE_SLOT_IDS: GuideSlotId[] =
  GUIDE_SLOT_IDS.filter(isGuidePatchableSlot);

/**
 * Apply an untrusted patch, one slot at a time.
 *
 * Slots are applied in the order the catalog declares them rather than the order
 * the input happens to list them, so a single turn that names both the cast and
 * their ages lands the names first — `heroAges` can only patch people who are
 * already there, and an input-ordered merge would drop the ages half the time.
 */
export function applyGuidePatch(
  project: Project,
  patch: unknown,
  context: GuidePatchContext,
): GuidePatchResult {
  const applied: GuideSlotId[] = [];
  const rejected: GuidePatchRejection[] = [];

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { project, applied, rejected: [{ key: "*", reason: "not an object" }] };
  }

  const input = patch as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (isGuidePatchableSlot(key)) continue;
    rejected.push({
      key,
      reason:
        key in GUIDE_SLOTS
          ? `"${key}" is produced by generation and cannot be set from a message`
          : `"${key}" is not a known fact`,
    });
  }

  let next = project;
  for (const id of GUIDE_PATCHABLE_SLOT_IDS) {
    if (!(id in input)) continue;
    const outcome = WRITERS[id]!.apply(next, input[id], context);
    if (!outcome.ok) {
      rejected.push({ key: id, reason: outcome.reason });
      continue;
    }
    if (outcome.project) {
      next = outcome.project;
      applied.push(id);
    }
  }

  return { project: next, applied, rejected };
}
