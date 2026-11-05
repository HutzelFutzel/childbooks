/**
 * Invariants for editing a page after drawing starts.
 *
 * Pure functions and prompt rendering: no network, no model call.
 */
import assert from "node:assert/strict";
import { derivedSpreadId } from "../books-frontend/src/core/book/pageEdits";
import {
  SCENE_MAX,
  cleanScene,
  hasEarlierPicture,
  REMOVED_PAGES_KEPT,
  bookWords,
  insertPage,
  isRemovedPage,
  pageKind,
  removePage,
  removedPagesOf,
  restorePage,
  withRemovedPicture,
  setPageCast,
  setPageHasPicture,
  setPageScene,
  setPageWords,
  spreadOf,
  storyOf,
} from "../books-frontend/src/core/book/pagePlan";
import { reconcilePageWords, repairPageWords, pageWordsOf } from "../books-frontend/src/core/book/pageWordsGate";
import { canonWords, rewordParagraphs, wordsOfParagraphs } from "../books-frontend/src/core/book/pageWords";
import { withSpreads } from "../books-frontend/src/core/book/pageEdits";
import { renameMentions } from "../books-frontend/src/core/guide/rename";
import { reconcileCoverWords } from "../books-frontend/src/core/book/coverWordsGate";
import { applyBookTitle, applyCoverLine, patchCoverSpec } from "../books-frontend/src/core/book/coverEdits";
import { coverLinesOf } from "../books-frontend/src/core/book/coverLines";
import { applyStructural, takeStructural } from "../books-frontend/src/core/book/changeLog";
import { applyEntry, diffDesign, diffPlan, pagesOfOps, sameValue, type ChangeEntry } from "../books-frontend/src/core/book/changeLog";
import { getCursor } from "../books-frontend/src/core/versioning";
import { collectProjectImageBlobIds } from "../books-frontend/src/core/book/blobRefs";
import { createVersionTree as tree1 } from "../books-frontend/src/core/versioning";
import { sceneSignatureOf } from "../books-frontend/src/core/book/sceneSignature";
import { boundedPageSceneRequest, hasSomethingToGoOn, sanitizePageScene } from "../books-frontend/src/core/book/pageScene";
import { describesNewMoment, pictureChangeMode } from "../books-frontend/src/core/guide/redrawMode";
import { illustrationStaleness, isIllustrationStale } from "../books-frontend/src/state/ai";
import { styleRequestIn, withoutStyleAsides } from "../books-frontend/src/core/book/styleRequest";
import { lintPromptsConfig, normalizePromptsConfig } from "../books-frontend/src/core/config/prompts";
import { textFromParagraphs, wordParagraphs, type BookDesign } from "../books-frontend/src/core/design";
import { STYLE_LOCK_BLOCK_ID, createDefaultPromptsConfig } from "../books-frontend/src/core/prompts/registry";
import { renderSinglePrompt, renderTextPrompt } from "../books-frontend/src/core/prompts/render";
import type { Project, ScreenplayDoc, ScreenplaySpread } from "../books-frontend/src/core/types";
import { createVersionTree } from "../books-frontend/src/core/versioning";

let passed = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function section(name: string): void {
  console.log(`  ${name}`);
}

// ---------------------------------------------------------------------------------------------
section("a request for another look is found, and a thing in the scene is not");

const CAUGHT: { text: string; only: boolean; keeps?: string }[] = [
  { text: "in anime style", only: true },
  { text: "Make page 4 watercolor", only: true },
  { text: "make it look like a comic", only: true },
  { text: "Redraw page 7 in pencil sketch style please", only: true },
  { text: "in the style of Studio Ghibli", only: true },
  { text: "draw it as a watercolor", only: true },
  { text: "turn the page into a collage", only: true },
  { text: "make the picture black and white", only: true },
  { text: "change the style to oil painting", only: true },
  { text: "a different art style", only: true },
  { text: "switch to anime", only: true },
  { text: "Make the whole picture sepia", only: true },
  { text: "Mach es im Aquarell-Stil", only: true },
  { text: "im Stil von Pixar", only: true },
  { text: "Zeichne die Seite als Comic", only: true },
  { text: "Ändere den Kunststil", only: true },
  { text: "Add a small dog, in watercolor style", only: false, keeps: "Add a small dog" },
  { text: "Give her an umbrella in a 3D look", only: false, keeps: "Give her an umbrella" },
  { text: "They are at the beach, in pixar style.", only: false, keeps: "They are at the beach." },
  { text: "Mia waves goodbye in crayon", only: false, keeps: "Mia waves goodbye" },
  { text: "Sie stehen am Strand im Aquarell-Stil", only: false, keeps: "Sie stehen am Strand" },
];
for (const { text, only, keeps } of CAUGHT) {
  const found = styleRequestIn(text);
  check(found.phrases.length > 0, `catches "${text}"`);
  check(found.onlyStyle === only, `"${text}" is ${only ? "only a look" : "more than a look"} (rest: "${found.rest}")`);
  if (keeps) check(found.rest === keeps, `"${text}" keeps "${keeps}" (got "${found.rest}")`);
}

const PASSES = [
  "He holds a crayon in his hand",
  "a painting on the wall",
  "she reads a comic on the sofa",
  "warmer light",
  "a red umbrella",
  "a pastel dress",
  "Make the sky pink on page 3",
  "Give her an umbrella in her left hand",
  "They sit in a clay pot",
  "She draws a picture with a pencil",
  "Remove the boy from this picture",
  "Page 5 should be at the beach instead",
  "They are in a black and white cat costume",
  "Make her dress black and white",
  "make him taller",
  "a vintage car drives by",
  "Er hält einen Buntstift in der Hand",
  "Das Bild an der Wand ist ein Aquarell von Oma",
  "Mach den Himmel rosa",
  "Sie sind am Strand und bauen eine Sandburg",
  "Add the dog from the story",
  "in the kitchen",
  "in the garden, at night",
  "",
];
for (const text of PASSES) {
  const found = styleRequestIn(text);
  check(found.phrases.length === 0, `leaves "${text}" alone (found: ${found.phrases.map((p) => p.text).join(" | ")})`);
  check(found.onlyStyle === false, `"${text}" is not only a look`);
}

check(withoutStyleAsides("Add a dog, in watercolor style") === "Add a dog", "removing a look keeps the scene");
check(withoutStyleAsides("a red umbrella") === "a red umbrella", "a scene without a look is returned as written");
{
  const mixed = styleRequestIn("make it look like a comic and add a dog");
  check(mixed.phrases.length === 1 && !mixed.onlyStyle && /add a dog/.test(mixed.rest), "a mixed request finds the look and keeps the dog");
}

// ---------------------------------------------------------------------------------------------
section("the book's look is the last thing a picture prompt says, and no setting removes it");

{
  const config = createDefaultPromptsConfig();
  const vars = { artStyle: "Soft watercolor on cream paper", pageIllustration: "A dog runs, in anime style" };
  for (const key of ["pageIllustration/default", "pageIllustration/modifySubject"]) {
    const blocks = config.templates[key]?.single ?? [];
    check(blocks.at(-1)?.id === STYLE_LOCK_BLOCK_ID, `${key} ends with the look block`);
    const text = renderSinglePrompt(config, key, { vars, flags: {} });
    check(text.includes("Soft watercolor on cream paper"), `${key} names the book's look`);
    check(/art style is fixed/i.test(text.slice(-400)), `${key} says the look is fixed at its end`);
  }

  // Switching the block off, or wording it without the look, is undone on the way in.
  const tampered = JSON.parse(JSON.stringify(config)) as typeof config;
  for (const key of ["pageIllustration/default", "pageIllustration/modifySubject"]) {
    const block = tampered.templates[key]!.single!.find((b) => b.id === STYLE_LOCK_BLOCK_ID)!;
    block.enabled = false;
    block.text = "Anything goes.";
  }
  const normalized = normalizePromptsConfig(tampered);
  for (const key of ["pageIllustration/default", "pageIllustration/modifySubject"]) {
    const block = normalized.templates[key]!.single!.find((b) => b.id === STYLE_LOCK_BLOCK_ID)!;
    check(block.enabled !== false, `${key}: the look block stays on after the dashboard turns it off`);
    check(block.text.includes("{{artStyle}}"), `${key}: the look block keeps naming the look`);
    check(
      renderSinglePrompt(normalized, key, { vars, flags: {} }).includes("Soft watercolor on cream paper"),
      `${key}: the look is still in the prompt`,
    );
  }
  // A new wording that still names the look is the admin's to keep.
  const reworded = JSON.parse(JSON.stringify(config)) as typeof config;
  reworded.templates["pageIllustration/default"]!.single!.find((b) => b.id === STYLE_LOCK_BLOCK_ID)!.text =
    "Stay in {{artStyle}} only.";
  check(
    normalizePromptsConfig(reworded).templates["pageIllustration/default"]!.single!.find((b) => b.id === STYLE_LOCK_BLOCK_ID)!.text ===
      "Stay in {{artStyle}} only.",
    "a new wording that still names the look is kept",
  );
  // Saving a config that removed it is refused with a readable error.
  let refused = false;
  try {
    lintPromptsConfig(tampered);
  } catch (error) {
    refused = /look cannot be switched off/.test((error as Error).message) && /artStyle/.test((error as Error).message);
  }
  check(refused, "a prompt config that drops the look is refused when saved");
  check(!lintFails(config), "the shipped prompts pass");
}

function lintFails(config: ReturnType<typeof createDefaultPromptsConfig>): boolean {
  try {
    lintPromptsConfig(config);
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
section("a page's words, scene, people and picture are edited the same way by the editor and the assistant");

function book(): Project {
  const spreads: ScreenplaySpread[] = [1, 2, 3].map((n) => ({
    id: `s${n}`,
    kind: "single",
    text: `Words ${n}`,
    illustration: `Scene ${n}`,
    layoutNote: "",
    anchorIds: n === 3 ? ["a1"] : ["a1", "a2"],
  }));
  const doc = { notes: "", spreads, frontCover: { illustration: "", title: "T" }, backCover: { illustration: "" } } as unknown as ScreenplayDoc;
  const anchors = [
    { id: "a1", name: "Arthur", type: "character" },
    { id: "a2", name: "Mina", type: "character" },
    { id: "a3", name: "The cave", type: "place" },
  ];
  const design: BookDesign = {
    version: 6,
    defaultFontFamily: "Itim",
    defaultFontSizePct: 0.04,
    printSettings: { bleedMode: "mirror" },
    pages: {
      s1: {
        textBoxes: [
          {
            id: "tb1",
            rect: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
            z: 1,
            role: "story-body",
            slotId: "text",
            paragraphs: [{ spans: [{ text: "Words 1" }] }],
          } as unknown as BookDesign["pages"][string]["textBoxes"][number],
        ],
        images: [
          { id: "im1", kind: "illustration", rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0, fit: "cover" } as unknown as NonNullable<
            BookDesign["pages"][string]["images"]
          >[number],
        ],
      },
    },
  };
  return {
    id: "p",
    title: "T",
    config: {},
    anchors,
    design,
    illustrations: { s1: createVersionTree({ blobId: "blob-1" }) },
    screenplay: createVersionTree(doc),
  } as unknown as Project;
}

{
  const p = book();

  // Same object back when nothing changes.
  check(setPageWords(p, "s1", "Words 1") === p, "the same words are a no-op");
  check(setPageScene(p, "s1", "Scene 1") === p, "the same scene is a no-op");
  check(setPageCast(p, "s1", ["a1", "a2"]) === p, "the same people are a no-op");
  check(setPageHasPicture(p, "s1", true) === p, "a page that has its picture, put back, is a no-op");
  check(setPageScene(p, "nope", "x") === p, "a page that isn't there is left alone");

  // Words reach the plan and the text box together.
  const worded = setPageWords(p, "s1", "A new line.");
  check(spreadOf(worded, "s1")!.text === "A new line.", "the plan has the new words");
  check(
    textFromParagraphs(worded.design!.pages.s1!.textBoxes[0]!.paragraphs) === "A new line.",
    "the text box shows the new words",
  );
  check(reconcilePageWords(p, worded) === worded, "words typed in the words field and in the box agree, so there is nothing to fix");
  const typedInBox = {
    ...p,
    design: { ...p.design!, pages: { ...p.design!.pages, s1: { ...p.design!.pages.s1!, textBoxes: [{ ...p.design!.pages.s1!.textBoxes[0]!, paragraphs: wordParagraphs("Typed here") }] } } },
  } as Project;
  check(spreadOf(reconcilePageWords(p, typedInBox), "s1")!.text === "Typed here", "words typed in the box reach the plan");
  check(setPageWords(p, "s2", "Only the plan").design === p.design, "a page with no text box keeps just the plan's words");

  // A scene never carries a look.
  const scened = setPageScene(p, "s2", "Mina climbs the hill, in watercolor style");
  check(spreadOf(scened, "s2")!.illustration === "Mina climbs the hill", "a look in a scene is taken out");
  check(setPageScene(p, "s2", "x".repeat(2000)).screenplay !== p.screenplay && spreadOf(setPageScene(p, "s2", "x".repeat(2000)), "s2")!.illustration.length === SCENE_MAX, "a scene is capped");
  check(cleanScene("make it look like a comic") === "", "a scene that is only a look is nothing");

  // Who is on the page comes from the book's cast.
  const cast = setPageCast(p, "s3", ["a2", "a1", "ghost", "a2"]);
  check(spreadOf(cast, "s3")!.anchorIds.join() === "a2,a1", "people are the ones the book knows, once each, in order");
  check(spreadOf(cast, "s3")!.anchorNames?.join() === "Mina,Arthur", "their names go with them");

  // A picture is hidden, never deleted.
  const off = setPageHasPicture(p, "s1", false);
  check(pageKind(off, "s1") === "text", "a page with words and no picture is a text page");
  check(spreadOf(off, "s1")!.completion === "text" && spreadOf(off, "s1")!.blankCanvas === true, "the page is marked as done without a picture");
  check(off.illustrations?.s1 === p.illustrations?.s1, "the picture history is kept");
  check(off.design!.pages.s1!.images![0]!.hidden === true, "the picture is hidden on the page");
  check(hasEarlierPicture(off, "s1"), "the earlier picture can be found again");
  const back = setPageHasPicture(off, "s1", true);
  check(pageKind(back, "s1") === "picture", "the picture comes back");
  check(spreadOf(back, "s1")!.completion === undefined && spreadOf(back, "s1")!.blankCanvas === undefined, "no flags are left behind");
  check(back.design!.pages.s1!.images![0]!.hidden === false, "the picture shows again");
  check(setPageHasPicture(off, "s1", false) === off, "taking the picture off twice does nothing");

  // Kinds.
  const emptied = setPageWords(setPageHasPicture(p, "s2", false), "s2", "");
  check(pageKind(emptied, "s2") === "empty", "no picture and no words is an empty page");
  check(spreadOf(emptied, "s2")!.completion === "blank", "an emptied page is blank, not text");
  const designed = {
    ...emptied,
    design: { ...emptied.design!, pages: { ...emptied.design!.pages, s2: { textBoxes: [], shapes: [{ id: "sh", kind: "star", rect: { x: 0, y: 0, w: 0.1, h: 0.1 }, z: 1 }] } } },
  } as unknown as Project;
  check(pageKind(designed, "s2") === "designed", "a page with a shape of its own is a designed page");
  check(pageKind(p, "s2") === "picture" && pageKind(p, "nope") === "empty", "a page with a picture is a picture page");

  // Adding a page.
  const added = insertPage(p, 3, { scene: "Arthur finds a lantern" });
  const addedSpread = spreadOf(added.project, added.id)!;
  check(addedSpread.illustration === "Arthur finds a lantern", "a new page has its scene");
  check(pageKind(added.project, added.id) === "picture", "a new page is a picture page");
  check(addedSpread.anchorIds.join() === "a1", "a new page at the end shows the person the page before it shows (just Arthur)");
  const between = insertPage(p, 1, {});
  check(spreadOf(between.project, between.id)!.anchorIds.join() === "a1,a2", "a page between two shows who both show");
  check(insertPage(p, 99, {}).project.screenplay !== p.screenplay, "a position past the end is the end");
  const textPage = insertPage(p, 0, { words: "For Emma.", picture: false });
  check(pageKind(textPage.project, textPage.id) === "text", "a new page of words is a text page");
  const fixed = insertPage(p, 1, { id: "sp_fixed", scene: "x" });
  check(fixed.id === "sp_fixed", "a page can be given the id a plan chose");
  check(derivedSpreadId(["a", 1]) === derivedSpreadId(["a", 1]) && derivedSpreadId(["a", 1]) !== derivedSpreadId(["a", 2]), "a derived id is stable and distinct");
}

// ---------------------------------------------------------------------------------------------
section("a picture knows what it was drawn from, and the page says when they part");

{
  check(sceneSignatureOf("Arthur  finds a lantern") === sceneSignatureOf(" arthur finds a LANTERN "), "spacing and capitals do not change what a scene says");
  check(sceneSignatureOf("Arthur finds a lantern") !== sceneSignatureOf("Arthur finds a key"), "another scene is another signature");
  check(sceneSignatureOf("") === sceneSignatureOf(undefined), "no scene has one signature");

  const base = book();
  const drawnFrom = (scene: string) =>
    createVersionTree({
      blobId: "b1",
      mimeType: "image/png",
      sceneSignature: sceneSignatureOf(scene),
      references: [
        { anchorId: "a1", versionId: "", textOnly: true },
        { anchorId: "a2", versionId: "", textOnly: true },
      ],
    } as never);
  const drawn: Project = { ...base, illustrations: { s1: drawnFrom("Scene 1") } };
  check(illustrationStaleness(drawn, "s1") === null && !isIllustrationStale(drawn, "s1"), "a picture drawn from the page's scene is current");

  const rewritten = setPageScene(drawn, "s1", "Arthur is asleep under the tree");
  check(illustrationStaleness(rewritten, "s1") === "scene", "a page whose scene changed after drawing is out of date for its scene");
  check(isIllustrationStale(rewritten, "s1"), "and the page shows as out of date");
  check(illustrationStaleness(setPageScene(drawn, "s1", " scene   1 "), "s1") === null, "retyping the same scene changes nothing");
  check(illustrationStaleness(setPageWords(drawn, "s1", "Brand new words"), "s1") === null, "new words do not make a picture out of date");
  check(illustrationStaleness(setPageCast(drawn, "s1", ["a1"]), "s1") === "looks", "someone added or taken off since drawing is out of date for its people");

  const old: Project = {
    ...base,
    illustrations: {
      s1: createVersionTree({
        blobId: "b1",
        mimeType: "image/png",
        references: [
          { anchorId: "a1", versionId: "", textOnly: true },
          { anchorId: "a2", versionId: "", textOnly: true },
        ],
      } as never),
    },
  };
  check(illustrationStaleness(setPageScene(old, "s1", "Something else entirely"), "s1") === null, "a picture drawn before scenes were recorded is never flagged for its scene");

  const hidden = setPageHasPicture(rewritten, "s1", false);
  check(illustrationStaleness(hidden, "s1") === null, "a page shown without its picture is not waiting on one");
  check(illustrationStaleness(setPageHasPicture(hidden, "s1", true), "s1") === "scene", "and is out of date again when the picture is put back");
}

// ---------------------------------------------------------------------------------------------
section("what the reader types about a drawn picture decides what happens to it");

{
  const edits = ["Arthur's hat is red", "make the sky pink", "add a small dog", "a bigger lantern", "make it blue instead of red"];
  for (const text of edits) check(pictureChangeMode(text) === "edit", `"${text}" changes the picture there`);
  const fresh = ["start over", "draw it again", "a completely different picture", "now it's night and the lantern is lit", "Instead Arthur is asleep under the tree", "that night they sleep", "stattdessen schläft Arthur"];
  for (const text of fresh) check(pictureChangeMode(text) === "new", `"${text}" draws a new picture`);
  check(pictureChangeMode("") === "new" && pictureChangeMode("   ") === "new", "nothing typed is a plain redraw");
  check(describesNewMoment("Instead Arthur is asleep") && !describesNewMoment("make it blue instead of red"), "only a leading move to another moment counts");
  check(!describesNewMoment("start over") && !describesNewMoment(""), "a request for a new picture is not another moment");
}

// ---------------------------------------------------------------------------------------------
section("a suggested scene is made safe before it is shown");

{
  const people = [
    { id: "a1", name: "Arthur" },
    { id: "a2", name: "Mina" },
  ];
  const ok = sanitizePageScene({ scene: "Arthur holds a lantern at the back of the cave.", people: ["arthur", "Mina", "Stranger", "Arthur"] }, people)!;
  check(ok.peopleIds.join() === "a1,a2", "people are matched by name, once each, and an unknown name is dropped");
  const styled = sanitizePageScene({ scene: "Arthur holds a lantern, in watercolor style.", people: [] }, people)!;
  check(!/watercolor/i.test(styled.scene) && /lantern/.test(styled.scene), "a style the model wrote is taken out and the rest kept");
  check(sanitizePageScene({ scene: "in anime style", people: [] }, people) === null, "a scene that is only a style is nothing");
  check(sanitizePageScene({ scene: "   ", people: [] }, people) === null, "an empty scene is nothing");
  check(sanitizePageScene({ scene: "x ".repeat(2000) }, people)!.scene.length <= SCENE_MAX, "a long scene is cut to the limit");

  const bounded = boundedPageSceneRequest({
    mode: "bogus" as never,
    words: "w".repeat(5000),
    scene: "s".repeat(5000),
    before: "b".repeat(5000),
    people: Array.from({ length: 50 }, (_, n) => ({ id: `p${n}`, name: `Person ${n}` })).concat([{ id: "x", name: "  " }]),
    audience: "a".repeat(500),
  });
  check(bounded.mode === "suggest", "an unknown mode is a plain suggestion");
  check(bounded.words.length <= 1500 && bounded.scene.length <= SCENE_MAX && bounded.before.length <= 400 && bounded.audience.length <= 80, "every text a client sends is bounded");
  check(bounded.people.length === 24 && bounded.people.every((person) => person.name.trim()), "the people list is bounded and has no blank names");
  check(!hasSomethingToGoOn(boundedPageSceneRequest({})) && hasSomethingToGoOn(boundedPageSceneRequest({ words: "Hello" })), "nothing to go on is told apart");

  const prompts = createDefaultPromptsConfig();
  for (const key of ["pageScene/suggest", "pageScene/rewrite"]) {
    const { system, user } = renderTextPrompt(prompts, key, {
      vars: { audience: "ages 3 to 5", scene: "Arthur in the cave", instruction: "at night", words: "Arthur found a lantern.", before: "He walks in.", after: "It glows.", people: "- Arthur" },
      flags: { hasAudience: true, hasInstruction: true, hasWords: true, hasBefore: true, hasAfter: true },
    });
    check(!/\{\{/.test(system + user), `${key} leaves no placeholder behind`);
    check(/never mention an art style/i.test(system), `${key} tells the model the look is not its to change`);
    check(/Arthur found a lantern/.test(user) && /He walks in/.test(user), `${key} gives the words and the page before`);
  }
  const bare = renderTextPrompt(prompts, "pageScene/suggest", { vars: { people: "(nobody is named yet)" }, flags: {} });
  check(!/The words on this page|The page before|The page after/.test(bare.user), "a suggestion with no words or neighbors does not mention them");
}

// ---------------------------------------------------------------------------------------------
section("a page edit is one small step that goes back on its own");

{
  const docOf = (project: Project) => getCursor(project.screenplay!).content;
  const entryFor = (before: Project, after: Project): ChangeEntry => {
    const planOps = diffPlan(docOf(before), docOf(after));
    check(planOps !== null, "a page edit is a plan edit");
    const ops = [...planOps!, ...diffDesign(before.design, after.design)];
    return { id: "c", at: 0, source: "editor", label: "x", pages: pagesOfOps(ops), ops, state: "applied" };
  };
  const base = book();

  const scened = setPageScene(base, "s1", "Arthur sleeps under the tree");
  const sceneEntry = entryFor(base, scened);
  check(sceneEntry.ops.length === 1 && sceneEntry.ops[0]!.path.join("/") === "plan/s1/illustration", "a scene edit is one property of one page");
  check(sceneEntry.pages.join() === "s1", "and says which page");
  const undone = applyEntry(scened, sceneEntry, "undo", { force: true });
  check(spreadOf(undone.project, "s1")!.illustration === "Scene 1" && undone.conflicts.length === 0, "undoing it puts the scene back");
  check(spreadOf(applyEntry(undone.project, sceneEntry, "redo", { force: true }).project, "s1")!.illustration === "Arthur sleeps under the tree", "redo puts it on again");

  const later = setPageScene(scened, "s1", "Arthur wakes up");
  const old = applyEntry(later, sceneEntry, "undo");
  check(old.conflicts.length === 1 && spreadOf(old.project, "s1")!.illustration === "Arthur wakes up", "an older edit is not taken back over a newer one");
  const other = setPageScene(scened, "s2", "Mina waves");
  check(spreadOf(applyEntry(other, sceneEntry, "undo").project, "s1")!.illustration === "Scene 1", "but goes back when the newer edit was on another page");

  const worded = setPageWords(base, "s1", "Brand new words");
  const wordsEntry = entryFor(base, worded);
  const wordsBack = applyEntry(worded, wordsEntry, "undo", { force: true }).project;
  check(spreadOf(wordsBack, "s1")!.text === "Words 1" && sameValue(wordsBack.design, base.design), "words go back on the page and in its text box");

  const hidden = setPageHasPicture(base, "s1", false);
  const hideEntry = entryFor(base, hidden);
  check(hideEntry.ops.some((op) => op.path[2] === "blankCanvas" || op.path[2] === "completion"), "taking the picture off is a plan edit");
  const shown = applyEntry(hidden, hideEntry, "undo", { force: true }).project;
  check(sameValue(docOf(shown).spreads, docOf(base).spreads) && sameValue(shown.design, base.design), "putting it back restores the page and its design exactly");

  const cast = setPageCast(base, "s1", ["a1"]);
  check(entryFor(base, cast).ops.some((op) => op.path[2] === "anchorIds"), "who is on the page is a plan edit");

  check(diffPlan(docOf(base), docOf(insertPage(base, 1, {}).project)) === null, "a page added is a change of structure, kept whole");
  check(JSON.parse(JSON.stringify(sceneEntry)).ops[0].path[0] === "plan", "the step is plain data, so it can be kept across a reload");
}

// ---------------------------------------------------------------------------------------------
section("a removed page is kept and goes back where it was");

{
  const base = { ...book(), config: { artStyle: {}, storyText: "The story as it was." } } as unknown as Project;
  const art = (blob: string) => tree1({ blobId: blob, mimeType: "image/png", references: [] } as never);
  const drawn: Project = { ...base, illustrations: { s1: art("b1"), s2: art("b2") } };
  const ids = (p: Project) => getCursor(p.screenplay!).content.spreads.map((s) => s.id).join();

  const without = removePage(drawn, "s2");
  check(ids(without) === "s1,s3" && !without.illustrations?.s2, "a removed page leaves the book");
  check(removedPagesOf(without).length === 1 && removedPagesOf(without)[0]!.spread.id === "s2", "and is kept");
  check(removedPagesOf(without)[0]!.illustration !== undefined && isRemovedPage(without, "s2"), "with its picture");
  check(collectProjectImageBlobIds(without).has("b2"), "its picture is not cleaned up while it is kept");
  check(removePage(drawn, "nope") === drawn, "removing a page that is not there changes nothing");

  const back = restorePage(without);
  check(back.id === "s2" && ids(back.project) === "s1,s2,s3", "it goes back in the same place");
  check(back.project.illustrations?.s2 !== undefined && (back.project.removedPages ?? []).length === 0, "with its picture, and leaves the bin");
  check(restorePage(base).id === null && restorePage(base).project === base, "nothing removed, nothing to put back");

  const first = restorePage(removePage(drawn, "s1"));
  check(ids(first.project) === "s1,s2,s3", "the first page goes back first");
  const gone = restorePage(removePage(removePage(drawn, "s2"), "s1"), "s2");
  check(ids(gone.project) === "s3,s2", "a page whose neighbor is gone too goes to the end rather than nowhere");
  check(restorePage(removePage(drawn, "s3"), "s3").project.screenplay !== undefined, "any removed page can be named");

  // Undo already put the page back: it is not "recently removed" any more.
  const undone: Project = { ...drawn, removedPages: without.removedPages };
  check(removedPagesOf(undone).length === 0, "a page that is back in the book is not listed as removed");
  check(restorePage(undone).id === null && (restorePage(undone).project.removedPages ?? []).length === 0, "and putting it back only tidies the list");

  // The bin keeps the last ten, by count.
  let many = drawn;
  for (let n = 0; n < REMOVED_PAGES_KEPT + 3; n += 1) {
    const out = insertPage(many, 0, { scene: `Page ${n}` });
    many = removePage(out.project, out.id);
  }
  check((many.removedPages ?? []).length === REMOVED_PAGES_KEPT, "only the last ten removed pages are kept");
  check(removedPagesOf(many)[0]!.spread.illustration === `Page ${REMOVED_PAGES_KEPT + 2}`, "newest first");

  // A picture that lands after its page was removed is kept with the page.
  const late = withRemovedPicture(without, "s2", (t) => {
    const next = tree1({ blobId: "b2-late", mimeType: "image/png", references: [] } as never);
    return t ? { ...t, nodes: { ...t.nodes, ...next.nodes }, cursorId: next.cursorId } : next;
  });
  check(collectProjectImageBlobIds(late).has("b2-late"), "a late picture for a removed page is kept");
  check(withRemovedPicture(without, "sx", () => art("z")) === without, "a picture for a page that was never kept changes nothing");

  // The words as they stand.
  check(bookWords(base) === "Words 1\n\nWords 2\n\nWords 3", "the book's words are the pages' words in order");
  check(bookWords(setPageWords(base, "s2", "")) === "Words 1\n\nWords 3", "an empty page adds nothing");
  check(bookWords(setPageWords(base, "s2", "Changed")) !== base.config.storyText, "and follows an edit that the frozen story does not");
}

// ---------------------------------------------------------------------------------------------
section("a page's words and its text box always say the same thing, whoever wrote them");

{
  const base = book();
  const docOf = (project: Project) => getCursor(project.screenplay!).content;
  const boxOf = (project: Project, id = "s1") => project.design!.pages[id]!.textBoxes[0]!;
  const withBox = (project: Project, paragraphs: ReturnType<typeof wordParagraphs>, id = "s1"): Project => ({
    ...project,
    design: {
      ...project.design!,
      pages: { ...project.design!.pages, [id]: { ...project.design!.pages[id]!, textBoxes: [{ ...boxOf(project, id), paragraphs }] } },
    },
  });
  const withPlan = (project: Project, text: string, id = "s1"): Project =>
    withSpreads(project, (spreads) => spreads.map((spread) => (spread.id === id ? { ...spread, text } : spread)));
  const styled = (project: Project) =>
    withPlan(
      withBox(project, [{ spans: [{ text: "Once ", bold: true }, { text: "upon a time, there was a hill." }] }]),
      "Once upon a time, there was a hill.",
    );
  const spans = (project: Project) => boxOf(project).paragraphs.flatMap((paragraph) => paragraph.spans);
  const styleOfWord = (project: Project, word: string) => spans(project).find((span) => span.text.trim() === word);

  // The two ways of saying the same words compare equal.
  check(canonWords("a \r\n\r\n\r\nb ") === "a\n\nb", "line endings, runs of blank lines and trailing spaces do not make words different");
  check(wordsOfParagraphs(rewordParagraphs([], "One.\n\nTwo here.")) === "One.\n\nTwo here.", "styled paragraphs hold exactly the words they were given");

  // Plan only: the box takes the words and the words that stayed keep their style.
  const base2 = styled(base);
  const planEdited = reconcilePageWords(base2, withPlan(base2, "Once upon a time, there was a big hill."));
  check(wordsOfParagraphs(boxOf(planEdited).paragraphs) === "Once upon a time, there was a big hill.", "a words edit reaches the text box");
  check(styleOfWord(planEdited, "Once")?.bold === true, "a word that stayed keeps its style");
  check(styleOfWord(planEdited, "big")?.bold !== true, "a word that was added takes the style of the word before it");
  const replaced = reconcilePageWords(base2, withPlan(base2, "Twice upon a time, there was a hill."));
  check(styleOfWord(replaced, "Twice")?.bold === true, "a word that replaced a bold one is bold");
  check(styleOfWord(replaced, "hill.")?.bold !== true, "and the words around it are as they were");
  const emptied = reconcilePageWords(base2, withPlan(base2, ""));
  check(wordsOfParagraphs(boxOf(emptied).paragraphs) === "" && boxOf(emptied).paragraphs.length === 1, "emptied words leave one empty paragraph");
  const aligned = withBox(base, [{ align: "center", spans: [{ text: "Words 1" }] }]);
  check(reconcilePageWords(aligned, withPlan(aligned, "Other words")).design!.pages.s1!.textBoxes[0]!.paragraphs[0]!.align === "center", "alignment is kept");
  const twoParagraphs = reconcilePageWords(base, withPlan(base, "First.\n\nSecond."));
  check(boxOf(twoParagraphs).paragraphs.length === 2, "a blank line makes a new paragraph");

  // Box only: the plan takes the words, and the page keeps being the kind of page it was.
  const typed = withBox(base, wordParagraphs("Typed on the page"));
  const fromBox = reconcilePageWords(base, typed);
  check(spreadOf(fromBox, "s1")!.text === "Typed on the page", "words typed on the page reach the plan");
  check(fromBox.design === typed.design, "and the page itself is left as it was typed");
  const textPage = setPageHasPicture(base, "s1", false);
  const emptiedOnPage = reconcilePageWords(textPage, withBox(textPage, [{ spans: [{ text: "" }] }]));
  check(spreadOf(emptiedOnPage, "s1")!.text === "" && spreadOf(emptiedOnPage, "s1")!.completion === "blank", "words cleared on a page without a picture make it a blank page");

  // Both changed and different: the box is what prints.
  const both = withPlan(withBox(base, wordParagraphs("Box words")), "Plan words");
  check(spreadOf(reconcilePageWords(base, both), "s1")!.text === "Box words", "when both changed and differ, the box wins");

  // Nothing to say.
  check(reconcilePageWords(base, base) === base, "an unchanged book is returned as it is");
  const copy = structuredClone(base);
  check(reconcilePageWords(base, copy) === copy, "a copy with the same words is returned as it is");
  const trailing = withPlan(base, "Words 1\n\n\n");
  check(reconcilePageWords(base, trailing) === trailing, "trailing blank lines are still the same words");
  const noBox = withPlan(base, "Only the plan", "s2");
  check(reconcilePageWords(base, noBox) === noBox, "a page with no text box has just the plan's words");
  const second = {
    ...boxOf(base),
    id: "tb2",
    paragraphs: wordParagraphs("Another box"),
  };
  const two = {
    ...base,
    design: { ...base.design!, pages: { ...base.design!.pages, s1: { ...base.design!.pages.s1!, textBoxes: [boxOf(base), second] } } },
  } as Project;
  const twoEdited = withPlan(two, "Plan changed");
  check(reconcilePageWords(two, twoEdited) === twoEdited, "a page with two story boxes is left alone");
  check(pageWordsOf(base, "s1") === "Words 1" && pageWordsOf(base, "s2") === "Words 2" && pageWordsOf(base, "nope") === "", "the page's words read the same from either place");

  // A book saved with them apart is made whole, once, and the box wins.
  const apart = withPlan(withBox(base, wordParagraphs("What was printed")), "What the plan said");
  const repaired = repairPageWords(apart);
  check(spreadOf(repaired, "s1")!.text === "What was printed", "a book saved apart keeps what was printed");
  check(repairPageWords(repaired) === repaired && repairPageWords(base) === base, "repairing twice, or a book that is whole, changes nothing");

  // Undo and redo, whichever side the entry knew about.
  const entryFor = (before: Project, after: Project): ChangeEntry => {
    const planOps = diffPlan(docOf(before), docOf(after)) ?? [];
    const ops = [...planOps, ...diffDesign(before.design, after.design)];
    return { id: "c", at: 0, source: "editor", label: "x", pages: pagesOfOps(ops), ops, state: "applied" };
  };
  const canvasEdit = reconcilePageWords(base, withBox(base, wordParagraphs("Typed on the page")));
  const canvasEntry = { ...entryFor(base, withBox(base, wordParagraphs("Typed on the page"))), ops: diffDesign(base.design, canvasEdit.design) };
  check(canvasEntry.ops.every((op) => op.path[0] !== "plan"), "a canvas edit is recorded as a design change only");
  const canvasUndone = reconcilePageWords(canvasEdit, applyEntry(canvasEdit, canvasEntry, "undo", { force: true }).project);
  check(spreadOf(canvasUndone, "s1")!.text === "Words 1" && wordsOfParagraphs(boxOf(canvasUndone).paragraphs) === "Words 1", "undoing a canvas edit puts the words back in the plan too");
  const canvasRedone = reconcilePageWords(canvasUndone, applyEntry(canvasUndone, canvasEntry, "redo", { force: true }).project);
  check(spreadOf(canvasRedone, "s1")!.text === "Typed on the page" && wordsOfParagraphs(boxOf(canvasRedone).paragraphs) === "Typed on the page", "and redo puts them on again");
  const legacyPlanEntry = (() => {
    const edited = withPlan(base, "Plan only edit");
    return { entry: { ...entryFor(base, edited), ops: diffPlan(docOf(base), docOf(edited))! }, edited };
  })();
  const legacyUndone = reconcilePageWords(legacyPlanEntry.edited, applyEntry(legacyPlanEntry.edited, legacyPlanEntry.entry, "undo", { force: true }).project);
  check(spreadOf(legacyUndone, "s1")!.text === "Words 1", "an older entry that only knew the plan still undoes");

  // Whatever order things happen in, the two stay together.
  let state = base;
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  const sentences = ["A red kite.", "The lantern glows.\n\nShe smiles.", "", "Hello, world.", "  Extra   spaces  here "];
  const undoStack: Array<{ entry: ChangeEntry; after: Project }> = [];
  for (let step = 0; step < 300; step += 1) {
    const pick = next() % 5;
    const text = sentences[next() % sentences.length]!;
    let written: Project;
    if (pick === 0) written = reconcilePageWords(state, withPlan(state, text));
    else if (pick === 1) written = reconcilePageWords(state, withBox(state, wordParagraphs(text)));
    else if (pick === 2) written = reconcilePageWords(state, setPageWords(state, "s1", text));
    else if (pick === 3 && undoStack.length > 0) {
      const last = undoStack.pop()!;
      written = reconcilePageWords(state, applyEntry(state, last.entry, "undo", { force: true }).project);
    } else written = reconcilePageWords(state, withBox(withPlan(state, text), wordParagraphs(sentences[next() % sentences.length]!)));
    if (pick < 3 || pick === 4) undoStack.push({ entry: entryFor(state, written), after: written });
    state = written;
    check(canonWords(spreadOf(state, "s1")!.text) === wordsOfParagraphs(boxOf(state).paragraphs), `step ${step}: the plan and the text box say the same thing`);
  }
}

// ---------------------------------------------------------------------------------------------
section("the story is what the pages say once drawing has started");

{
  const written = { ...book(), config: { storyText: "Arthur went up. Arthur sat down." } } as unknown as Project;
  check(storyOf(written) === "Arthur went up. Arthur sat down.", "before drawing, the story is the one that was written");
  const drawing = { ...written, authoringState: { lockedAt: 1 } } as unknown as Project;
  check(storyOf(drawing) === bookWords(drawing), "once drawing has started, the story is what the pages say");
  const edited = setPageWords(drawing, "s1", "Mina went up");
  check(storyOf(edited).includes("Mina went up") && !storyOf(edited).includes("Arthur went up"), "and an edit to a page is an edit to the story");
  check(edited.config.storyText === "Arthur went up. Arthur sat down.", "the story the pictures were made from is not changed");
  check(renameMentions(drawing, "Arthur") === 0 && renameMentions(edited, "Mina") === 1, "a rename counts the names the pages say now");
  const noPages = { ...drawing, screenplay: undefined } as unknown as Project;
  check(storyOf(noPages) === "Arthur went up. Arthur sat down.", "a book with no pages yet keeps its written story");
}

// ---------------------------------------------------------------------------------------------
section("the cover's words agree wherever they are written");

{
  const coverBox = (id: string, role: string, text: string, hidden = false) =>
    ({
      id,
      role,
      hidden,
      rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
      z: 1,
      paragraphs: wordParagraphs(text),
    }) as unknown as BookDesign["pages"][string]["textBoxes"][number];
  const withCover = (p: Project, boxes: BookDesign["pages"][string]["textBoxes"]): Project =>
    ({ ...p, design: { ...p.design!, pages: { ...p.design!.pages, "cover-front": { textBoxes: boxes } } } }) as Project;
  const setBoxes = (p: Project, boxes: BookDesign["pages"][string]["textBoxes"]): Project => withCover(p, boxes);
  const base = withCover(book(), [coverBox("t", "book-title", "T"), coverBox("s", "book-subtitle", "")]);

  check(reconcileCoverWords(base, base) === base, "an unchanged cover is returned as it is");
  const retitled = reconcileCoverWords(base, setBoxes(base, [coverBox("t", "book-title", "Arthur's Big Day"), coverBox("s", "book-subtitle", "")]));
  check(retitled.title === "Arthur's Big Day", "a title typed on the cover becomes the book's title");
  check(
    getCursor(retitled.screenplay!).content.frontCover?.title === "Arthur's Big Day" && coverLinesOf(retitled).title === "Arthur's Big Day",
    "and the cover's spec says the same",
  );
  const sub = reconcileCoverWords(base, setBoxes(base, [coverBox("t", "book-title", "T"), coverBox("s", "book-subtitle", "A brave story")]));
  check(coverLinesOf(sub).subtitle === "A brave story", "a subtitle typed on the cover is the book's subtitle");
  check(sub.title === "T", "and the title is left alone");

  // Only a box that changed in this write is acted on.
  const apart = { ...base, title: "Something else" } as Project;
  check(reconcileCoverWords(base, apart) === apart, "a book's title changed elsewhere does not rewrite the cover");
  check(reconcileCoverWords(null, apart) === apart, "a book opened with no earlier copy is left as it is");
  const hidden = setBoxes(base, [coverBox("t", "book-title", "Hidden change", true), coverBox("s", "book-subtitle", "")]);
  check(reconcileCoverWords(withCover(base, [coverBox("t", "book-title", "T", true)]), hidden).title === "T", "a hidden box does not speak for the cover");

  // Undo: the box goes back, so the words follow it.
  const undone = reconcileCoverWords(retitled, base);
  check(undone.title === "T" && coverLinesOf(undone).title === "T", "taking a cover edit back puts the title back");

  // A change to the cover's words is taken back whole, with the title and the chosen lines.
  const edited = applyCoverLine(applyBookTitle(base, "New name"), "subtitle", "New line");
  const back = applyStructural(edited, takeStructural(base, true));
  check(back.title === "T" && coverLinesOf(back).subtitle === "", "the title and the chosen subtitle go back with the change");
  check(applyStructural(edited, takeStructural(base)).title === "New name", "any other change leaves the title alone");
  const again = applyStructural(back, takeStructural(edited, true));
  check(again.title === "New name" && coverLinesOf(again).subtitle === "New line", "and come forward again with it");

  const scened = patchCoverSpec(base, "cover-back", { title: "The end." });
  check(getCursor(scened.screenplay!).content.backCover?.title === "The end." && getCursor(scened.screenplay!).content.backCover?.illustration === "", "the back cover's words are set and its scene kept");
}

console.log(`\n${passed} checks passed.`);
