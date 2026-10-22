/**
 * Screenplay generation: turns the story + chosen options + anchors into a
 * page-by-page plan (text, illustration brief, layout note, anchors used).
 *
 * The model proposes the plan; the code reads it before it is believed. The
 * pages must carry the author's words, a name must resolve to exactly one
 * person, a picture holds as many figures as the age band allows, and a
 * double-page spread must not start on a right-hand page. What fails is sent
 * back once as a request to fix those pages and nothing else, and when the
 * words themselves still do not match, the story is cut into pages in code and
 * the model only writes the pictures for them.
 */
import { z } from "zod";
import { GRAPHICS_DENSITY, SPREAD_USAGE, TEXT_HANDLING, TEXT_PLACEMENT } from "../config/options";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { Anchor, BookConfig, ScreenplayDoc, ScreenplaySpread } from "../types";
import { visualDescription } from "../book/anchorDescription";
import { anchorNameKeys, effectiveAnchorIds, normalizeAnchorName } from "../book/anchorRefs";
import { getBookLayout } from "../book/layouts";
import { getBookLanguage } from "../config/bookLanguages";
import { optionsGuidance } from "../config/storyCraft";
import { fixPagination, fitSpreadsToPages } from "./pagination";
import { readManuscript, splitGuidance, storyForPages } from "../story/manuscriptShape";
import { restoreModelLineBreaks } from "../story/lineBreaks";
import { briefOf, namedHeroes } from "../story/brief";
import { withRetry } from "./retry";
import { resolveAudienceOverlays, type AudienceOverlays } from "../prompts/audience";
import { resolveStoryCraftFor } from "../prompts/story";
import { readingModeLabel } from "../config/readingModes";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import {
  completeScreenplayCast,
  inspectScreenplay,
  wordlessAllowance,
  type NameIssue,
  type ScreenplayCheck,
} from "./screenplayCheck";
import { splitStoryIntoPages, verseBlocks } from "./screenplayText";

const spreadSchema = z.object({
  kind: z.enum(["single", "spread"]),
  text: z.string(),
  illustration: z.string(),
  layoutNote: z.string(),
  continuity: z.string(),
  wardrobe: z.array(z.object({ anchor: z.string(), outfit: z.string() })),
  wordless: z.boolean(),
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
  /** Recurring things the story has that the ANCHORS list does not. Old prompt overrides may omit it. */
  unlisted: z.array(z.string()).nullish(),
});

/** The most unlisted things kept; a plan that finds more than this is not reading the list. */
const UNLISTED_MAX = 5;

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

function describeConfig(config: BookConfig, overlays: AudienceOverlays): string {
  const layout = getBookLayout(config.layoutId).label;
  const hasModes = overlays.profile.readingModes.length > 0;
  return [
    `Age range: ${overlays.profile.label}.`,
    ...(hasModes && config.readingModeId
      ? [`Reading mode: ${readingModeLabel(config.readingModeId)}.`]
      : []),
    // Book size is intentionally omitted: the physical trim is chosen later, in
    // the Design step, and doesn't meaningfully steer text pacing. Keeping it
    // out lets size be decided after the screenplay without a stale hint.
    `Graphics density: ${label(GRAPHICS_DENSITY, config.graphicsDensity)}.`,
    `Spread usage: ${label(SPREAD_USAGE, config.spreadUsage)}.`,
    `Text handling: ${label(TEXT_HANDLING, config.textHandling)}.`,
    `Text placement: ${label(TEXT_PLACEMENT, config.textPlacement)}.`,
    `Layout: ${layout}.`,
    ...(config.storyBrief?.pictureNotes?.trim()
      ? [
          `Author's notes for the illustrations (show these in the pictures; never print them): ${config.storyBrief.pictureNotes.trim()}`,
        ]
      : []),
  ].join("\n");
}

function describeReader(config: BookConfig, overlays: AudienceOverlays): string {
  const mode =
    overlays.profile.readingModes.length > 0 && config.readingModeId
      ? ` Reading mode: ${readingModeLabel(config.readingModeId)}.`
      : "";
  return `Age range: ${overlays.profile.label}.${mode}`;
}

function describeAnchors(anchors: Anchor[]): string {
  if (anchors.length === 0) return "(none)";
  return anchors
    .map((a) => {
      const look = a.lookFromArt?.trim();
      const description = visualDescription(a.name, look || a.description);
      const fromArt = a.sourceArt?.length
        ? " Match the author's drawing; the name is a label only."
        : "";
      const also = (a.aliasNames ?? []).map((alias) => alias.trim()).filter(Boolean);
      return `- ${a.name} [${a.type}]${also.length > 0 ? ` (also called: ${also.join("; ")})` : ""}: ${description}${fromArt}`;
    })
    .join("\n");
}

/**
 * What the page plan reads. The author's own words are laid out as written:
 * only split across pages, never reworded. That holds for a story the parent
 * wrote, and for one the app wrote with them in the chat, because the parent
 * read it and said yes: a book that prints a different story than the one they
 * approved is wrong however well it reads. Only a book made without a brief
 * (the studio) keeps its text-handling choice. Their title lines go on the
 * cover, not on page 1, and the pages or sections they marked stay theirs.
 */
export function pagePlanInput(input: BookConfig): {
  config: BookConfig;
  story: string;
  splitNote: string;
  /** The words are printed exactly as written. */
  exact: boolean;
} {
  const own = input.storyBrief?.mode === "own";
  const exact = own || Boolean(input.storyBrief) || input.textHandling === "exact";
  const config: BookConfig = exact ? { ...input, textHandling: "exact" } : input;
  const manuscript = readManuscript(config.storyText, { heading: own });
  return { config, story: storyForPages(manuscript), splitNote: splitGuidance(manuscript), exact };
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
  /**
   * Read the finished plan a second time for pictures that are unfit for the
   * age, invent someone or contradict their page, and have those fixed. One
   * more model call, so it is asked for, and never on a requested revision.
   */
  review?: boolean;
}

const reviewSchema = z.object({
  issues: z.array(
    z.object({
      page: z.number().int(),
      kind: z.enum(["age", "invented", "contradiction", "crowded"]),
      problem: z.string(),
      fix: z.string(),
    }),
  ),
});

const REVIEW_MAX_ISSUES = 5;

/**
 * How long into a generation another model call may still start. A task has
 * four minutes; a call takes up to about a minute, so a repair may begin in
 * the first minute and a re-cut of the pages in the first three.
 */
const REPAIR_MAY_START_MS = 100_000;
const RECUT_MAY_START_MS = 170_000;
/** The review is a short call; the fix it asks for is a full one. */
const REVIEW_MAY_START_MS = 110_000;
const REVIEW_FIX_MAY_START_MS = 160_000;

/** The plan as the reviewer reads it: one block per page. */
function planTextOf(doc: ScreenplayDoc, included: Anchor[]): string {
  const nameOf = (id: string) => included.find((a) => a.id === id)?.name ?? "";
  return doc.spreads
    .map((s, i) =>
      [
        `Page ${i + 1} (${s.kind})`,
        `Words: ${s.wordless || !s.text.trim() ? "(none)" : s.text.replace(/\n+/g, " / ")}`,
        `Picture: ${s.illustration}`,
        `People and places: ${s.anchorIds.map(nameOf).filter(Boolean).join(", ") || "(none)"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

/** The plan as the model reads it back in a revision or a repair. */
function previousJsonOf(doc: ScreenplayDoc, included: Anchor[]): string {
  const nameOf = (id: string) => included.find((a) => a.id === id)?.name;
  return JSON.stringify(
    {
      notes: doc.notes,
      frontCover: doc.frontCover,
      backCover: doc.backCover,
      spineText: doc.spine?.text ?? "",
      spreads: doc.spreads.map((s) => ({
        kind: s.kind,
        text: s.text,
        illustration: s.illustration,
        layoutNote: s.layoutNote,
        continuity: s.continuity ?? "",
        wardrobe: (s.wardrobe ?? []).map((w) => ({ anchor: nameOf(w.anchorId) ?? "", outfit: w.outfit })),
        wordless: Boolean(s.wordless),
        anchors: effectiveAnchorIds(included, s)
          .map((id) => nameOf(id))
          .filter(Boolean),
      })),
    },
    null,
    2,
  );
}

export async function generateScreenplay(
  input: GenerateScreenplayInput,
): Promise<ScreenplayDoc> {
  const startedAt = Date.now();
  const { anchors, creds, model, edit, previous, signal, prompts } = input;
  const { config, story, splitNote, exact } = pagePlanInput(input.config);
  const provider = getTextProvider(config.textModel!.provider);
  const included = anchors.filter((a) => a.include);
  const language = getBookLanguage(config.contentLocale);
  const brief = briefOf(config);
  const heroNames = namedHeroes(brief);

  const spreadGuidance =
    config.spreadUsage === "single"
      ? "Use only single pages (kind = 'single')."
      : config.spreadUsage === "double"
        ? "Use double-page spreads (kind = 'spread') for the illustrations."
        : "Mix single pages and double-page spreads for good pacing.";

  const textGuidance = [
    exact
      ? "Keep the author's wording EXACTLY as written; only split it across pages. Do not rewrite. Every word of the story is on exactly one page, in order, and nothing else is added to a page's text."
      : "You may adapt and tighten the wording to suit the age range and reading rhythm.",
    splitNote,
  ]
    .filter(Boolean)
    .join(" ");

  const placementGuidance = getBookLayout(config.layoutId).screenplayGuidance;

  // The SCREENPLAY channel, not the story one: page structure, visual
  // storytelling and pacing, without the prose rules the drafting model already
  // applied. Pagination is also the only stage where per-page density can be
  // stated at all, which is why the numbers ride along here.
  const overlays = resolveAudienceOverlays(config.ageRangeId, config.readingModeId, prompts, {
    wordFactor: language.wordCountFactor,
    hasPageTarget: Boolean(config.pageTarget),
  });
  const { profile } = overlays;

  // The book's chosen style (rhyme, refrain, cumulative…) was applied when the
  // story was written. The plan only needs to know it so it keeps it whole.
  const craft = resolveStoryCraftFor(config.ageRangeId, prompts);
  const deviceGuidance = optionsGuidance(
    craft.devices,
    brief.deviceIds && brief.deviceIds.length > 0 ? brief.deviceIds : (brief.deviceId ?? undefined),
    brief.customDevice,
  );
  const hasVerse = verseBlocks(story).length > 0;

  const plannedPages =
    config.pageTarget?.pages ?? Math.round((profile.density.minPages + profile.density.maxPages) / 2);
  const wordlessMax = wordlessAllowance(plannedPages, {
    exact,
    independent: config.readingModeId === "independent",
  });

  const callModel = async (args: {
    edit?: string;
    previous?: ScreenplayDoc;
    fixedPages?: string[];
    temperature: number;
  }): Promise<RawScreenplay> => {
    const isRevision = Boolean(args.edit && args.previous);
    const { system, user } = renderTextPrompt(resolvePromptsConfig(prompts), "screenplay", {
      vars: {
        spreadGuidance,
        textGuidance,
        ageGuidance: overlays.screenplay,
        densityGuidance: overlays.density,
        languageInstruction: language.promptInstruction,
        placementGuidance,
        configDescription: describeConfig(config, overlays),
        anchorsList: describeAnchors(included),
        story,
        previousJson: isRevision ? previousJsonOf(args.previous!, included) : "",
        edit: args.edit?.trim() ?? "",
        targetPages: config.pageTarget?.pages ?? "",
        wordsPerPage: config.pageTarget?.wordsPerPage ?? "",
        pageCase:
          config.pageTarget?.case === "thin"
            ? "thin stretch"
            : config.pageTarget?.case === "spread"
              ? "spread"
              : "natural length",
        deviceGuidance,
        safetyList: overlays.safetyList,
        safetyNote: overlays.safetyNote,
        wordlessMax,
        fixedCount: args.fixedPages?.length ?? 0,
        fixedPages: (args.fixedPages ?? []).map((text, i) => `Page ${i + 1}:\n${text}`).join("\n\n"),
      },
      flags: {
        isRevision,
        hasDensity: Boolean(overlays.density),
        hasPageTarget: Boolean(config.pageTarget),
        isSpread: config.pageTarget?.case === "spread",
        isThin: config.pageTarget?.case === "thin",
        hasVerse,
        hasDevice: Boolean(deviceGuidance),
        hasSafety: Boolean(overlays.safetyList),
        allowsWordless: wordlessMax > 0,
        hasFixedPages: Boolean(args.fixedPages?.length),
      },
    });

    return withRetry(
      () =>
        provider.generateStructured<RawScreenplay>(creds, {
          model,
          schema: screenplaySchema,
          schemaName: "screenplay",
          temperature: args.temperature,
          maxOutputTokens: 16_384,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          signal,
        }),
      { signal },
    );
  };

  const reviewPlan = async (doc: ScreenplayDoc): Promise<{ page: number; problem: string; fix: string }[]> => {
    const { system, user } = renderTextPrompt(resolvePromptsConfig(prompts), "screenplayReview", {
      vars: {
        reader: describeReader(config, overlays),
        anchorsList: describeAnchors(included),
        story,
        planText: planTextOf(doc, included),
        maxIssues: REVIEW_MAX_ISSUES,
        safetyList: overlays.safetyList,
      },
      flags: { hasSafety: Boolean(overlays.safetyList) },
    });
    const result = await withRetry(
      () =>
        provider.generateStructured<z.infer<typeof reviewSchema>>(creds, {
          model,
          schema: reviewSchema,
          schemaName: "screenplayReview",
          temperature: 0.1,
          maxOutputTokens: 2_048,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          signal,
        }),
      { signal },
    );
    // Only a real page, and no more than asked: the model's list is a request, not an order.
    return result.issues
      .filter((i) => i.page >= 1 && i.page <= doc.spreads.length && i.problem.trim())
      .slice(0, REVIEW_MAX_ISSUES)
      .map((i) => ({ page: i.page, problem: i.problem.trim(), fix: i.fix.trim() }));
  };

  const baseTemperature = exact ? 0.2 : 0.6;
  const earlier = edit ? previous : undefined;

  /** Map, put everyone the words name on their page, and read the result. */
  const read = (raw: RawScreenplay): { doc: ScreenplayDoc; check: ScreenplayCheck } => {
    const mapped = mapScreenplay(raw, included, earlier, anchors);
    const doc = completeScreenplayCast(mapped.doc, included, heroNames);
    return { doc, check: inspect(doc, mapped.names) };
  };
  const inspect = (doc: ScreenplayDoc, names: NameIssue[]): ScreenplayCheck =>
    inspectScreenplay({
      doc,
      anchors: included,
      story,
      exact,
      // A requested edit may change the words; the story is then not the measure.
      checkText: !edit && Boolean(story.trim()),
      profile,
      wordFactor: language.wordCountFactor,
      names,
      wordlessAllowed: Math.max(wordlessMax, wordlessAllowance(doc.spreads.length, { exact, independent: config.readingModeId === "independent" })),
    });
  const hasTextProblem = (check: ScreenplayCheck) => check.problems.some((p) => p.code === "text-mismatch");

  let current = read(await callModel({ edit, previous, temperature: baseTemperature }));

  // The words are not the author's: re-cut the pages here, and have the model
  // write only the pictures for them. No amount of asking is as sure as this.
  if (hasTextProblem(current.check)) {
    const recut = splitStoryIntoPages(story, {
      wordsPerPage: config.pageTarget?.wordsPerPage || Math.round(profile.density.targetWordsPerPage * language.wordCountFactor) || 40,
      pages: config.pageTarget?.pages,
    });
    if (Date.now() - startedAt > RECUT_MAY_START_MS || recut.length === 0) {
      throw new Error("The page plan did not keep the story's words. Nothing was changed; please try again.");
    }
    console.warn(`[screenplay] pages did not carry the story; re-cut into ${recut.length} pages: ${current.check.problems[0]?.message}`);
    const raw = await callModel({ fixedPages: recut, temperature: 0.2 });
    current = read(withFixedTexts(raw, recut));
    if (hasTextProblem(current.check)) {
      throw new Error("The page plan did not keep the story's words. Nothing was changed; please try again.");
    }
  } else if (current.check.instruction && Date.now() - startedAt < REPAIR_MAY_START_MS) {
    // Anything else wrong is sent back once, as a request to fix those pages.
    const repaired = read(
      await callModel({ edit: current.check.instruction, previous: current.doc, temperature: 0.2 }),
    );
    // Keep the better of the two; a repair that loses the words never wins.
    if (repaired.check.score <= current.check.score) current = repaired;
  }

  // A second reading, for what only a reader notices: a picture that is wrong
  // for the age, someone the story does not have, a picture against its words.
  if (input.review && !edit && Date.now() - startedAt < REVIEW_MAY_START_MS) {
    try {
      const found = await reviewPlan(current.doc);
      if (found.length > 0 && Date.now() - startedAt < REVIEW_FIX_MAY_START_MS) {
        const instruction = `Fix only these pictures, and change nothing else: every page's words stay exactly as they are, and so does every other page.\n${found
          .map((issue) => `- Page ${issue.page}: ${issue.problem} ${issue.fix}`)
          .join("\n")}`;
        const fixed = read(await callModel({ edit: instruction, previous: current.doc, temperature: 0.2 }));
        // A fix that costs the plan anything else is not taken.
        if (fixed.check.score <= current.check.score) current = fixed;
        else console.warn("[screenplay] the review's fix made the plan worse; kept the first plan");
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn(`[screenplay] review skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (current.check.problems.length > 0) {
    console.warn(
      `[screenplay] ${current.check.problems.length} problem(s) left: ${current.check.problems.map((p) => `${p.code}@${p.page ?? "-"}`).join(", ")}`,
    );
  }

  // Printable without adding a page: a spread that would start on a right-hand
  // page becomes a single page. fixPagination is the last guard, and does
  // nothing once that has run.
  return fixPagination(fitSpreadsToPages(current.doc).doc);
}

/** The model's plan with each page's text replaced by the one cut in code. */
function withFixedTexts(raw: RawScreenplay, pages: string[]): RawScreenplay {
  const last = raw.spreads[raw.spreads.length - 1];
  const spreads = pages.map((text, i) => {
    const own = raw.spreads[i] ?? last;
    return own
      ? { ...own, text, wordless: false }
      : { kind: "single" as const, text, illustration: "", layoutNote: "", continuity: "", wardrobe: [], wordless: false, anchors: [] };
  });
  return { ...raw, spreads };
}

/**
 * Resolve a list of LLM-provided anchor names to ids, tolerantly. Returns the
 * matched ids (deduped) and any names that could not be resolved so the caller
 * can warn instead of silently dropping them. Duplicate anchor names are
 * surfaced as ambiguous (first match used).
 *
 * A name that is not exactly an anchor's name or alias still resolves when it
 * holds exactly ONE anchor's name as whole words ("Mia (the girl)"), or sits
 * wholly inside exactly one anchor's name. Anything that could be two people
 * ("Mia's teddy" next to Mia and Teddy) stays unresolved rather than guessed:
 * a guess attaches the wrong person's reference sheet to the page.
 */
export function matchAnchorNames(
  names: string[],
  anchors: Anchor[],
): { ids: string[]; unmatched: string[]; ambiguous: string[] } {
  const byNorm = new Map<string, string[]>();
  const canonicalKeys: { key: string; ids: string[] }[] = [];
  const push = (key: string, id: string, canonical: boolean) => {
    const ids = byNorm.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    byNorm.set(key, ids);
    if (canonical) canonicalKeys.push({ key, ids });
  };
  for (const a of anchors) {
    const key = normalizeAnchorName(a.name);
    if (key) push(key, a.id, true);
    for (const aliasKey of anchorNameKeys(a)) {
      if (aliasKey !== key) push(aliasKey, a.id, false);
    }
  }

  const ids: string[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const seen = new Set<string>();

  const unique = (list: { ids: string[] }[]): string[] | undefined => {
    const all = [...new Set(list.flatMap((entry) => entry.ids))];
    return all.length === 1 ? all : undefined;
  };

  for (const raw of names) {
    const norm = normalizeAnchorName(raw);
    if (!norm) continue;
    let hit = byNorm.get(norm);
    // Canonical names only, so an alias like "blue toy elephant" does not
    // swallow a lone color word.
    if (!hit) {
      const words = ` ${norm} `;
      hit =
        unique(canonicalKeys.filter(({ key }) => words.includes(` ${key} `))) ??
        unique(canonicalKeys.filter(({ key }) => ` ${key} `.includes(words)));
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
function mapScreenplay(
  raw: RawScreenplay,
  anchors: Anchor[],
  previous?: ScreenplayDoc,
  /** Every anchor the book has, left-out ones too: something the author left out is not missing. */
  every: Anchor[] = anchors,
): { doc: ScreenplayDoc; names: NameIssue[] } {
  const names: NameIssue[] = [];
  const nameById = new Map(anchors.map((a) => [a.id, a.name]));
  // Resolve LLM-provided names to ids AND record the canonical anchor name in
  // the same slot, so the reference can self-heal by name if ids ever drift.
  const toRefs = (
    listed: string[],
    page: NameIssue["page"],
  ): { anchorIds: string[]; anchorNames: string[] } => {
    const { ids, unmatched, ambiguous } = matchAnchorNames(listed, anchors);
    unmatched.forEach((name) => names.push({ page, name, kind: "unknown" }));
    ambiguous.forEach((name) => names.push({ page, name, kind: "ambiguous" }));
    return { anchorIds: ids, anchorNames: ids.map((id) => nameById.get(id) ?? "") };
  };

  const spreads: ScreenplaySpread[] = raw.spreads.map((s, i) => {
    // A model writes a line break as a real one or as the two characters \n.
    const text = restoreModelLineBreaks(s.text);
    const wardrobe = (s.wardrobe ?? []).flatMap((entry) => {
      const outfit = entry.outfit.trim();
      const { ids } = matchAnchorNames([entry.anchor], anchors);
      return outfit && ids[0] ? [{ anchorId: ids[0], outfit }] : [];
    });
    const continuity = (s.continuity ?? "").trim();
    return {
      id: uid(),
      kind: s.kind,
      text,
      illustration: s.illustration,
      layoutNote: s.layoutNote,
      ...(continuity ? { continuity } : {}),
      ...(wardrobe.length > 0 ? { wardrobe } : {}),
      // Wordless is only ever on purpose: a page that has words is not.
      ...(s.wordless && !text.trim() ? { wordless: true } : {}),
      ...toRefs(s.anchors, i + 1),
    };
  });
  // Only what the book really has no anchor for: a name that resolves to one is listed.
  const unlisted = [
    ...new Set(
      (raw.unlisted ?? [])
        .map((name) => name.trim().slice(0, 80))
        .filter((name) => name && matchAnchorNames([name], every).ids.length === 0),
    ),
  ].slice(0, UNLISTED_MAX);
  const doc: ScreenplayDoc = {
    notes: raw.notes,
    spreads,
    ...(unlisted.length > 0 ? { unlisted } : {}),
    frontCover: {
      title: raw.frontCover.title,
      subtitle: raw.frontCover.subtitle,
      illustration: raw.frontCover.illustration,
      ...toRefs(raw.frontCover.anchors, "front"),
    },
    // The back cover carries no words of its own: only words the reader added survive a revision.
    backCover: {
      title: previous?.backCover?.title ?? "",
      subtitle: previous?.backCover?.subtitle ?? "",
      illustration: raw.backCover.illustration,
      ...toRefs(raw.backCover.anchors, "back"),
    },
    spine: { text: raw.spineText },
  };

  if (names.length > 0) {
    console.warn(
      `[screenplay] ${names.length} anchor name(s) from the model did not resolve to exactly one anchor: ${names.map((n) => `${n.name} (${n.kind})`).join(", ")}`,
    );
  }
  return { doc, names };
}
