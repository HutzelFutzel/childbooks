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
import { BOOK_LAYOUTS, isKnownLayoutId } from "../book/layouts";
import { READING_MODE_IDS, isReadingModeId } from "../config/readingModes";
import { BOOK_LANGUAGES, isBookLanguageId } from "../config/bookLanguages";
import { enabledAudienceProfiles, type AudienceConfig } from "../config/audience";
import { resolveArtStyles, type ArtStylesConfig } from "../config/artStyles";
import { BOOK_PRODUCTS } from "../fulfillment";
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

/**
 * Build the context from the live configs.
 *
 * One builder for both sides on purpose. The server uses it to tell the model which
 * ids exist; the client uses it to decide which ids may be written. If those two
 * lists were assembled separately they would eventually disagree, and the symptom
 * is the worst kind: the guide offers the parent a choice, they take it, and the
 * write is silently refused.
 */
export function guidePatchContext(sources: {
  audience?: AudienceConfig | null;
  artStyles?: ArtStylesConfig | null;
}): GuidePatchContext {
  return {
    ageBandIds: enabledAudienceProfiles(sources.audience ?? null).map((profile) => profile.id),
    artStylePresetIds: resolveArtStyles(sources.artStyles ?? null).map((style) => style.id),
    // Static catalog: the SKUs we can actually print are a property of the print
    // partner, not something an admin sets.
    productSkus: BOOK_PRODUCTS.map((product) => product.sku),
  };
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
  /**
   * The JSON shape this slot accepts, in one line, for the interpreter's prompt.
   * Required at the definition site so the description the model is given cannot
   * drift from the schema that rejects it — the alternative is a shape list in the
   * prompt that quietly describes last month's validator.
   */
  shape: (context: GuidePatchContext) => string;
  /**
   * This slot's current value, in the shape {@link apply} accepts — the inverse of
   * the writer, used to take checkpoints the reader can jump back to.
   *
   * Returns `undefined` when the fact isn't established, which is not the same as
   * "empty". `briefOf` reports a story mode for a book that has never had one, and
   * an age band can be inherited from the hero rather than chosen; capturing those
   * would turn a default into a decision, so that a jump-back writes a fact the
   * reader never stated. The rule is: capture only what someone actually settled.
   *
   * Defined at the definition site next to `apply` because the pair has to agree —
   * `scripts/guide-memory-invariants.ts` requires capture-then-apply to change
   * nothing, which is the only way a restore is guaranteed to be faithful.
   */
  capture: (project: Project) => unknown;
  apply: (
    project: Project,
    input: unknown,
    context: GuidePatchContext,
  ) => { ok: true; project: Project | null } | { ok: false; reason: string };
}

function writer<T>(
  shape: string | ((context: GuidePatchContext) => string),
  schema: z.ZodType<T>,
  /** Returns the updated project, or null when the value changes nothing. */
  write: (project: Project, value: T, context: GuidePatchContext) => Project | null,
  /** This slot's settled value, or undefined when nobody has settled it. */
  capture: (project: Project) => T | undefined,
): SlotWriter {
  return {
    shape: typeof shape === "function" ? shape : () => shape,
    capture,
    apply(project, input, context) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid value" };
      }
      return { ok: true, project: write(project, parsed.data, context) };
    },
  };
}

/** A short list for a prompt, truncated so one huge catalog can't swamp it. */
function idList(ids: readonly string[], limit = 40): string {
  const shown = ids.slice(0, limit).map((id) => `"${id}"`).join(" | ");
  return ids.length > limit ? `${shown} | …` : shown;
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
  storyMode: writer(
    '"guided" (we write it) | "co-write" (their details, our words) | "own" (they write it)',
    z.enum(["guided", "co-write", "own"]),
    (project, mode) => {
      const brief = briefOf(project.config);
      // "No change" cannot be decided from the mode alone. `briefOf` DEFAULTS to
      // "guided" when nothing is persisted, while `story-mode` is only satisfied once
      // a brief actually exists — so on a fresh book, choosing the default mode looks
      // like a no-op, writes nothing, and the guide asks the same question forever.
      // The absence of a persisted brief is itself the change worth writing.
      if (project.config.storyBrief && brief.mode === mode) return null;
      return withBrief(project, { ...brief, mode });
    },
    // Only once a brief exists: see the note on `capture` about defaults.
    (project) => (project.config.storyBrief ? briefOf(project.config).mode : undefined),
  ),

  /**
   * The FULL cast list, not an addition. "It's for Maya and Leo" replaces
   * whoever was there — anything else makes a correction impossible to express.
   * Ages and notes survive for names that stay, matched case-insensitively, so
   * re-stating the list never silently drops the ages already given.
   */
  heroes: writer(
    '["Maya", "Leo"] — the COMPLETE list of who the book is about, not an addition',
    z.array(nameSchema).min(1).max(12),
    (project, names) => {
      const brief = briefOf(project.config);
      const existing = brief.cast ?? [];
      const seen = new Set<string>();
      const cast: StoryCastMember[] = [];
      for (const name of names) {
        const key = name.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const kept = findByName(existing, name);
        cast.push(
          kept ? { ...kept, name: name.trim() } : { ...newCastMember(), name: name.trim() },
        );
      }
      if (sameCast(existing, cast)) return null;
      return withBrief(project, { ...brief, cast, heroNames: cast.map((member) => member.name) });
    },
    (project) => {
      const cast = briefOf(project.config).cast ?? [];
      return cast.length > 0 ? cast.map((member) => member.name) : undefined;
    },
  ),

  /**
   * Ages for people who are already in the cast. Deliberately cannot introduce
   * one: "Sam is 6" when there is no Sam is far more likely a misheard name than
   * a new character, and inventing a nameless-until-now hero from it is the kind
   * of thing a reader has to notice to undo.
   */
  heroAges: writer(
    '[{"name": "Maya", "age": 5}, {"name": "Leo", "ageMonths": 30}] — only for names already in the cast; use ageMonths for under-twos',
    z.array(ageSchema).min(1).max(12),
    (project, ages) => {
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
    },
    (project) => {
      const aged = (briefOf(project.config).cast ?? [])
        .filter((member) => member.age !== undefined || member.ageMonths !== undefined)
        .map((member) => ({
          name: member.name,
          // One unit only, matching the writer: sending both would make the pair
          // disagree the moment either is edited.
          ...(member.ageMonths !== undefined
            ? { ageMonths: member.ageMonths }
            : { age: member.age }),
        }));
      return aged.length > 0 ? aged : undefined;
    },
  ),

  audience: writer(
    (context) =>
      `{"ageRangeId": ${idList(context.ageBandIds)}, "readingModeId"?: ${idList(READING_MODE_IDS)} | null}`,
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
    (project) =>
      // An inherited band is not a stated fact — the writer stamps
      // `audienceFromCast: "custom"`, so anything else would not round-trip.
      project.config.audienceFromCast === "custom" && project.config.ageRangeId
        ? {
            ageRangeId: project.config.ageRangeId,
            readingModeId: project.config.readingModeId ?? null,
          }
        : undefined,
  ),

  language: writer(
    () => `${idList(BOOK_LANGUAGES.map((language) => language.id))} — the language the BOOK is written in`,
    z.string().min(2).max(35),
    (project, locale) => {
      if (!isBookLanguageId(locale) || project.config.contentLocale === locale) return null;
      return withConfig(project, { contentLocale: locale });
    },
    (project) =>
      isBookLanguageId(project.config.contentLocale) ? project.config.contentLocale : undefined,
  ),

  storyIdea: writer(
    '{"customTheme"?, "occasion"?, "customSetting"?, "when"?, "where"?, "mustInclude"? } — free text, the reader\'s own words',
    z.object({
      themeId: z.string().max(60).nullable().optional(),
      // Prose fields take null for the same reason the id fields do: it means "clear
      // this". They previously did not, which made the slot un-restorable — a
      // checkpoint is a merge, so a value the reader has since added can only be
      // removed by naming it explicitly.
      customTheme: proseSchema.nullable().optional(),
      settingId: z.string().max(60).nullable().optional(),
      customSetting: proseSchema.nullable().optional(),
      occasion: proseSchema.nullable().optional(),
      when: proseSchema.nullable().optional(),
      where: proseSchema.nullable().optional(),
      mustInclude: proseSchema.nullable().optional(),
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
      // The prose fields are typed as absent-or-string, so an explicit clear has to
      // land as `undefined` rather than as the `null` on the wire.
      const clear = (incoming: string | null | undefined): string | undefined =>
        incoming === null ? undefined : incoming;
      const assignProse = <K extends keyof StoryBrief>(
        key: K,
        incoming: string | null | undefined,
      ) => {
        if (incoming === undefined) return; // not mentioned this turn
        const next_ = clear(incoming) as StoryBrief[K];
        if (next[key] === next_) return;
        next[key] = next_;
        changed = true;
      };
      assign("themeId", value.themeId);
      assignProse("customTheme", value.customTheme);
      assign("settingId", value.settingId);
      assignProse("customSetting", value.customSetting);
      assignProse("occasion", value.occasion);
      assignProse("when", value.when);
      assignProse("where", value.where);
      assignProse("mustInclude", value.mustInclude);
      // Catalog ids are scoped to the book's age band by
      // `normalizeStoryBriefForCraft`, which the story pipeline already applies —
      // an id from another band is dropped there rather than validated twice.
      return changed ? withBrief(project, next) : null;
    },
    (project) => {
      const brief = briefOf(project.config);
      // Every field, every time — an explicit null where there is nothing. A partial
      // capture cannot undo an ADDITION: the writer merges, so a field the reader set
      // after the checkpoint would survive a restore that simply didn't mention it.
      const idea = {
        themeId: brief.themeId ?? null,
        customTheme: brief.customTheme ?? null,
        settingId: brief.settingId ?? null,
        customSetting: brief.customSetting ?? null,
        occasion: brief.occasion ?? null,
        when: brief.when ?? null,
        where: brief.where ?? null,
        mustInclude: brief.mustInclude ?? null,
      };
      return Object.values(idea).some((value) => value !== null) ? idea : undefined;
    },
  ),

  storyText: writer(
    "the complete story text — only when the reader is writing it themselves or dictating it verbatim, never a summary",
    z.string().max(40_000),
    (project, text) =>
      project.config.storyText === text ? null : withConfig(project, { storyText: text }),
    (project) => (project.config.storyText?.trim() ? project.config.storyText : undefined),
  ),

  artStyle: writer(
    (context) =>
      `{"presetId": ${idList(context.artStylePresetIds)} | null, "customDescription"?: free text (required when presetId is null)}`,
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
    (project) =>
      // Only a confirmed style: the writer sets `styleReady`, so capturing an
      // unconfirmed one would not round-trip.
      project.config.styleReady === true
        ? {
            presetId: project.config.artStyle.presetId,
            ...(project.config.artStyle.customDescription
              ? { customDescription: project.config.artStyle.customDescription }
              : {}),
          }
        : undefined,
  ),

  trim: writer(
    (context) => `${idList(context.productSkus, 8)} — a printed product SKU`,
    z.string().min(1).max(60),
    (project, sku, context) => {
      if (!context.productSkus.includes(sku) || project.config.productSku === sku) return null;
      return withConfig(project, { productSku: sku });
    },
    (project) => project.config.productSku ?? undefined,
  ),

  layout: writer(
    () => `${idList(Object.keys(BOOK_LAYOUTS), 12)} — how words sit with the picture`,
    z.string().min(1).max(60),
    (project, layoutId) => {
      if (!isKnownLayoutId(layoutId) || project.config.layoutId === layoutId) return null;
      return withConfig(project, { layoutId });
    },
    (project) => (isKnownLayoutId(project.config.layoutId) ? project.config.layoutId : undefined),
  ),
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
 * The writable slots and their accepted shapes, for the interpreter's prompt.
 *
 * Generated from the writers rather than written out in the prompt template, so
 * the world the model is told about is the same world {@link applyGuidePatch}
 * enforces. A hand-maintained list would describe the validator as it was on the
 * day someone wrote it down; this one cannot.
 *
 * The context is threaded through because half these shapes are admin-configurable
 * id lists — an age band an admin adds this morning is offered this afternoon,
 * with no prompt edit and no deploy.
 */
export function guidePatchShapeLines(context: GuidePatchContext): string {
  return GUIDE_PATCHABLE_SLOT_IDS.map(
    (id) => `- ${id}: ${WRITERS[id]!.shape(context)}`,
  ).join("\n");
}

/**
 * The facts as they stand, in patch shape — a checkpoint the reader can return to.
 *
 * This is the whole of what a jump-back restores, and what it leaves alone is the
 * point. Artifacts are not captured: a book whose hero was five and is now six should
 * not silently get its old pictures back, because those pictures are of a five-year-old
 * either way. Restoring the facts and letting the staleness check notice that the art
 * no longer matches is the honest outcome — the reader is told what is out of date and
 * offered one tap to redraw it (see `core/guide/staleness.ts`).
 *
 * Slots nobody has settled are absent rather than null, so restoring an early
 * checkpoint does not write a pile of defaults over decisions made since.
 */
export function captureGuideFacts(project: Project): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const id of GUIDE_PATCHABLE_SLOT_IDS) {
    const value = WRITERS[id]!.capture(project);
    if (value !== undefined) facts[id] = value;
  }
  return facts;
}

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
