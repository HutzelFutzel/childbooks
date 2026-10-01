/**
 * Invariants for the words on the front cover: what it says, when the Chat
 * asks, and what happens when the painted words come out wrong.
 *
 * The claims worth checking are the ones a parent would notice:
 *
 * - the cover says what the cover card showed: the story's title, and only the
 *   subtitle and author the reader chose ("" means none, a plan's invented
 *   subtitle is only an idea);
 * - Looks good settles the card; changing it brings the card back, and Draw
 *   the book waits for it;
 * - author ideas speak the book's language and name the relatives in the story;
 * - a painted word is accepted only when every word is spelled right, inside
 *   the safe area, with no stray writing, and a cover that fails twice is drawn
 *   plain so the text layer carries its words;
 * - the text layer follows the artwork actually there, and a job's slim
 *   snapshot still knows the cover's words.
 *
 * Offline and deterministic: pure functions over synthesized books, and a fake
 * draw and read for the lettering loop.
 */
import {
  bakedTextOf,
  coverLetteringAllowed,
  coverLinesOf,
  PLACEHOLDER_TITLE,
} from "../books-frontend/src/core/book/coverLines";
import { slimProjectForRender } from "../books-frontend/src/core/book/slimProject";
import { coverSpread } from "../books-frontend/src/core/book/units";
import { createDefaultBookLanguagesConfig } from "../books-frontend/src/core/config/bookLanguages";
import { createDefaultDesign, textFromParagraphs, type BookDesign } from "../books-frontend/src/core/design";
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import { firstUnmet } from "../books-frontend/src/core/guide/agent/requirements";
import type { CommandContext } from "../books-frontend/src/core/guide/agent/types";
import { authorIdeas, coverCardLines, coverWordsSettled, subtitleIdeas } from "../books-frontend/src/core/guide/coverWords";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import {
  coverLetteringSafeArea,
  judgeLettering,
  type LetteringReading,
} from "../books-frontend/src/core/pipeline/coverLettering";
import { applyIllustrationRender, drawCoverLettering } from "../books-frontend/src/core/pipeline/illustrationRun";
import { cleanSubtitleIdeas } from "../books-frontend/src/core/pipeline/storyDraft";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import {
  COVER_FRONT_ID,
  createDefaultConfig,
  type BakedCoverText,
  type IllustrationImage,
  type Project,
  type ScreenplayDoc,
  type StoryCastMember,
} from "../books-frontend/src/core/types";
import { createVersionTree, getCursor } from "../books-frontend/src/core/versioning";
import { buildDesignPages, reconcileCoverLettering, seedPageDesign } from "../books-frontend/src/ui/design/designInit";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

const ctx: CommandContext = { now: 1, guest: false, styles: [], languages: [] };
const TITLE = "The Blanket Fort";
const PLAN_SUBTITLE = "A Map Inside";

function book(options: { locale?: Project["config"]["contentLocale"]; cast?: StoryCastMember[]; title?: string } = {}): Project {
  const doc: ScreenplayDoc = {
    notes: "",
    spreads: [],
    frontCover: { title: TITLE, subtitle: PLAN_SUBTITLE, illustration: "A fort of blankets.", anchorIds: [] },
  };
  return {
    id: "cover-book",
    title: options.title ?? TITLE,
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: {
      ...createDefaultConfig(),
      storyText: "Maya and Leo built a fort out of blankets and found a map inside.",
      contentLocale: options.locale ?? "en-US",
      storyBrief: { ...createDefaultStoryBrief("guided"), cast: options.cast ?? [] },
    },
    screenplay: createVersionTree(doc),
  };
}

const withCover = (project: Project, cover: NonNullable<ReturnType<typeof authoringOf>["cover"]>): Project =>
  withAuthoring(project, { cover: { ...authoringOf(project).cover, ...cover } });

const withFrontArt = (project: Project, art: Partial<IllustrationImage> & { blobId: string }): Project => ({
  ...project,
  illustrations: {
    ...project.illustrations,
    [COVER_FRONT_ID]: createVersionTree<IllustrationImage>({ mimeType: "image/png", ...art }),
  },
});

// --- One source for the cover's words ----------------------------------------------------------------

{
  const plain = book();
  const lines = coverLinesOf(plain);
  check(lines.title === TITLE, "The cover's title is not the book's title.");
  check(lines.subtitle === PLAN_SUBTITLE, "Without a choice, the cover lost the page plan's subtitle.");
  check(coverLinesOf(book({ title: PLACEHOLDER_TITLE })).title === "", `"${PLACEHOLDER_TITLE}" would be printed on a cover.`);
  const none = withCover(plain, { subtitle: "", author: "" });
  check(coverLinesOf(none).subtitle === "", 'Choosing "None" still prints the plan\'s subtitle.');
  const chosen = withCover(plain, { subtitle: "A Bedtime Story", author: "Uncle David" });
  check(
    coverLinesOf(chosen).subtitle === "A Bedtime Story" && coverLinesOf(chosen).author === "Uncle David",
    "The reader's subtitle and author are not what the cover says.",
  );
  check(coverCardLines(plain).subtitle === "", "The cover card shows a subtitle the reader never chose.");
  check(!("author" in bakedTextOf(coverLinesOf(plain))), "An empty author line is baked as an empty word.");
}

// --- What gets painted in ------------------------------------------------------------------------------

{
  const spec = getCursor(book().screenplay!).content.frontCover!;
  const painted = withCover(book(), { subtitle: "", author: "Mom & Dad", painted: true });
  const spread = coverSpread(COVER_FRONT_ID, spec, painted);
  check(spread.bakeText === true && spread.textMode === "in-image", "A painted cover is not drawn with its words in.");
  check(spread.coverTitle === TITLE && spread.coverAuthor === "Mom & Dad", "The painted cover lost its title or author.");
  check(!spread.coverSubtitle, 'A painted cover paints a subtitle after "None".');
  const overlay = coverSpread(COVER_FRONT_ID, spec, book());
  check(!overlay.bakeText, "A cover nobody asked to paint is drawn with words in it.");
}

// --- Which languages paint ----------------------------------------------------------------------------

{
  const config = createDefaultBookLanguagesConfig();
  check(coverLetteringAllowed("en-US", config) && coverLetteringAllowed("en-GB", config), "English covers aren't painted by default.");
  check(!coverLetteringAllowed("de-DE", config), "German covers are painted before an admin allowed it.");
  const allowed = { ...config, overrides: { ...config.overrides, "de-DE": { coverLettering: true } } };
  check(coverLetteringAllowed("de-DE", allowed), "The admin's per-language switch is ignored.");
  const denied = { ...config, overrides: { ...config.overrides, "en-US": { coverLettering: false } } };
  check(!coverLetteringAllowed("en-US", denied), "Switching English off doesn't stop painted covers.");
}

// --- Looks good, and changing it -----------------------------------------------------------------------

{
  const written = book();
  const confirm = GUIDE_COMMANDS.confirmCoverWords.run(written, {}, ctx);
  check(confirm.kind === "effect" && confirm.effect.kind === "coverWords", "Looks good doesn't settle the cover.");
  const settled = withCover(written, { confirmedAt: 5 });
  check(coverWordsSettled(settled), "A confirmed cover doesn't count as settled.");
  check(GUIDE_COMMANDS.confirmCoverWords.run(settled, {}, ctx).kind === "noop", "Looks good twice settles it twice.");
  const change = GUIDE_COMMANDS.changeCoverWords.run(settled, {}, ctx);
  check(change.kind === "write" && !coverWordsSettled(change.project), "Changing the cover's words doesn't bring the card back.");

  const drawBook = GUIDE_COMMANDS.drawBook;
  check(drawBook.requires.includes("coverWords"), "Draw the book doesn't wait for the cover's words.");
  check(firstUnmet(written, ["coverWords"], ctx)?.requirement === "coverWords", "An unsettled cover isn't reported as missing.");
  check(firstUnmet(settled, ["coverWords"], ctx) === null, "A settled cover still blocks Draw the book.");

  const author = GUIDE_COMMANDS.setAuthor.run(written, { author: '"Uncle David"' }, ctx);
  check(author.kind === "effect" && author.effect.kind === "author" && author.effect.author === "Uncle David", "The author skill keeps the quotes.");
  const noAuthor = GUIDE_COMMANDS.setAuthor.run(written, { author: "" }, ctx);
  check(noAuthor.kind === "effect" && noAuthor.effect.kind === "author" && noAuthor.effect.author === "", '"No author" isn\'t recorded as a choice.');
  const noneTwice = GUIDE_COMMANDS.setAuthor.run(withCover(written, { author: "" }), { author: "" }, ctx);
  check(noneTwice.kind === "noop", '"No author" twice is not already that way.');
  const subtitle = GUIDE_COMMANDS.setSubtitle.run(written, { subtitle: PLAN_SUBTITLE }, ctx);
  check(subtitle.kind === "effect", "Picking the plan's subtitle idea is treated as already chosen.");
}

// --- Ideas ---------------------------------------------------------------------------------------------

{
  const uncle: StoryCastMember = { id: "c1", name: "David", role: "Maya's uncle" };
  const us = authorIdeas(book({ cast: [uncle] }));
  check(us[0] === "Uncle David" && us.includes("Mom & Dad") && us.includes("Grandma & Grandpa"), `US author ideas: ${us.join(", ")}.`);
  check(authorIdeas(book({ locale: "en-GB" })).includes("Mum & Dad"), "British books offer Mom & Dad.");
  const de = authorIdeas(book({ locale: "de-DE", cast: [{ id: "c1", name: "Anna", role: "Tante" }] }));
  check(de[0] === "Tante Anna" && de.includes("Mama & Papa") && de.includes("Oma & Opa"), `German author ideas: ${de.join(", ")}.`);
  check(authorIdeas(book({ locale: "fr-FR" })).length === 0, "A French book is offered English author names.");
  check(us.length <= 3, "More than three author ideas.");

  const withIdeas = withCover(book(), { subtitleIdeas: ["A Bedtime Story", "A Map Inside", "An Indoor Adventure"] });
  const ideas = subtitleIdeas(withIdeas);
  check(ideas.length === 3 && new Set(ideas).size === 3, `Subtitle ideas repeat or overflow: ${ideas.join(", ")}.`);
  check(subtitleIdeas(book()).includes(PLAN_SUBTITLE), "The plan's subtitle isn't offered as an idea.");
  const cleaned = cleanSubtitleIdeas(["The Blanket Fort!", "  A Bedtime Story ", "a bedtime story", "x".repeat(90), "One", "Two"], TITLE);
  check(cleaned.length <= 3, "The story draft keeps more than three subtitle ideas.");
  check(!cleaned.some((idea) => idea.toLowerCase().includes("blanket fort")), "A subtitle idea repeats the title.");
  check(cleaned[0] === "A Bedtime Story" && cleaned.filter((i) => i.toLowerCase() === "a bedtime story").length === 1, `Subtitle ideas aren't trimmed and distinct: ${cleaned.join(" | ")}.`);
  check(!cleaned.some((idea) => idea.length > 80), "A subtitle idea too long for a cover is kept.");
}

// --- Reading the painted words back ------------------------------------------------------------------

const EXPECTED: BakedCoverText = { title: TITLE, subtitle: "A Bedtime Story", author: "Uncle David" };
const safe = coverLetteringSafeArea(createDefaultConfig());
const inside = { x: 0.3, y: 0.3, w: 0.4, h: 0.1 };
const reading = (changes: Partial<LetteringReading["lines"]> = {}, other: string[] = []): LetteringReading => ({
  lines: {
    title: { found: true, text: "THE BLANKET\nFORT", box: inside },
    subtitle: { found: true, text: "A Bedtime Story", box: inside },
    author: { found: true, text: "by Uncle David", box: inside },
    ...changes,
  },
  other,
});

{
  check(safe.x > 0 && safe.x < 0.15 && Math.abs(safe.x + safe.w - (1 - safe.x)) < 1e-9, "The lettering safe area isn't a symmetric inset.");
  check(judgeLettering(EXPECTED, reading(), safe).ok, `A right cover is rejected: ${judgeLettering(EXPECTED, reading(), safe).problems.join("; ")}.`);
  check(!judgeLettering(EXPECTED, reading({ title: { found: true, text: "The Blanket Frot", box: inside } }), safe).ok, "A misspelled title passes.");
  check(!judgeLettering(EXPECTED, reading({ author: { found: false, text: "" } }), safe).ok, "A missing author passes.");
  check(!judgeLettering(EXPECTED, reading({ title: { found: true, text: TITLE, box: { x: 0.01, y: 0.3, w: 0.5, h: 0.1 } } }), safe).ok, "A title in the trim passes.");
  check(!judgeLettering(EXPECTED, reading({}, ["Once upon"]), safe).ok, "Stray writing passes.");
  check(judgeLettering(EXPECTED, reading({}, ["*"]), safe).ok, "A single stray mark fails the cover.");
  const noSubtitle = { title: TITLE, author: "Uncle David" };
  check(!judgeLettering(noSubtitle, reading(), safe).ok, "A subtitle nobody asked for passes.");
  check(!judgeLettering(EXPECTED, reading({ title: { found: true, text: "by The Blanket Fort", box: inside } }), safe).ok, '"by" is tolerated on the title.');
}

// --- Redraw, then fall back ----------------------------------------------------------------------------

async function lettering(readings: (LetteringReading | null)[], options: { check?: boolean; deadlineMs?: number } = {}) {
  const spread = coverSpread(COVER_FRONT_ID, getCursor(book().screenplay!).content.frontCover!, withCover(book(), EXPECTED_CHOICE));
  const draws: boolean[] = [];
  let reads = 0;
  const result = await drawCoverLettering({
    spread,
    safe,
    startedAt: Date.now(),
    check: options.check ?? true,
    deadlineMs: options.deadlineMs,
    draw: async (bake) => {
      draws.push(bake);
      return { prompt: bake ? "with words" : "plain", image: { base64: "", mimeType: "image/png", model: "fake" } };
    },
    read: async () => readings[reads++] ?? null,
  });
  return { result, draws, reads };
}
const EXPECTED_CHOICE = { subtitle: "A Bedtime Story", author: "Uncle David", painted: true };
const good = reading();
const bad = reading({ title: { found: true, text: "The Blanket Frot", box: inside } });

async function checkLetteringLoop(): Promise<void> {
  const first = await lettering([good]);
  check(first.draws.length === 1 && first.result.lettering?.outcome === "passed", "A right first cover is redrawn.");
  check(first.result.textMode === "in-image" && first.result.bakedText?.author === "Uncle David", "A passed cover doesn't record its words.");

  const second = await lettering([bad, good]);
  check(second.draws.join() === "true,true" && second.result.lettering?.outcome === "passed" && second.result.lettering.attempts === 2, "A wrong cover isn't redrawn once.");

  const fallback = await lettering([bad, bad]);
  check(fallback.draws.join() === "true,true,false", `Two wrong covers don't fall back to a plain drawing (draws: ${fallback.draws.join()}).`);
  check(fallback.result.textMode === "overlay" && !fallback.result.bakedText, "A plain fallback claims to carry the words.");
  check(fallback.result.lettering?.outcome === "fellBack" && (fallback.result.lettering.problems?.length ?? 0) > 0, "A fallback doesn't say why.");

  const unchecked = await lettering([null]);
  check(unchecked.draws.length === 1 && unchecked.result.lettering?.outcome === "unchecked", "A check that can't run costs a redraw.");

  const masked = await lettering([bad], { check: false });
  check(masked.reads === 0 && masked.result.textMode === "in-image", "A masked touch-up is read back.");

  const late = await lettering([bad], { deadlineMs: -1 });
  check(late.draws.length === 1 && late.result.lettering?.outcome === "failed", "A wrong cover past the deadline is redrawn anyway.");

  const render = {
    blobId: "b2",
    mimeType: "image/png",
    references: [],
    prompt: "plain",
    label: "Front cover",
    textMode: "overlay" as const,
    lettering: { outcome: "fellBack" as const, attempts: 2 },
  };
  const tree = applyIllustrationRender(undefined, render);
  check(getCursor(tree).content.lettering?.outcome === "fellBack", "The lettering outcome isn't saved with the artwork.");
}

// --- The text layer follows the artwork ----------------------------------------------------------------

function designed(project: Project): Project {
  const base: BookDesign = createDefaultDesign("Nunito", 0.05);
  const pages = buildDesignPages(project);
  const front = pages.find((page) => page.id === COVER_FRONT_ID)!;
  return { ...project, design: { ...base, pages: { [COVER_FRONT_ID]: seedPageDesign(base, front) } } };
}
const coverBoxes = (project: Project) =>
  (project.design?.pages[COVER_FRONT_ID]?.textBoxes ?? []).filter((box) => box.role?.startsWith("book-"));

{
  const chosen = withCover(book(), EXPECTED_CHOICE);
  const lettered = withFrontArt(chosen, { blobId: "a1", textMode: "in-image", bakedText: EXPECTED });
  const seeded = designed(withFrontArt(chosen, { blobId: "a0", textMode: "overlay" }));
  check(
    coverBoxes(seeded).some((b) => b.role === "book-author" && textFromParagraphs(b.paragraphs) === "Uncle David"),
    "The author has no text box on the cover.",
  );
  check(coverBoxes(seeded).every((b) => !b.hidden), "A plain cover hides its words.");

  const onLettered = reconcileCoverLettering({ ...seeded, illustrations: lettered.illustrations });
  check(coverBoxes(onLettered).length > 0 && coverBoxes(onLettered).every((b) => b.hidden), "Words painted in are printed twice.");

  const fellBack = withFrontArt(onLettered, { blobId: "a2", textMode: "overlay", lettering: { outcome: "fellBack", attempts: 2 } });
  const shown = reconcileCoverLettering(fellBack);
  check(coverBoxes(shown).every((b) => !b.hidden), "A cover that fell back to plain art has no words.");
  check(reconcileCoverLettering(shown) === shown, "Reconciling twice rewrites the design.");

  const legacyPage = { ...seeded.design!.pages[COVER_FRONT_ID]!, letteringFor: undefined };
  const legacy = { ...seeded, design: { ...seeded.design!, pages: { [COVER_FRONT_ID]: legacyPage } }, illustrations: lettered.illustrations };
  const stamped = reconcileCoverLettering(legacy);
  check(
    stamped.design?.pages[COVER_FRONT_ID]?.letteringFor === "a1" &&
      JSON.stringify(coverBoxes(stamped)) === JSON.stringify(coverBoxes(legacy)),
    "An older cover's hand-arranged text layer is rearranged.",
  );
}

// --- A job's snapshot keeps the cover ------------------------------------------------------------------

{
  const chosen = withCover(book(), { ...EXPECTED_CHOICE, confirmedAt: 3 });
  const slim = slimProjectForRender(chosen, { keepScreenplay: true });
  check(coverLinesOf(slim).author === "Uncle David" && authoringOf(slim).cover?.painted === true, "The server draws the cover without the reader's words.");
}

report.push("Cover words");
report.push("  one source for title, subtitle and author; Looks good settles the card before Draw the book");
report.push("  painted words read back: one redraw, then a plain cover with the words as text");

export async function checkGuideCover(): Promise<CheckResult> {
  await checkLetteringLoop();
  notes.push("Cover words: lines, painting, languages, skills, ideas, lettering check, fallback, text layer and job snapshot checked");
  return { failures, notes, report, cases };
}
