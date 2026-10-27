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
import { resolveStoryCraft, type StoryCraftConfig } from "../config/storyCraft";
import { BOOK_PRODUCTS } from "../fulfillment";
import { bookSizeFromAspect } from "../config/options";
import { briefOf, namedCast, newCastMember } from "../story/brief";
import { CAST_KINDS } from "../story/castKinds";
import { CAST_RELATION_TYPES, relationsOf, twinGroups, withRelation } from "../story/relations";
import type { BookConfig, Project, StoryBrief, StoryCastMember } from "../types";
import type { GuideCommandId } from "./agent/ids";
import type { CommandArgs } from "./agent/types";
import { styleIsFromArtwork } from "./artworkStyle";
import { properName } from "./nameText";
import { noteStyleChange } from "./portrait";
import { authoringOf, withAuthoring } from "./projectState";
import { joinLook } from "./lookNotes";
import { copySharedAges, linkSameAge } from "./sameAge";
import { applyAgeFields, settleStatedAge, turningOf } from "./turning";
import { GUIDE_SLOT_IDS, GUIDE_SLOTS, type GuideSlotId } from "./slots";
import {
  STORY_DETAIL_IDS,
  STORY_DETAILS,
  detailPatchSchema,
  withMatchedOption,
  detailShapeLines,
  detailTextMax,
  salvageStoryIdeaInput,
  unknownDetailIds,
  withStoryDetail,
  type StoryDetailId,
} from "./storyDetails";

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
  /**
   * Per-band themes and settings (`appConfig/storyCraft`), for validating the
   * catalog ids a story idea may name.
   *
   * Carried as the config rather than as a flat id list because the valid ids
   * depend on the book's own age band, which is not known when the context is
   * built. The writer resolves it per project. Absent is not "skip validation" —
   * `resolveStoryCraft` falls back to the shipped catalog, which is itself a
   * closed list.
   */
  storyCraft?: StoryCraftConfig | null;
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
  storyCraft?: StoryCraftConfig | null;
}): GuidePatchContext {
  return {
    ageBandIds: enabledAudienceProfiles(sources.audience ?? null).map((profile) => profile.id),
    artStylePresetIds: resolveArtStyles(sources.artStyles ?? null).map((style) => style.id),
    // Static catalog: the SKUs we can actually print are a property of the print
    // partner, not something an admin sets.
    productSkus: BOOK_PRODUCTS.map((product) => product.sku),
    storyCraft: sources.storyCraft ?? null,
  };
}

/**
 * A refused fact that a skill is the right door for.
 *
 * Some changes cannot be a plain write because they ask a question first (a new
 * look takes the reader's drawings off the book). The fact is not applied; the
 * skill that asks is named here so the interpreter can file the same words as
 * that skill's call instead of dropping them.
 */
export interface GuideReroute {
  command: GuideCommandId;
  args: CommandArgs;
}

export interface GuidePatchRejection {
  key: string;
  /** Why the write was refused, for the turn log. May be technical. */
  reason: string;
  /** The skill that takes this request, when one does. */
  reroute?: GuideReroute;
  /**
   * The same refusal in the reader's words, when there is a useful thing to say.
   *
   * Separate from `reason` because most refusals are not worth speaking — a Zod
   * issue reads like a stack trace — while a few are exactly what the reader needs
   * to hear ("I don't have a Sam in the story"). Only this field is ever spoken.
   */
  speak?: string;
  /** The values this slot would have accepted, when it is a closed list. */
  allowed?: readonly string[];
}

/**
 * One slot's write, as three outcomes rather than two.
 *
 * The distinction between `unchanged` and `rejected` is the whole point. Both used
 * to be `null`, which meant a reader restating a fact the book already held was
 * indistinguishable from a model naming an age band that does not exist — and the
 * conversation told them "I didn't quite catch that" for both. One of those is a
 * confirmation and the other is a failure, and only the book knows which.
 */
export type SlotWrite =
  | {
      status: "applied";
      project: Project;
      /**
       * Part of this slot's value that could not be taken, when the rest could.
       *
       * A turn naming two children the book knows and one it does not should store
       * the two and say so about the third — dropping the whole write would lose
       * good information, and applying it silently would lose the reader's third
       * child with no trace anywhere.
       */
      refusedPart?: Omit<GuidePatchRejection, "key">;
    }
  | { status: "unchanged" }
  | { status: "rejected"; reason: string; speak?: string; allowed?: readonly string[]; reroute?: GuideReroute };

const UNCHANGED: SlotWrite = { status: "unchanged" };

function wrote(project: Project, refusedPart?: Omit<GuidePatchRejection, "key">): SlotWrite {
  return { status: "applied", project, ...(refusedPart ? { refusedPart } : {}) };
}

function refused(
  reason: string,
  extra: { speak?: string; allowed?: readonly string[]; reroute?: GuideReroute } = {},
): SlotWrite {
  return { status: "rejected", reason, ...extra };
}

export interface GuidePatchResult {
  project: Project;
  /** Slots that changed the book. A no-op write is not reported as applied. */
  applied: GuideSlotId[];
  /**
   * Slots whose stated value was already the book's value.
   *
   * Reported rather than dropped so the conversation can confirm ("that's what I
   * have already") instead of denying comprehension. This is the single commonest
   * way the guide used to call a perfectly understood answer a misunderstanding.
   */
  unchanged: GuideSlotId[];
  rejected: GuidePatchRejection[];
}

/**
 * A person's name as a name is written. Every name the interpreter sends passes through here, so the cast,
 * the same-age groups and the relations all hold the same spelling ("aren" is "Aren" everywhere, and a
 * later case-sensitive comparison cannot tell them apart). Only a word typed wholly in lowercase changes.
 */
const nameSchema = z.string().trim().min(1).max(80).transform(properName);
const proseSchema = z.string().trim().max(1000);

/** Somebody the book is about. The age is optional here; `ageSchema` requires it. */
const personSchema = z.object({
  name: nameSchema,
  age: z.number().int().min(0).max(120).optional(),
  ageMonths: z.number().int().min(0).max(1200).optional(),
  /**
   * The age the child is about to reach, only when the parent said they are nearly there ("almost 3" is
   * `age: 2, turning: 3`). A value that is not a sensible number is dropped, never a reason to refuse the
   * rest of what was said.
   */
  turning: z.number().int().min(1).max(120).optional().catch(undefined),
});

/**
 * A person plus how they fit in — "big sister", "their dog", "Maya's grandma".
 *
 * Accepted on `heroes` and nowhere else. Asked who a book is about, a parent
 * answers with a family rather than a list of names, and the relationship is
 * half of what they said: two five-year-olds who are brothers make a different
 * story from two five-year-olds who just met. `role` already reaches the story
 * prompt from the wizard's cast editor, so this is the chat catching up with a
 * field the generator has always used — not a new fact to thread through.
 *
 * Free text on purpose. There is no useful closed set for "the new baby" and
 * "Mum's oldest friend", and it is never read as data: nothing branches on it,
 * so an odd value is a slightly odd sentence in one prompt.
 *
 * `kind` and `species` ride along for the same reason: "her dog Bello" says
 * what Bello is in the same breath as his name, and a child's toy drawn as a
 * child is the failure a missing kind produces.
 */
const castMemberSchema = personSchema.extend({
  role: z.string().trim().max(200).optional(),
  kind: z.enum(CAST_KINDS).optional(),
  species: z.string().trim().min(1).max(80).optional(),
  /** A trait or habit of this person, in the parent's words: "loves dinosaurs". How they look is not a note. */
  note: z.string().trim().max(300).optional(),
});

/**
 * An age for a named person. Carries `role` for the same reason `heroes` does —
 * not because this slot is about relationships, but because "Leo, Maya's little
 * brother, is 3" is one sentence, and a model that puts the age here will put the
 * relationship here with it. Zod strips unknown keys, so refusing to name the
 * field would not reject that claim: it would apply the age and drop the
 * relationship without anyone being told.
 */
const ageSchema = castMemberSchema.refine(
  (value) => value.age !== undefined || value.ageMonths !== undefined || value.turning !== undefined,
  { message: "an age in years or months is required" },
);

/**
 * One slot's validate-then-write step, with its value type sealed inside.
 *
 * The table below holds writers for slots with unrelated value types, so the
 * type has to be existential — but casting each entry to a common supertype
 * would defeat the checking that is the entire point of this module. {@link writer}
 * closes over the value type instead: each entry is checked against its own
 * schema at the definition site, and only `unknown` crosses the table boundary.
 */
/**
 * One worked example of this slot being stated in a real sentence.
 *
 * Few-shot material, kept beside the schema for the same reason `shape` is: the
 * model is shown what to emit and the validator decides what is acceptable, and
 * those two descriptions have to be the same description. A worked example that
 * would be rejected is worse than no example at all, which is why
 * `scripts/guide-engine-invariants.ts` parses every one of these against its own
 * slot's schema.
 *
 * These also replace the single hand-written paragraph the prompt used to carry.
 * That paragraph enumerated specific phrasings ("aren 2 miles 1 and mika 3") in
 * English, which is a regex with extra steps: it grew with every slot and nobody
 * could tell which sentence was holding up which behaviour.
 */
export interface SlotExample {
  /** What the reader typed. */
  said: string;
  /** The value this slot should receive, in the shape the schema accepts. */
  value: unknown;
  /** Optional note for the model about why, when the mapping isn't obvious. */
  note?: string;
}

interface SlotWriter {
  /**
   * The JSON shape this slot accepts, in one line, for the interpreter's prompt.
   * Required at the definition site so the description the model is given cannot
   * drift from the schema that rejects it — the alternative is a shape list in the
   * prompt that quietly describes last month's validator.
   */
  shape: (context: GuidePatchContext, project?: Project) => string;
  /** Worked examples for the prompt. Checked against this slot's own schema. */
  examples: SlotExample[];
  /** This slot's schema, exposed so the example check can run offline. */
  schema: z.ZodTypeAny;
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
  apply: (project: Project, input: unknown, context: GuidePatchContext) => SlotWrite;
}

function writer<T>(
  shape: string | ((context: GuidePatchContext, project?: Project) => string),
  schema: z.ZodType<T>,
  /** Applies the value, or reports that it changed nothing / was refused. */
  write: (project: Project, value: T, context: GuidePatchContext) => SlotWrite,
  /** This slot's settled value, or undefined when nobody has settled it. */
  capture: (project: Project) => T | undefined,
  /** Worked examples for the prompt. Validated against `schema` offline. */
  examples: SlotExample[] = [],
): SlotWriter {
  return {
    shape: typeof shape === "function" ? shape : () => shape,
    examples,
    schema,
    capture,
    apply(project, input, context) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return refused(
          issue ? `${issue.path.join(".") || "value"}: ${issue.message}` : "invalid value",
        );
      }
      return write(project, parsed.data, context);
    },
  };
}

/** A short list for a prompt, truncated so one huge catalog can't swamp it. */
function idList(ids: readonly string[], limit = 40): string {
  const shown = ids.slice(0, limit).map((id) => `"${id}"`).join(" | ");
  return ids.length > limit ? `${shown} | …` : shown;
}

/**
 * Groups of people who share an age, in the shape the schema takes.
 *
 * The model sometimes wraps a group in an object (`[{"names": ["Aren", "Amira"]}]`)
 * or sends one flat group (`["Aren", "Amira"]`). Both say the same thing, so they
 * are read; anything else is returned untouched and fails the schema as before.
 */
function coerceSameAgeGroups(raw: unknown): unknown {
  const asGroup = (item: unknown): unknown => {
    if (Array.isArray(item)) return item;
    if (item && typeof item === "object") {
      const list = Object.values(item as Record<string, unknown>).find(
        (value): value is unknown[] => Array.isArray(value) && value.every((entry) => typeof entry === "string"),
      );
      if (list) return list;
    }
    return item;
  };
  if (Array.isArray(raw)) {
    if (raw.length > 0 && raw.every((item) => typeof item === "string")) return [raw];
    return raw.map(asGroup);
  }
  return raw && typeof raw === "object" ? [asGroup(raw)] : raw;
}

function withConfig(project: Project, patch: Partial<BookConfig>): Project {
  return { ...project, config: { ...project.config, ...patch } };
}

function withBrief(project: Project, next: StoryBrief): Project {
  return withConfig(project, { storyBrief: next });
}

/** A stated kind and species onto a member, in place. A person has no species. */
function withKind(member: StoryCastMember, stated: { kind?: StoryCastMember["kind"]; species?: string }): void {
  if (stated.kind) member.kind = stated.kind;
  const species = stated.species?.trim();
  if (species && member.kind !== "person") member.species = species;
  if (member.kind === "person") delete member.species;
}

/** Cast members keyed for name matching, so "leo" patches "Leo". */
function findByName(cast: StoryCastMember[], name: string): StoryCastMember | undefined {
  const key = name.trim().toLowerCase();
  return cast.find((member) => member.name.trim().toLowerCase() === key);
}

/** Whether the story is being written or has already been written. */
function storyLockedForSetup(project: Project): boolean {
  return authoringOf(project).storyRun?.status === "running" || Boolean(project.config.storyText?.trim());
}

const WRITERS: { [K in GuideSlotId]?: SlotWriter } = {
  storyMode: writer(
    '"guided" (we write it) | "co-write" (their details, our words) | "own" (they write it) — only before the story is written',
    z.enum(["guided", "co-write", "own"]),
    (project, mode) => {
      const brief = briefOf(project.config);
      // "No change" cannot be decided from the mode alone. `briefOf` DEFAULTS to
      // "guided" when nothing is persisted, while `story-mode` is only satisfied once
      // a brief actually exists — so on a fresh book, choosing the default mode looks
      // like a no-op, writes nothing, and the guide asks the same question forever.
      // The absence of a persisted brief is itself the change worth writing.
      if (project.config.storyBrief && brief.mode === mode) return UNCHANGED;
      if (storyLockedForSetup(project)) {
        return refused("the story mode cannot change once the story is being written or has been written", {
          speak: "The story is already underway, so the writing mode stays as it is.",
        });
      }
      return wrote(withBrief(project, { ...brief, mode }));
    },
    // Only once a brief exists: see the note on `capture` about defaults.
    (project) => (project.config.storyBrief ? briefOf(project.config).mode : undefined),
    [
      { said: "you write it", value: "guided" },
      { said: "I'll write it myself", value: "own" },
      { said: "I'll give you the details and you do the words", value: "co-write" },
    ],
  ),

  /**
   * The FULL cast list, not an addition. "It's for Maya and Leo" replaces
   * whoever was there — anything else makes a correction impossible to express.
   * Ages and notes survive for names that stay, matched case-insensitively, so
   * re-stating the list never silently drops the ages already given.
   */
  heroes: writer(
    '["Maya", "Leo"] or [{"name": "Maya", "age": 5, "role": "big sister"}] — the COMPLETE list of who the book is about, not an addition. An age is the years COMPLETED: a child who is nearly 3 is {"age": 2, "turning": 3}. Add "note" for a trait or habit of that one person, in the parent\'s words ("loves dinosaurs"); never how they look',
    /**
     * Names, or names with their ages attached.
     *
     * The second form is here because it is what models produce. Asked for "who
     * the book is about" they answer with people, and a person has an age. The
     * schema used to accept only `string[]`, so that answer was refused, and a
     * coercion layer sat in front of the validator rescuing the shapes it saw
     * most — including by running a regex over `"maya 3"`. Widening the schema
     * does the same job declaratively: the description the model is given, the
     * shape it may send and the shape that validates are one thing again.
     */
    z.array(z.union([nameSchema, castMemberSchema])).min(1).max(12),
    (project, people) => {
      const brief = briefOf(project.config);
      const existing = brief.cast ?? [];
      const seen = new Set<string>();
      const cast: StoryCastMember[] = [];
      for (const person of people) {
        const named = typeof person === "string" ? { name: person } : person;
        const name = named.name.trim();
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const kept = findByName(existing, name);
        // A name the author capitalised on purpose ("DeShawn") is not flattened by a lowercase restatement.
        const keptName = kept && /\p{Lu}/u.test(kept.name) ? kept.name.trim() : name;
        const member: StoryCastMember = kept
          ? { ...kept, name: keptName }
          : { ...newCastMember(), name };
        // An age only when this turn gave one. Re-stating the cast to add a
        // sibling must not blank the ages of the children already in it.
        if (typeof person !== "string") applyAgeFields(member, settleStatedAge(person));
        // Same rule for the relationship, and for the same reason: a turn that
        // re-lists the cast to add a sibling has not withdrawn what it said last
        // time about everyone else. An empty string is a model artefact rather
        // than an instruction to forget, so it also leaves the role alone.
        const role = typeof person === "string" ? undefined : person.role?.trim();
        if (role) member.role = role;
        // A trait said about this one person stays on this person; a restatement adds nothing.
        const trait = typeof person === "string" ? undefined : person.note?.trim();
        if (trait) member.note = joinLook(member.note, trait, 500, [member.name, ...(member.aliases ?? [])]);
        if (typeof person !== "string") withKind(member, person);
        cast.push(member);
      }
      if (sameCast(existing, cast)) return UNCHANGED;
      return wrote(
        copySharedAges(withBrief(project, { ...brief, cast, heroNames: cast.map((member) => member.name) })),
      );
    },
    (project) => {
      const cast = briefOf(project.config).cast ?? [];
      if (cast.length === 0) return undefined;
      // Plain names while that is the whole truth, so the commonest checkpoint
      // stays the simplest shape to read in a log. Objects once a relationship
      // exists, because a jump-back that restored the names and lost "big
      // sister" would quietly rewrite the story it restores.
      return cast.some((member) => member.role?.trim() || member.kind || member.species?.trim())
        ? cast.map((member) => ({
            name: member.name,
            ...(member.role?.trim() ? { role: member.role.trim() } : {}),
            ...(member.kind ? { kind: member.kind } : {}),
            ...(member.species?.trim() ? { species: member.species.trim() } : {}),
          }))
        : cast.map((member) => member.name);
    },
    [
      { said: "Micah and Neil, both 5 years old", value: ["Micah", "Neil"] },
      { said: "it's for my daughter Maya", value: ["Maya"] },
      {
        said: "add her brother Leo",
        value: ["Maya", "Leo"],
        note: "The complete list, including whoever was already there.",
      },
      {
        said: "Maya is 6 and her little brother Leo is 3",
        value: [
          { name: "Maya", age: 6 },
          { name: "Leo", age: 3, role: "Maya's little brother" },
        ],
        note: "Include a relationship only when it was actually said. Never guess one from names or ages.",
      },
      {
        said: "Maya is 6 and loves dinosaurs",
        value: [{ name: "Maya", age: 6, note: "loves dinosaurs" }],
        note: "A trait or habit of one person goes in their note, in the parent's words. Never how they look.",
      },
      {
        said: "it's for Maya, 5, and her dog Bello",
        value: [
          { name: "Maya", age: 5 },
          { name: "Bello", role: "Maya's dog", kind: "animal", species: "dog" },
        ],
        note: "Everyone in the story, not only children. A pet, toy or creature gets its kind; a person needs none.",
      },
      {
        said: "the twins Aren and Amira, and papa and anne. last day at daycare, saying goodbye to their friends Luca and Nile",
        value: [{ name: "Aren" }, { name: "Amira" }, { name: "Papa" }, { name: "Anne" }],
        note: "Family who are in the story are in the list, children first. Friends only named in passing (Luca, Nile) are not in this list: they are reported under \"people\" so the guide adds them to the book, and their part goes in the story idea in the parent's words.",
      },
    ],
  ),

  /**
   * Ages for people who are already in the cast. Deliberately cannot introduce
   * one: "Sam is 6" when there is no Sam is far more likely a misheard name than
   * a new character, and inventing a nameless-until-now hero from it is the kind
   * of thing a reader has to notice to undo.
   */
  heroAges: writer(
    '[{"name": "Maya", "age": 5}, {"name": "Leo", "ageMonths": 30}] — only for names already in the cast; use ageMonths for under-twos. "age" is the years COMPLETED, never rounded up: a child who is nearly 3 is {"age": 2, "turning": 3}. Add "turning" only when the message says the child is about to reach that age, in any language',
    z.array(ageSchema).min(1).max(12),
    (project, ages) => {
      const brief = briefOf(project.config);
      const existing = brief.cast ?? [];
      const known = new Set(existing.map((member) => member.name.trim().toLowerCase()));
      const strangers = ages.filter((age) => !known.has(age.name.trim().toLowerCase()));

      // Nothing to attach these to. Refused rather than ignored: an age for a name
      // the book has never heard is the signal that a name was misheard, and the
      // reader is the only one who can say which.
      if (strangers.length === ages.length) {
        const names = strangers.map((age) => age.name.trim()).join(" and ");
        return refused(`no cast member named ${names}`, {
          speak:
            existing.length === 0
              ? `I don't have anyone in the story yet — tell me their name and I'll add the age to it.`
              : `I don't have ${names} in the story yet.`,
        });
      }

      let changed = false;
      const cast = existing.map((member) => {
        const update = ages.find(
          (candidate) => candidate.name.trim().toLowerCase() === member.name.trim().toLowerCase(),
        );
        if (!update) return member;
        const next: StoryCastMember = { ...member };
        // One unit at a time: months and years for the same person disagree the
        // moment either is edited, and `characterAgeMonths` prefers months.
        applyAgeFields(next, settleStatedAge(update));
        const role = update.role?.trim();
        if (role) next.role = role;
        if (
          next.age !== member.age ||
          next.ageMonths !== member.ageMonths ||
          next.turning !== member.turning ||
          next.role !== member.role
        ) {
          changed = true;
        }
        return next;
      });

      const refusedPart =
        strangers.length > 0
          ? {
              reason: `no cast member named ${strangers.map((a) => a.name.trim()).join(", ")}`,
              speak: `I don't have ${strangers
                .map((a) => a.name.trim())
                .join(" or ")} in the story yet.`,
            }
          : undefined;

      const base = changed ? withBrief(project, { ...brief, cast }) : project;
      const copied = copySharedAges(base);
      if (!changed && copied === project) {
        // The ages that resolved were already right. A stranger in the same turn is
        // still worth refusing, so that case reports as a partial write of nothing
        // rather than as a silent success.
        return refusedPart ? refused(refusedPart.reason, refusedPart) : UNCHANGED;
      }
      return wrote(copied, refusedPart);
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
          ...(turningOf(member) !== undefined ? { turning: turningOf(member) } : {}),
        }));
      return aged.length > 0 ? aged : undefined;
    },
    [
      {
        said: "Micah and Neil, both 5 years old",
        value: [
          { name: "Micah", age: 5 },
          { name: "Neil", age: 5 },
        ],
        note: 'A shared age applies to everyone named — "both", "each", "all of them".',
      },
      {
        said: "she's 18 months",
        value: [{ name: "Maya", ageMonths: 18 }],
        note: "Months for under-twos; the name comes from who is already in the story.",
      },
      { said: "Leo just turned 7", value: [{ name: "Leo", age: 7 }] },
      {
        said: "both almost 3",
        value: [
          { name: "Maya", age: 2, turning: 3 },
          { name: "Leo", age: 2, turning: 3 },
        ],
        note: "Nearly 3 is two years completed. Never round up to 3; `turning` keeps what was said.",
      },
      {
        said: "Mia wird bald 4",
        value: [{ name: "Mia", age: 3, turning: 4 }],
        note: "The same in any language: the age completed, and the age she is about to reach.",
      },
      { said: "she is two and a half", value: [{ name: "Maya", age: 2 }], note: "Not nearly 3: no `turning`." },
      {
        said: "papa and anne are adults",
        value: [
          { name: "Papa", age: 35 },
          { name: "Anne", age: 35 },
        ],
        note: 'A grown-up the parent calls "adult" or "grown-up" without a number is 35. The evidence quotes their words; an age they did state is used as stated.',
      },
    ],
  ),

  /**
   * What characters already in the cast are: a person, an animal, a toy or a
   * creature, and which one. Same stranger rule as `heroAges`.
   */
  castKinds: writer(
    `[{"name": "Bello", "kind": ${CAST_KINDS.map((kind) => `"${kind}"`).join(" | ")}, "species"?: "golden retriever"}] — only for names already in the cast; species for anything that isn't a person`,
    z
      .array(
        z.object({
          name: nameSchema,
          kind: z.enum(CAST_KINDS),
          species: z.string().trim().min(1).max(80).optional(),
        }),
      )
      .min(1)
      .max(12),
    (project, kinds) => {
      const brief = briefOf(project.config);
      const existing = brief.cast ?? [];
      const strangers = kinds.filter((item) => !findByName(existing, item.name));
      if (strangers.length === kinds.length) {
        const names = strangers.map((item) => item.name.trim()).join(" and ");
        return refused(`no cast member named ${names}`, { speak: `I don't have ${names} in the story yet.` });
      }
      let changed = false;
      const cast = existing.map((member) => {
        const update = kinds.find((item) => item.name.trim().toLowerCase() === member.name.trim().toLowerCase());
        if (!update) return member;
        const next: StoryCastMember = { ...member };
        withKind(next, update);
        if (next.kind !== member.kind || next.species !== member.species) changed = true;
        return next;
      });
      const refusedPart =
        strangers.length > 0
          ? {
              reason: `no cast member named ${strangers.map((item) => item.name.trim()).join(", ")}`,
              speak: `I don't have ${strangers.map((item) => item.name.trim()).join(" or ")} in the story yet.`,
            }
          : undefined;
      if (!changed) return refusedPart ? refused(refusedPart.reason, refusedPart) : UNCHANGED;
      return wrote(withBrief(project, { ...brief, cast }), refusedPart);
    },
    (project) => {
      const kinds = (briefOf(project.config).cast ?? [])
        .filter((member) => member.kind)
        .map((member) => ({
          name: member.name,
          kind: member.kind!,
          ...(member.species?.trim() ? { species: member.species.trim() } : {}),
        }));
      return kinds.length > 0 ? kinds : undefined;
    },
    [
      {
        said: "Bello is our golden retriever",
        value: [{ name: "Bello", kind: "animal", species: "golden retriever" }],
      },
      {
        said: "Fluffy is her teddy bear",
        value: [{ name: "Fluffy", kind: "toy", species: "teddy bear" }],
        note: "A toy stays a toy. Never make it a person or a real animal.",
      },
      { said: "Grandpa Joe", value: [{ name: "Grandpa Joe", kind: "person" }], note: "Only when it isn't obvious from the rest." },
    ],
  ),

  /**
   * People who share an age. Free-text `role` still carries "twin" for the
   * story prompt; this is the part the conversation can act on. A later age
   * for one of them is copied to the others, and a disagreeing age leaves the group.
   */
  sameAge: writer(
    '[["Amira", "Aaron"]] — groups of people who share an age. Only when the message says so',
    z.preprocess(coerceSameAgeGroups, z.array(z.array(nameSchema).min(2).max(8)).min(1).max(6)),
    (project, groups) => {
      const linked = linkSameAge(project, groups);
      const refusedPart =
        linked.unknown.length > 0
          ? {
              reason: `no cast member named ${linked.unknown.join(", ")}`,
              speak: `I don't have ${linked.unknown.join(" or ")} in the story yet.`,
            }
          : undefined;
      if (linked.project === project) {
        return refusedPart ? refused(refusedPart.reason, refusedPart) : UNCHANGED;
      }
      return wrote(linked.project, refusedPart);
    },
    (project) => authoringOf(project).sameAge,
    [
      {
        said: "Amira and Aaron are twins",
        value: [["Amira", "Aaron"]],
        note: "Only when they share an age. Quote the words. Never infer it from the names.",
      },
    ],
  ),

  /**
   * How characters belong together. Twins also share an age, so a twins
   * relation links `sameAge` too: one said fact, both consequences.
   */
  relations: writer(
    `[{"names": ["Myla", "Shilo"], "type": ${CAST_RELATION_TYPES.map((type) => `"${type}"`).join(" | ")}, "label"?: their words, "lookAlike"?: "identical" | "different"}] — only names already in the cast; for "owner" the owner comes first`,
    z
      .array(
        z.object({
          names: z.array(nameSchema).min(2).max(8),
          type: z.enum(CAST_RELATION_TYPES),
          label: z.string().trim().max(120).optional(),
          lookAlike: z.enum(["identical", "different"]).optional(),
        }),
      )
      .min(1)
      .max(12),
    (project, relations) => {
      let brief = briefOf(project.config);
      const cast = namedCast(brief);
      const unknown: string[] = [];
      for (const relation of relations) {
        const ids: string[] = [];
        for (const name of relation.names) {
          const member = findByName(cast, name);
          if (!member) {
            if (!unknown.includes(name.trim())) unknown.push(name.trim());
          } else if (!ids.includes(member.id)) ids.push(member.id);
        }
        if (ids.length < 2) continue;
        brief = withRelation(brief, {
          ids,
          type: relation.type,
          ...(relation.label?.trim() ? { label: relation.label.trim() } : {}),
          ...(relation.type === "twins" && relation.lookAlike ? { lookAlike: relation.lookAlike } : {}),
        });
      }
      const refusedPart =
        unknown.length > 0
          ? { reason: `no cast member named ${unknown.join(", ")}`, speak: `I don't have ${unknown.join(" or ")} in the story yet.` }
          : undefined;
      if (JSON.stringify(brief.relations ?? []) === JSON.stringify(briefOf(project.config).relations ?? [])) {
        return refusedPart ? refused(refusedPart.reason, refusedPart) : UNCHANGED;
      }
      const withRelations = withBrief(project, brief);
      return wrote(linkSameAge(withRelations, twinGroups(brief)).project, refusedPart);
    },
    (project) => {
      const brief = briefOf(project.config);
      const byId = new Map((brief.cast ?? []).map((member) => [member.id, member.name]));
      const relations = relationsOf(brief).map((relation) => ({
        names: relation.ids.map((id) => byId.get(id) ?? id),
        type: relation.type,
        ...(relation.label ? { label: relation.label } : {}),
        ...(relation.lookAlike ? { lookAlike: relation.lookAlike } : {}),
      }));
      return relations.length > 0 ? relations : undefined;
    },
    [
      {
        said: "Myla and Shilo are twins",
        value: [{ names: ["Myla", "Shilo"], type: "twins" }],
        note: "Only lookAlike when they said, or plainly meant, whether the twins look the same.",
      },
      {
        said: "my twins, a boy and a girl, Aren and Amira",
        value: [{ names: ["Aren", "Amira"], type: "twins", lookAlike: "different" }],
        note: "Twins who are a boy and a girl, \"fraternal\" or \"not identical\" are not identical: say so with lookAlike \"different\" and do not leave it for a question. Never guess it from the names.",
      },
      {
        said: "they're identical twins",
        value: [{ names: ["Myla", "Shilo"], type: "twins", lookAlike: "identical" }],
      },
      {
        said: "Bello is Maya's dog",
        value: [{ names: ["Maya", "Bello"], type: "owner" }],
      },
      {
        said: "Tom is her best friend from kindergarten",
        value: [{ names: ["Maya", "Tom"], type: "friends", label: "best friends from kindergarten" }],
      },
    ],
  ),

  audience: writer(
    (context) =>
      `{"ageRangeId": ${idList(context.ageBandIds)}, "readingModeId"?: ${idList(READING_MODE_IDS)} | null}`,
    z.object({
      ageRangeId: z.string().min(1).max(40),
      readingModeId: z.string().max(40).nullable().optional(),
    }),
    (project, value, context) => {
      /**
       * "Is this a change?" is answered before "is this allowed?", and the order
       * matters in one specific case: a book holding a band an admin has since
       * deleted. Restating its own value has to be a no-op, not a refusal —
       * otherwise restoring a checkpoint taken before the deletion would fail, and
       * the reader would be told they cannot have the thing they already have.
       * Validation exists to police CHANGES.
       */
      if (
        project.config.ageRangeId === value.ageRangeId &&
        project.config.audienceFromCast === "custom" &&
        (value.readingModeId === undefined ||
          (project.config.readingModeId ?? null) === (value.readingModeId ?? null))
      ) {
        return UNCHANGED;
      }
      // Refused, not ignored. These used to return `null`, which the caller read as
      // "nothing changed" — so a band an admin had deleted produced no write, no
      // rejection, no log line, and a reader being told their answer wasn't understood.
      if (!context.ageBandIds.includes(value.ageRangeId)) {
        return refused(`unknown age band "${value.ageRangeId}"`, {
          allowed: context.ageBandIds,
        });
      }
      if (
        value.readingModeId !== undefined &&
        value.readingModeId !== null &&
        !isReadingModeId(value.readingModeId)
      ) {
        return refused(`unknown reading mode "${value.readingModeId}"`, {
          allowed: READING_MODE_IDS,
        });
      }
      const patch: Partial<BookConfig> = {
        ageRangeId: value.ageRangeId,
        // An age stated in conversation is an explicit choice, so it must stop
        // following the hero's age — otherwise the next cast edit silently
        // overwrites what the reader just asked for.
        audienceFromCast: "custom",
      };
      if (value.readingModeId !== undefined) patch.readingModeId = value.readingModeId ?? null;
      return wrote(withConfig(project, patch));
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
    [
      {
        said: "Now the target audience is 4-year-old kids",
        value: { ageRangeId: "4-5" },
        note: "The band whose range contains the age said. Only who the book is written for; a child's own age is heroAges.",
      },
      {
        said: "yes, agree",
        value: { ageRangeId: "3y" },
        note: "Only as the answer to the guide's reading-age question: a yes restates the band it suggested.",
      },
    ],
  ),

  language: writer(
    () => `${idList(BOOK_LANGUAGES.map((language) => language.id))} — the language the BOOK is written in (only before the story is written; once it is written, a new language is the setBookLanguage skill, which translates it)`,
    z.string().min(2).max(35),
    (project, locale) => {
      // Restating the book's own value is always a no-op — see the note on `audience`.
      if (project.config.contentLocale === locale) return UNCHANGED;
      if (!isBookLanguageId(locale)) {
        return refused(`unknown book language "${locale}"`, {
          speak: "I can't write the book in that language yet.",
          allowed: BOOK_LANGUAGES.map((language) => language.id),
        });
      }
      if (storyLockedForSetup(project)) {
        // Not a fact to write: once the story exists its language changes by translating it, which the skill does.
        return refused("the story is already written, so a new language translates it (the setBookLanguage skill) instead of being set", {
          speak: "The story is already written, so I'll translate it into the new language rather than write it again.",
          reroute: { command: "setBookLanguage", args: { language: locale } },
        });
      }
      return wrote(withConfig(project, { contentLocale: locale }));
    },
    (project) =>
      isBookLanguageId(project.config.contentLocale) ? project.config.contentLocale : undefined,
    [
      { said: "write it in German", value: "de-DE" },
      { said: "auf Deutsch bitte", value: "de-DE", note: "The language they ask for, not the language they asked in." },
    ],
  ),

  storyIdea: writer(
    (context, project) =>
      `{"<detail>": {…} | null, …} — only the story details the reader stated, as listed ids or in their own words: "add" puts their words next to what the detail already holds, "text" replaces it (only when they correct or replace it); null clears one. Every detail is an OBJECT, never a bare string: {"about": {"text": "…"}}, not {"about": "…"}. Details:\n${detailShapeLines(
        project ? resolveStoryCraft(project.config.ageRangeId, context.storyCraft ?? null) : null,
      )}`,
    // Each detail is read on its own first (shorthand like `"about": "a trip"` is
    // accepted, an unusable detail no longer takes the usable ones with it).
    z.preprocess(salvageStoryIdeaInput, z.object({
      // Details `salvageStoryIdeaInput` could not read, with why. Set by it, never by the model.
      rejectedDetails: z.array(z.object({ id: z.string(), reason: z.string() })).optional(),
      // The brief's own fields: what checkpoints and older turns carry. The
      // interpreter is shown only the detail keys below.
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
      deviceIds: z.array(z.string().min(1).max(60)).max(2).nullable().optional(),
      customDevice: proseSchema.nullable().optional(),
      ...(Object.fromEntries(STORY_DETAIL_IDS.map((id) => [id, detailPatchSchema.nullable().optional()])) as Record<
        StoryDetailId,
        z.ZodOptional<z.ZodNullable<typeof detailPatchSchema>>
      >),
    })),
    (project, value, context) => {
      const brief = briefOf(project.config);
      let next: StoryBrief = { ...brief };
      let changed = false;
      // What the schema step set aside. Reported with whatever did apply, or as
      // the refusal itself when nothing did, so the repair pass sees the reason.
      const unreadDetails = value.rejectedDetails ?? [];
      const unreadPart =
        unreadDetails.length > 0
          ? { reason: unreadDetails.map((detail) => detail.reason).join("; ") }
          : undefined;
      const outcome = (written: Project): SlotWrite =>
        changed
          ? wrote(written, unreadPart)
          : unreadPart
            ? refused(unreadPart.reason)
            : UNCHANGED;
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
      /**
       * Catalog ids are checked HERE, against the book's own band.
       *
       * `normalizeStoryBriefForCraft` drops an unknown id later, on the way to the
       * prompt. Relying on that alone meant the write was reported as applied, the
       * guide confirmed the theme to the reader, and the book then quietly did not
       * have one — the opposite failure to a refused write, and a harder one to
       * notice. An id already stored is left alone: it changes nothing, and a
       * band change should not make an old checkpoint un-restorable.
       */
      const craft = resolveStoryCraft(project.config.ageRangeId, context.storyCraft ?? null);
      const badId = (
        incoming: string | null | undefined,
        current: string | null | undefined,
        options: { id: string }[],
      ): string | null => {
        if (typeof incoming !== "string" || incoming === current) return null;
        return options.some((option) => option.id === incoming) ? null : incoming;
      };
      const badTheme = badId(value.themeId, brief.themeId, craft.themes);
      if (badTheme) {
        return refused(`unknown theme "${badTheme}" for this age band`, {
          allowed: craft.themes.map((theme) => theme.id),
        });
      }
      const badSetting = badId(value.settingId, brief.settingId, craft.settings);
      if (badSetting) {
        return refused(`unknown setting "${badSetting}" for this age band`, {
          allowed: craft.settings.map((setting) => setting.id),
        });
      }

      const currentDevices = brief.deviceIds && brief.deviceIds.length > 0 ? brief.deviceIds : brief.deviceId ? [brief.deviceId] : [];
      const badDevice =
        value.deviceIds && JSON.stringify(value.deviceIds) !== JSON.stringify(currentDevices)
          ? value.deviceIds.find((id) => !craft.devices.some((device) => device.id === id))
          : undefined;
      if (badDevice) {
        return refused(`unknown stylistic device "${badDevice}" for this age band`, {
          allowed: craft.devices.map((device) => device.id),
        });
      }
      for (const id of STORY_DETAIL_IDS) {
        const ids = value[id]?.ids;
        const current = STORY_DETAILS[id].read(brief)?.ids ?? [];
        const unknown = ids ? unknownDetailIds(id, ids, craft).filter((optionId) => !current.includes(optionId)) : [];
        if (unknown.length > 0) {
          return refused(`unknown ${id} option "${unknown[0]}" for this age band`, {
            allowed: STORY_DETAILS[id].options(craft).map((option) => option.id),
          });
        }
      }

      assign("themeId", value.themeId);
      assignProse("customTheme", value.customTheme);
      assign("settingId", value.settingId);
      assignProse("customSetting", value.customSetting);
      assignProse("occasion", value.occasion);
      assignProse("when", value.when);
      assignProse("where", value.where);
      assignProse("mustInclude", value.mustInclude);
      assignProse("customDevice", value.customDevice);
      if (value.deviceIds !== undefined) {
        const ids = value.deviceIds ?? [];
        if (JSON.stringify(ids) !== JSON.stringify(currentDevices)) {
          next.deviceIds = ids;
          next.deviceId = ids[0] ?? null;
          changed = true;
        }
      }
      // The story details, each merged onto what the brief holds now. A write
      // that leaves a detail reading the same is not a change.
      for (const id of STORY_DETAIL_IDS) {
        if (value[id] === undefined) continue;
        const def = STORY_DETAILS[id];
        const before = def.read(next);
        // "rhymes" is the band's rhyme option, not a free-text wish the draft would
        // have to interpret on its own.
        const patch = withMatchedOption(id, value[id], before, craft);
        if (patch === undefined) continue;
        if (patch === null && before === null) continue;
        const written = withStoryDetail(next, id, patch);
        const after = def.read(written);
        if (JSON.stringify(after) === JSON.stringify(before)) continue;
        if ((after?.text?.length ?? 0) > detailTextMax(id)) {
          return refused(`"${id}" would hold more than ${detailTextMax(id)} characters`, {
            speak: `That's more than I can keep under "${def.label}". Could you say it a little shorter?`,
          });
        }
        next = written;
        changed = true;
      }
      return outcome(withBrief(project, next));
    },
    (project) => {
      const brief = briefOf(project.config);
      // Every field, every time — an explicit null where there is nothing. A partial
      // capture cannot undo an ADDITION: the writer merges, so a field the reader set
      // after the checkpoint would survive a restore that simply didn't mention it.
      const devices = brief.deviceIds && brief.deviceIds.length > 0 ? brief.deviceIds : brief.deviceId ? [brief.deviceId] : [];
      const idea: Record<string, unknown> = {
        themeId: brief.themeId ?? null,
        customTheme: brief.customTheme ?? null,
        settingId: brief.settingId ?? null,
        customSetting: brief.customSetting ?? null,
        occasion: brief.occasion ?? null,
        when: brief.when ?? null,
        where: brief.where ?? null,
        mustInclude: brief.mustInclude ?? null,
        deviceIds: devices.length > 0 ? devices : null,
        customDevice: brief.customDevice ?? null,
      };
      // Details without a brief field of their own, each complete so a restore
      // replaces rather than merges.
      for (const id of STORY_DETAIL_IDS) {
        if (!STORY_DETAILS[id].inDetails) continue;
        const detail = STORY_DETAILS[id].read(brief);
        idea[id] = detail ? { ids: detail.ids ?? null, text: detail.text ?? null, on: detail.on ?? null } : null;
      }
      return Object.values(idea).some((value) => value !== null) ? idea : undefined;
    },
    [
      {
        said: "a birthday trip to the sea, and it has to have their dog Rex in it",
        value: { moment: { text: "a birthday trip to the sea" }, include: { add: "their dog Rex" } },
      },
      {
        said: "oh, and Grandpa always whistles when he cooks",
        value: { include: { add: "Grandpa always whistles when he cooks" } },
        note: "A wish or family detail that fits no other detail goes in include, in their words. \"add\" keeps what include already holds.",
      },
      {
        said: "not the red balloon, a blue one",
        value: { include: { text: "their dog Rex and a blue balloon" } },
        note: "A correction replaces with \"text\": the complete new wording, keeping the parts they didn't change.",
      },
      {
        said: "something about starting school",
        value: { about: { text: "starting school" } },
        note: "Their own words when no listed id obviously fits. Never invent an id.",
      },
      {
        said: "they fly from San Francisco to Frankfurt, packed with rhymes and jokes",
        value: {
          about: { text: "a flight from San Francisco to Frankfurt" },
          telling: { text: "rhymes" },
          include: { add: "jokes" },
        },
        note: "Every detail is an object with ids / text / add, never a bare string. Their own plot goes in about.text, in their words.",
      },
      {
        said: "a calm bedtime story please, and no monsters",
        value: { bedtime: { on: true }, mood: { ids: ["calm"] }, avoid: { add: "monsters" } },
      },
      {
        said: "she loves dinosaurs, and it should be for her birthday",
        value: { interests: { add: "dinosaurs" }, moment: { ids: ["birthday"] } },
      },
    ],
  ),

  storyText: writer(
    "the complete story text — only when the reader is writing it themselves or dictating it verbatim, never a summary",
    z.string().max(40_000),
    (project, text) =>
      project.config.storyText === text ? UNCHANGED : wrote(withConfig(project, { storyText: text })),
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
      // Restating the book's own value is always a no-op — see the note on `audience`.
      const current = project.config.artStyle;
      if (
        current.presetId === value.presetId &&
        (current.customDescription ?? "") === (value.customDescription ?? "") &&
        project.config.styleReady === true
      ) {
        return UNCHANGED;
      }
      if (value.presetId !== null && !context.artStylePresetIds.includes(value.presetId)) {
        return refused(`unknown art style "${value.presetId}"`, {
          allowed: context.artStylePresetIds,
        });
      }
      if (value.presetId === null && !value.customDescription?.trim()) {
        return refused("a custom art style needs a description", {
          speak: "Tell me a bit more about the look you want and I'll use that.",
        });
      }
      // The book's look is the reader's own drawing. Another look takes the
      // drawing off the book, and that is a question to ask, not a fact to
      // write: the `setStyle` skill asks it, so the same words go there.
      if (styleIsFromArtwork(project)) {
        const wanted = value.presetId ?? value.customDescription?.trim() ?? "";
        return refused("the book's look comes from the reader's drawing; changing it asks first", {
          speak: "That look comes from your own drawing, so I'll check with you before I swap it for another style.",
          reroute: { command: "setStyle", args: { style: wanted } },
        });
      }
      return wrote(noteStyleChange(project, withConfig(project, {
        artStyle: {
          presetId: value.presetId,
          ...(value.presetId !== null ? { origin: "preset" as const } : {}),
          ...(value.customDescription?.trim()
            ? { customDescription: value.customDescription.trim() }
            : {}),
        },
        // Naming a style IS confirming it; the gate exists to stop the book
        // continuing without one, not to demand a second click.
        styleReady: true,
      })));
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
      // Restating the book's own value is always a no-op — see the note on `audience`.
      if (project.config.productSku === sku) return UNCHANGED;
      if (!context.productSkus.includes(sku)) {
        return refused(`unknown product "${sku}"`, {
          speak: "We don't print that size.",
          allowed: context.productSkus,
        });
      }
      const product = BOOK_PRODUCTS.find((candidate) => candidate.sku === sku);
      if (!product) return refused(`unknown product "${sku}"`);
      const changed = project.config.productSku !== sku;
      return wrote(
        withAuthoring(
          withConfig(project, {
            productSku: sku,
            bookSize: bookSizeFromAspect(product.aspect),
          }),
          {
            bookSetup: {
              formatConfirmedAt: Date.now(),
              layoutConfirmedAt: changed
                ? undefined
                : authoringOf(project).bookSetup?.layoutConfirmedAt,
            },
          },
        ),
      );
    },
    (project) => project.config.productSku ?? undefined,
  ),

  layout: writer(
    () => `${idList(Object.keys(BOOK_LAYOUTS), 12)} — how words sit with the picture`,
    z.string().min(1).max(60),
    (project, layoutId) => {
      // Restating the book's own value is always a no-op — see the note on `audience`.
      if (project.config.layoutId === layoutId) return UNCHANGED;
      if (!isKnownLayoutId(layoutId)) {
        return refused(`unknown layout "${layoutId}"`, { allowed: Object.keys(BOOK_LAYOUTS) });
      }
      const layout = BOOK_LAYOUTS[layoutId]!;
      const changed =
        project.config.layoutId !== layoutId ||
        project.config.compositionMode !== layout.defaultMode;
      return wrote(
        withAuthoring(
          withConfig(project, {
            layoutId,
            compositionMode: layout.defaultMode,
          }),
          {
            bookSetup: {
              ...authoringOf(project).bookSetup,
              layoutConfirmedAt: Date.now(),
            },
            planRequestedFor: undefined,
            planBasis: changed
              ? authoringOf(project).planBasis ??
                (project.screenplay ? "setup-changed" : undefined)
              : authoringOf(project).planBasis,
          },
        ),
      );
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
      member.ageMonths === other.ageMonths &&
      member.turning === other.turning &&
      // Compared even though nothing branches on it: a turn whose only news is
      // "Leo is her little brother" has to count as a write, or the writer
      // reports nothing changed and the relationship is dropped while the reply
      // says the book already knew it.
      (member.role?.trim() ?? "") === (other.role?.trim() ?? "") &&
      member.kind === other.kind &&
      (member.species?.trim() ?? "") === (other.species?.trim() ?? "") &&
      // Same reason: a turn whose only news is a trait ("Maya loves dinosaurs") is a write.
      (member.note?.trim() ?? "") === (other.note?.trim() ?? "")
    );
  });
}

/**
 * Own properties only.
 *
 * `"__proto__" in WRITERS` is true — every object inherits it — so the `in` form
 * answered yes for a name that has no writer. `applyGuidePatch` iterates a fixed
 * list and was never at risk, but anything else treating this as "is this a real
 * slot?" was told yes, and a claim on `__proto__` was waved through as legitimate
 * and then quietly did nothing. Same class of answer for `constructor`, `toString`
 * and the rest of the chain.
 */
export function isGuidePatchableSlot(id: string): id is GuideSlotId {
  return Object.hasOwn(WRITERS, id);
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
export function guidePatchShapeLines(context: GuidePatchContext, project?: Project): string {
  return GUIDE_PATCHABLE_SLOT_IDS.map(
    (id) => `- ${id}: ${WRITERS[id]!.shape(context, project)}`,
  ).join("\n");
}

/**
 * Worked examples for the interpreter's prompt, generated from the writers.
 *
 * Same argument as {@link guidePatchShapeLines}: the model is shown what to emit
 * by the code that decides what is acceptable, so the two cannot drift. Slots with
 * no examples contribute nothing rather than an empty heading.
 */
export function guidePatchExampleLines(): string {
  const lines: string[] = [];
  for (const id of GUIDE_PATCHABLE_SLOT_IDS) {
    for (const example of WRITERS[id]!.examples) {
      const note = example.note ? `  // ${example.note}` : "";
      lines.push(`- "${example.said}" ⇒ {"${id}": ${JSON.stringify(example.value)}}${note}`);
    }
  }
  return lines.join("\n");
}

/** Every slot's examples, for the offline check that they satisfy their schema. */
export function guideSlotExamples(): { slot: GuideSlotId; example: SlotExample; schema: z.ZodTypeAny }[] {
  return GUIDE_PATCHABLE_SLOT_IDS.flatMap((id) =>
    WRITERS[id]!.examples.map((example) => ({ slot: id, example, schema: WRITERS[id]!.schema })),
  );
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
  const unchanged: GuideSlotId[] = [];
  const rejected: GuidePatchRejection[] = [];

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { project, applied, unchanged, rejected: [{ key: "*", reason: "not an object" }] };
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
    switch (outcome.status) {
      case "applied":
        next = outcome.project;
        applied.push(id);
        // A write can succeed and still have refused part of what it was given.
        if (outcome.refusedPart) rejected.push({ key: id, ...outcome.refusedPart });
        break;
      case "unchanged":
        unchanged.push(id);
        break;
      case "rejected":
        rejected.push({
          key: id,
          reason: outcome.reason,
          ...(outcome.speak ? { speak: outcome.speak } : {}),
          ...(outcome.allowed ? { allowed: outcome.allowed } : {}),
          ...(outcome.reroute ? { reroute: outcome.reroute } : {}),
        });
        break;
    }
  }

  return { project: next, applied, unchanged, rejected };
}
