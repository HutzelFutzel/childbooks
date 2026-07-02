/**
 * Screenplay generation: turns the story + chosen options + anchors into a
 * page-by-page plan (text, illustration brief, layout note, anchors used).
 */
import { z } from "zod";
import {
  AGE_RANGES,
  BOOK_SIZES,
  GRAPHICS_DENSITY,
  LAYOUT_TEMPLATES,
  SPREAD_USAGE,
  TEXT_HANDLING,
  TEXT_PLACEMENT,
} from "../config/options";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { Anchor, BookConfig, ScreenplayDoc, ScreenplaySpread } from "../types";
import { effectiveAnchorIds, normalizeAnchorName } from "../book/anchorRefs";
import { fixPagination } from "./pagination";
import { withRetry } from "./retry";
import { resolveAgeLlmGuidance } from "../prompts/age";
import { ageBandHasReadingModes, readingModeLabel } from "../config/ageWritingCatalog";
import type { PromptContext } from "../prompts/context";

const spreadSchema = z.object({
  kind: z.enum(["single", "spread"]),
  text: z.string(),
  illustration: z.string(),
  layoutNote: z.string(),
  anchors: z.array(z.string()),
});

const coverSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  illustration: z.string(),
  anchors: z.array(z.string()),
});

const screenplaySchema = z.object({
  notes: z.string(),
  frontCover: coverSchema,
  backCover: coverSchema,
  spineText: z.string(),
  spreads: z.array(spreadSchema),
});

type RawScreenplay = z.infer<typeof screenplaySchema>;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function label<T extends { id: string; label: string }>(
  list: T[],
  id: string,
): string {
  return list.find((x) => x.id === id)?.label ?? id;
}

function describeConfig(config: BookConfig): string {
  const layout =
    config.layoutId === "auto"
      ? "Choose the most fitting layout per page"
      : label(LAYOUT_TEMPLATES, config.layoutId);
  return [
    `Age range: ${label(AGE_RANGES, config.ageRangeId)}.`,
    ...(ageBandHasReadingModes(config.ageRangeId) && config.readingModeId
      ? [`Reading mode: ${readingModeLabel(config.readingModeId)}.`]
      : []),
    `Book size: ${label(BOOK_SIZES, config.bookSize)}.`,
    `Graphics density: ${label(GRAPHICS_DENSITY, config.graphicsDensity)}.`,
    `Spread usage: ${label(SPREAD_USAGE, config.spreadUsage)}.`,
    `Text handling: ${label(TEXT_HANDLING, config.textHandling)}.`,
    `Text placement: ${label(TEXT_PLACEMENT, config.textPlacement)}.`,
    `Layout: ${layout}.`,
  ].join("\n");
}

function describeAnchors(anchors: Anchor[]): string {
  if (anchors.length === 0) return "(none)";
  return anchors
    .map((a) => `- ${a.name} [${a.type}]: ${a.description}`)
    .join("\n");
}

export interface GenerateScreenplayInput {
  config: BookConfig;
  anchors: Anchor[];
  creds: ProviderCredentials;
  model: string;
  /** Optional refinement instruction applied to a previous screenplay. */
  edit?: string;
  previous?: ScreenplayDoc;
  signal?: AbortSignal;
  /** Admin prompt overlays (age writing guidance). */
  prompts?: PromptContext;
}

export async function generateScreenplay(
  input: GenerateScreenplayInput,
): Promise<ScreenplayDoc> {
  const { config, anchors, creds, model, edit, previous, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);
  const included = anchors.filter((a) => a.include);

  const spreadGuidance =
    config.spreadUsage === "single"
      ? "Use only single pages (kind = 'single')."
      : config.spreadUsage === "double"
        ? "Use double-page spreads (kind = 'spread') for the illustrations."
        : "Mix single pages and double-page spreads for good pacing.";

  const textGuidance =
    config.textHandling === "exact"
      ? "Keep the author's wording EXACTLY as written; only split it across pages. Do not rewrite."
      : "You may adapt and tighten the wording to suit the age range and reading rhythm.";

  const placementGuidance =
    "Text is ALWAYS laid out separately from the art as an editable overlay (never baked into the illustration); in layoutNote specify where the text block sits (e.g. left page, bottom band). Never request text rendered inside the artwork.";

  const ageTextPrompt = resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, prompts);

  const system = [
    "You are an award-winning children's picture-book author and art director.",
    "Produce a complete page-by-page screenplay for the book.",
    "For each page/spread provide: the narrative text, a vivid illustration brief, a layout note, and which named anchors appear.",
    "Illustration briefs must be concrete and reference the named anchors so the art stays consistent.",
    spreadGuidance,
    textGuidance,
    ageTextPrompt,
    placementGuidance,
    "Also design the book's covers: a frontCover (catchy title + short subtitle + illustration brief), a backCover (a short blurb as 'title', optional subtitle, illustration brief), and a short spineText (usually the title).",
    "Only reference anchors from the provided list, by their exact names. Use an empty array if none appear.",
    "Revision requests may mention anchors by name (e.g. 'put Amanda on page 3'); use the ANCHORS list for who/what each name is, and update each spread's anchors accordingly.",
    "Pace the story well; keep text age-appropriate in length and complexity per page.",
    "PRINTABILITY: page 1 is a single right-hand page. A double-page spread occupies a facing pair, so the number of single pages BEFORE any spread must be even (insert a single page if needed). Never let a spread start on a right-hand page.",
    "Write a short overall 'notes' field with art-direction guidance.",
  ].join(" ");

  const userParts = [
    "BOOK SETTINGS:",
    describeConfig(config),
    "",
    "ANCHORS (use exact names):",
    describeAnchors(included),
    "",
    "STORY:",
    config.storyText.trim(),
  ];

  if (edit && previous) {
    userParts.push(
      "",
      "CURRENT SCREENPLAY (JSON) to revise:",
      JSON.stringify(
        {
          notes: previous.notes,
          frontCover: previous.frontCover,
          backCover: previous.backCover,
          spineText: previous.spine?.text ?? "",
          spreads: previous.spreads.map((s) => ({
            kind: s.kind,
            text: s.text,
            illustration: s.illustration,
            layoutNote: s.layoutNote,
            anchors: effectiveAnchorIds(included, s)
              .map((id) => included.find((a) => a.id === id)?.name)
              .filter(Boolean),
          })),
        },
        null,
        2,
      ),
      "",
      `REVISION REQUEST: ${edit.trim()}`,
      "Return the full revised screenplay.",
    );
  }

  const raw = await withRetry(
    () =>
      provider.generateStructured<RawScreenplay>(creds, {
        model,
        schema: screenplaySchema,
        schemaName: "screenplay",
        temperature: config.textHandling === "exact" ? 0.2 : 0.6,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userParts.join("\n") },
        ],
        signal,
      }),
    { signal },
  );

  // Guarantee a physically printable layout regardless of model output.
  return fixPagination(mapScreenplay(raw, included));
}

/**
 * Resolve a list of LLM-provided anchor names to ids, tolerantly. Returns the
 * matched ids (deduped) and any names that could not be resolved so the caller
 * can warn instead of silently dropping them. Duplicate anchor names are
 * surfaced as ambiguous (first match used).
 */
export function matchAnchorNames(
  names: string[],
  anchors: Anchor[],
): { ids: string[]; unmatched: string[]; ambiguous: string[] } {
  const byNorm = new Map<string, string[]>();
  for (const a of anchors) {
    const key = normalizeAnchorName(a.name);
    if (!key) continue;
    (byNorm.get(key) ?? byNorm.set(key, []).get(key)!).push(a.id);
  }

  const ids: string[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const norm = normalizeAnchorName(raw);
    if (!norm) continue;
    let hit = byNorm.get(norm);
    // Fuzzy fallback: a normalized name contained in (or containing) a known one.
    if (!hit) {
      for (const [key, candidateIds] of byNorm) {
        if (key.includes(norm) || norm.includes(key)) {
          hit = candidateIds;
          break;
        }
      }
    }
    if (!hit || hit.length === 0) {
      unmatched.push(raw);
      continue;
    }
    if (hit.length > 1) ambiguous.push(raw);
    const id = hit[0];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return { ids, unmatched, ambiguous };
}

/** Map LLM output (anchor names) into the stored doc (anchor ids). */
function mapScreenplay(raw: RawScreenplay, anchors: Anchor[]): ScreenplayDoc {
  const allUnmatched = new Set<string>();
  const allAmbiguous = new Set<string>();
  const nameById = new Map(anchors.map((a) => [a.id, a.name]));
  // Resolve LLM-provided names to ids AND record the canonical anchor name in
  // the same slot, so the reference can self-heal by name if ids ever drift.
  const toRefs = (names: string[]): { anchorIds: string[]; anchorNames: string[] } => {
    const { ids, unmatched, ambiguous } = matchAnchorNames(names, anchors);
    unmatched.forEach((n) => allUnmatched.add(n));
    ambiguous.forEach((n) => allAmbiguous.add(n));
    return { anchorIds: ids, anchorNames: ids.map((id) => nameById.get(id) ?? "") };
  };

  const spreads: ScreenplaySpread[] = raw.spreads.map((s) => ({
    id: uid(),
    kind: s.kind,
    text: s.text,
    illustration: s.illustration,
    layoutNote: s.layoutNote,
    ...toRefs(s.anchors),
  }));
  const doc: ScreenplayDoc = {
    notes: raw.notes,
    spreads,
    frontCover: {
      title: raw.frontCover.title,
      subtitle: raw.frontCover.subtitle,
      illustration: raw.frontCover.illustration,
      ...toRefs(raw.frontCover.anchors),
    },
    backCover: {
      title: raw.backCover.title,
      subtitle: raw.backCover.subtitle,
      illustration: raw.backCover.illustration,
      ...toRefs(raw.backCover.anchors),
    },
    spine: { text: raw.spineText },
  };

  if (allUnmatched.size > 0) {
    console.warn(
      `[screenplay] ${allUnmatched.size} anchor name(s) from the model didn't match any anchor and were skipped: ${[...allUnmatched].join(", ")}`,
    );
  }
  if (allAmbiguous.size > 0) {
    console.warn(
      `[screenplay] ambiguous anchor name(s) (multiple anchors share the name): ${[...allAmbiguous].join(", ")}`,
    );
  }
  return doc;
}
