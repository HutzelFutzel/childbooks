/**
 * Invariants for the book's shared change log and for page references.
 *
 * What a parent would be hurt by:
 *
 * - Undo takes back the change and nothing else: a later, unrelated change
 *   stays, and Redo puts the same thing back.
 * - An older change is never taken back over a newer one silently: where
 *   something newer touched the same property, it is reported, not overwritten.
 * - A slider drag is one step, not forty.
 * - "page 18" means the page the book on the left calls page 18, "pages 3-5"
 *   means three pages, and a page the book does not have is reported instead of
 *   being quietly dropped or turned into another page.
 *
 * Offline and deterministic: pure functions over synthesized designs and books.
 */
import {
  applyEntry,
  applyOps,
  diffDesign,
  entriesNewerThan,
  labelForOps,
  logWith,
  mergeOps,
  newestApplied,
  nextRedo,
  withEntryState,
  EMPTY_LOG,
  type ChangeEntry,
  type ChangeLog,
} from "../books-frontend/src/core/book/changeLog";
import { pictureRectOnPage, regionOnPicture } from "../books-frontend/src/core/book/regionPicture";
import { describePages, interiorUnitIds, pageLabel, pageNumberOf, pagesNamedIn, unitIdOfPage } from "../books-frontend/src/core/book/pageRefs";
import type { BookDesign } from "../books-frontend/src/core/design";
import { COVER_BACK_ID, COVER_FRONT_ID, type Project, type ScreenplayDoc } from "../books-frontend/src/core/types";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import { bookBusyOf, busyReason } from "../books-frontend/src/core/guide/bookBusy";
import { changesTheScene } from "../books-frontend/src/core/pipeline/editScope";
import { anchorsNamedIn, castOnPage } from "../books-frontend/src/core/book/pageCast";
import { restoreCastOf, snapshotForFields } from "../books-frontend/src/core/guide/agent/restore";
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import { resolvePaperColor } from "../books-frontend/src/core/guide/agent/commands/design";
import type { CommandContext } from "../books-frontend/src/core/guide/agent/types";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(ok: boolean, message: string): void {
  cases += 1;
  if (!ok && failures.length < 40) failures.push(`history: ${message}`);
}

const design = (pages: Record<string, unknown>, base: Record<string, unknown> = {}): BookDesign =>
  ({ ...base, pages }) as unknown as BookDesign;

let clock = 0;
function entryOf(before: BookDesign, after: BookDesign, label = "change"): ChangeEntry {
  const ops = diffDesign(before, after);
  return {
    id: `e${(clock += 1)}`,
    at: clock,
    source: "chat",
    label,
    pages: [...new Set(ops.map((op) => (op.path[0] === "pages" ? (op.path[1] ?? "*") : "*")))],
    ops,
    state: "applied",
  };
}

function bookWithPages(count: number): Project {
  const spreads = Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    kind: "single",
    text: `Text ${i + 1}`,
    illustration: "",
  }));
  const doc = {
    notes: "",
    spreads,
    frontCover: { illustration: "", title: "T" },
    backCover: { illustration: "" },
  } as unknown as ScreenplayDoc;
  return { id: "p", title: "T", config: {}, screenplay: createVersionTree(doc) } as unknown as Project;
}

export function checkGuideHistory(): CheckResult {
  // --- Diff and undo --------------------------------------------------------------
  const a = design({ s1: { background: "#fff", textSize: 20 }, s2: { background: "#fff" } });
  const b = design({ s1: { background: "#fee", textSize: 20 }, s2: { background: "#fff" } });
  const c = design({ s1: { background: "#fee", textSize: 28 }, s2: { background: "#fff" } });

  const ab = entryOf(a, b, "Page 1 background");
  const bc = entryOf(b, c, "Page 1 text size");
  check(ab.ops.length === 1 && bc.ops.length === 1, "a one-property change is one op");
  check(diffDesign(a, a).length === 0, "no change is no op");
  check(labelForOps(ab.ops).length > 0, "a change has a label for a list");

  // The newest change goes back as asked, and only it.
  const undoNewest = applyOps(c, bc.ops, "undo", { force: true });
  check(JSON.stringify(undoNewest.design) === JSON.stringify(b), "undoing the newest change puts back exactly the earlier design");
  check(undoNewest.conflicts.length === 0, "the newest change has no conflicts");

  // An older, unrelated change goes back and leaves the newer one in place.
  const older = applyOps(c, ab.ops, "undo");
  check(older.conflicts.length === 0, "an older change with nothing newer on its property goes back");
  check(
    JSON.stringify(older.design) === JSON.stringify(design({ s1: { background: "#fff", textSize: 28 }, s2: { background: "#fff" } })),
    "undoing an older change keeps the newer, unrelated one",
  );

  // Redo puts the same thing back.
  const redone = applyOps(older.design, ab.ops, "redo");
  check(JSON.stringify(redone.design) === JSON.stringify(c), "redo after undo restores the design");

  // A newer change on the same property is a conflict, never overwritten silently.
  const d = design({ s1: { background: "#eef", textSize: 28 }, s2: { background: "#fff" } });
  const bd = entryOf(c, d, "Page 1 background again");
  const clash = applyOps(d, ab.ops, "undo");
  check(clash.conflicts.length === 1 && clash.applied === 0, "an older change over a newer one on the same property is a conflict");
  check(JSON.stringify(clash.design) === JSON.stringify(d), "a conflict changes nothing");
  const forced = applyOps(d, ab.ops, "undo", { force: true });
  check(forced.conflicts.length === 0, "forcing writes the older value");

  // --- Added and removed properties and pages -----------------------------------------
  const withColor = design({ s1: { background: "#fff" } });
  const without = design({ s1: {} });
  const added = entryOf(without, withColor);
  check(
    JSON.stringify(applyOps(withColor, added.ops, "undo", { force: true }).design) === JSON.stringify(without),
    "undoing an added property removes it",
  );
  const missingPage = design({});
  const gone = applyOps(missingPage, entryOf(without, withColor).ops, "undo");
  check(gone.conflicts.length > 0, "a change on a page that is gone is reported, not invented");

  // --- Id-keyed lists -----------------------------------------------------------------
  const boxesA = design({ s1: { textBoxes: [{ id: "x", size: 10 }, { id: "y", size: 12 }] } });
  const boxesB = design({ s1: { textBoxes: [{ id: "y", size: 12 }, { id: "x", size: 14 }] } });
  const boxOps = diffDesign(boxesA, boxesB);
  check(boxOps.length === 1 && boxOps[0]!.path.some((segment) => segment === "#x"), "a list reorder plus one edit diffs by id, not by index");

  // --- Gestures -----------------------------------------------------------------------
  const g0 = design({ s1: { size: 10 } });
  const g1 = design({ s1: { size: 11 } });
  const g2 = design({ s1: { size: 12 } });
  const merged = mergeOps(diffDesign(g0, g1), diffDesign(g1, g2));
  check(merged.length === 1 && merged[0]!.before === 10 && merged[0]!.after === 12, "a drag keeps the first before and the last after");
  const back = mergeOps(diffDesign(g0, g1), diffDesign(g1, g0));
  check(back.length === 0, "a drag that ends where it began is no change");

  // --- The log ------------------------------------------------------------------------
  let log: ChangeLog = EMPTY_LOG;
  log = logWith(log, ab);
  log = logWith(log, bc);
  check(newestApplied(log)?.id === bc.id, "undo takes the newest applied change");
  log = withEntryState(log, bc.id, "undone");
  check(newestApplied(log)?.id === ab.id, "after undoing the newest, the next one is the one before");
  check(nextRedo(log)?.id === bc.id, "redo offers what was undone last");
  log = withEntryState(log, ab.id, "undone");
  check(nextRedo(log)?.id === ab.id, "redo walks back through undone changes newest-undone first");
  log = withEntryState(log, ab.id, "applied");
  check(nextRedo(log)?.id === bc.id, "redoing one leaves the other next");
  log = logWith(log, bd);
  check(nextRedo(log) === undefined, "a new change ends the redo line");

  const conflictLog = logWith(logWith(EMPTY_LOG, ab), bd);
  check(entriesNewerThan(conflictLog, ab.id).length === 1, "a newer change on the same property blocks an out-of-order undo");
  const calmLog = logWith(logWith(EMPTY_LOG, ab), bc);
  check(entriesNewerThan(calmLog, ab.id).length === 0, "a newer change on another property does not block it");

  const full = Array.from({ length: 130 }, (_, i) => entryOf(design({ s1: { n: i } }), design({ s1: { n: i + 1 } })));
  const trimmed = full.reduce<ChangeLog>((acc, entry) => logWith(acc, entry), EMPTY_LOG);
  check(trimmed.entries.length === 100, "the log keeps the newest hundred changes");

  // --- Page references ----------------------------------------------------------------
  const book = bookWithPages(20);
  const ids = interiorUnitIds(book);
  check(ids.length === 20 && !ids.includes(COVER_FRONT_ID) && !ids.includes(COVER_BACK_ID), "inside pages exclude the covers");
  check(pageNumberOf(book, ids[17]!) === 18 && unitIdOfPage(book, 18) === ids[17], "page numbers and ids agree");
  check(pageNumberOf(book, COVER_FRONT_ID) === null, "a cover has no page number");
  check(unitIdOfPage(book, 21) === null && unitIdOfPage(book, 0) === null, "a page the book does not have is null");

  const named = (text: string) => pagesNamedIn(text, book);
  const numbersOf = (text: string) => named(text).ids.map((id) => pageNumberOf(book, id) ?? id);

  check(JSON.stringify(numbersOf("Give her an umbrella in her left hand on page 18")) === "[18]", "page 18");
  check(JSON.stringify(numbersOf("make the text bigger on pages 3-5")) === "[3,4,5]", "pages 3-5");
  check(JSON.stringify(numbersOf("pages 3 to 5")) === "[3,4,5]", "pages 3 to 5");
  check(JSON.stringify(numbersOf("pages 7 and 2")) === "[2,7]", "pages 7 and 2, in book order");
  check(JSON.stringify(numbersOf("pages 3, 5 and 9-10")) === "[3,5,9,10]", "a list with a range");
  check(JSON.stringify(numbersOf("Seite 4")) === "[4]", "Seite 4");
  check(JSON.stringify(numbersOf("auf den Seiten 2 und 3")) === "[2,3]", "Seiten 2 und 3");
  check(JSON.stringify(numbersOf("on the last page")) === "[20]", "the last page");
  check(JSON.stringify(numbersOf("the first page")) === "[1]", "the first page");
  check(JSON.stringify(numbersOf("letzte Seite")) === "[20]", "letzte Seite");
  check(JSON.stringify(numbersOf("change the title on the front cover")) === `["${COVER_FRONT_ID}"]`, "the front cover");
  check(JSON.stringify(numbersOf("a new picture for the back cover")) === `["${COVER_BACK_ID}"]`, "the back cover is not the front cover");
  check(JSON.stringify(numbersOf("Rückseite")) === `["${COVER_BACK_ID}"]`, "Rückseite");
  check(JSON.stringify(numbersOf("put it on the cover")) === `["${COVER_FRONT_ID}"]`, "on the cover");
  check(named("make everything warmer").ids.length === 0 && !named("make everything warmer").all, "a sentence with no page names none");
  check(named("on every page").all && named("alle Seiten").all && named("the whole book").all, "all pages is reported as all");
  check(JSON.stringify(named("on page 25").missing) === "[25]" && named("on page 25").ids.length === 0, "a page the book does not have is reported");
  check(JSON.stringify(named("pages 19-22").missing) === "[21,22]" && named("pages 19-22").ids.length === 2, "a range past the end keeps what exists and reports the rest");
  check(pagesNamedIn("page 1", bookWithPages(0)).missing.length === 1, "an empty book has no page 1");
  check(named("pages 1-5000").ids.length <= 20, "a runaway range is bounded");

  check(pageLabel(book, ids[3]!) === "page 4" && pageLabel(book, COVER_BACK_ID) === "the back cover", "labels");
  check(describePages(book, [ids[3]!]) === "page 4", "one page phrase");
  check(describePages(book, [ids[5]!, ids[3]!]) === "pages 4 and 6", "two pages phrase");
  check(describePages(book, [ids[2]!, ids[3]!, ids[4]!]) === "pages 3–5", "a run of pages phrase");
  check(describePages(book, [ids[2]!, ids[4]!, ids[8]!]) === "pages 3, 5 and 9", "a list of pages phrase");
  check(describePages(book, [COVER_FRONT_ID, ids[0]!]) === "page 1 and the front cover", "pages and a cover phrase");
  check(describePages(book, []) === "no page", "no pages phrase");

  // --- Page appearance skills -----------------------------------------------------------
  const box = (color: string) => ({
    id: "b",
    rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 },
    z: 1,
    presetId: "plain",
    fontFamily: "Lora",
    fontSizePct: 0.05,
    color,
    align: "left",
    vAlign: "top",
    lineHeight: 1.4,
    role: "story-body",
    paragraphs: [{ id: "p", spans: [{ text: "Hello" }] }],
  });
  const styled = (inkColor: string): Project => {
    const base = bookWithPages(3);
    const ids = interiorUnitIds(base);
    const pages: Record<string, unknown> = {
      [COVER_FRONT_ID]: { textBoxes: [] },
      [COVER_BACK_ID]: { textBoxes: [] },
    };
    for (const id of ids) pages[id] = { textBoxes: [box(inkColor)] };
    return { ...base, design: design(pages, { defaultFontFamily: "Lora", defaultFontSizePct: 0.05 }) } as unknown as Project;
  };
  const ctxFor = (pages?: string[]) => ({ ...(pages ? { pages } : {}) }) as unknown as CommandContext;
  const colorOf = (p: Project, id: string) =>
    (p.design?.pages[id] as unknown as { background?: { color?: string } } | undefined)?.background?.color;

  check(resolvePaperColor("Cream") === "#fff7e6" && resolvePaperColor("#abc") === "#aabbcc", "paper colors: names and hex");
  check(resolvePaperColor("grey") === resolvePaperColor("gray") && resolvePaperColor("blorple") === null, "paper colors: both spellings, unknown is null");

  const paper = styled("#111111");
  const pageIds = interiorUnitIds(paper);
  const setColor = GUIDE_COMMANDS.setPageColor;
  const whole = setColor.run(paper, { color: "cream", scope: "book" }, ctxFor());
  check(whole.kind === "write", "whole-book page color writes");
  if (whole.kind === "write") {
    check(pageIds.every((id) => colorOf(whole.project, id) === "#fff7e6"), "whole-book page color reaches every inside page");
    check(colorOf(whole.project, COVER_FRONT_ID) === undefined && colorOf(whole.project, COVER_BACK_ID) === undefined, "whole-book page color leaves the covers alone");
    check(whole.project.design?.defaultPageBackground?.color === "#fff7e6", "whole-book page color is the default for new pages");
    check(diffDesign(paper.design, whole.project.design).length > 0, "a page color change shows in the change log");
  }
  const one = setColor.run(paper, { color: "blue", scope: "page" }, ctxFor([pageIds[1]!]));
  check(
    one.kind === "write" &&
      colorOf(one.project, pageIds[1]!) === "#dbeafe" &&
      colorOf(one.project, pageIds[0]!) === undefined &&
      one.project.design?.defaultPageBackground === undefined,
    "page color on one page changes only that page",
  );
  const cover = setColor.run(paper, { color: "#223344", scope: "page" }, ctxFor([COVER_FRONT_ID]));
  check(cover.kind === "write" && colorOf(cover.project, COVER_FRONT_ID) === "#223344", "a named cover can take a page color");
  check(setColor.run(paper, { color: "blorple", scope: "book" }, ctxFor()).kind === "invalid", "an unknown color is refused, not guessed");
  check(setColor.run(paper, { color: "cream", scope: "page" }, ctxFor()).kind === "invalid", "page color with no page in view asks which");
  if (whole.kind === "write") {
    check(setColor.run(whole.project, { color: "cream", scope: "book" }, ctxFor()).kind === "noop", "the same page color again changes nothing");
  }
  const dark = setColor.run(paper, { color: "black", scope: "book" }, ctxFor());
  check(dark.kind === "write" && dark.beat.key === "pageColorContrast", "dark paper under dark words warns about contrast");
  const readable = setColor.run(paper, { color: "cream", scope: "book" }, ctxFor());
  check(readable.kind === "write" && readable.beat.key === "done", "readable paper does not warn");

  const bold = GUIDE_COMMANDS.setTextEmphasis.run(paper, { emphasis: "bold" }, ctxFor());
  check(bold.kind === "write", "bold writes");
  if (bold.kind === "write") {
    const again = GUIDE_COMMANDS.setTextEmphasis.run(bold.project, { emphasis: "bold" }, ctxFor());
    check(again.kind === "noop", "bold twice is a no-op");
    const off = GUIDE_COMMANDS.setTextEmphasis.run(bold.project, { emphasis: "bold", state: "off" }, ctxFor());
    check(off.kind === "write", "bold can be taken off");
  }
  check(GUIDE_COMMANDS.setTextEmphasis.run(paper, { emphasis: "sparkly" }, ctxFor()).kind === "invalid", "an unknown emphasis is refused");
  const looser = GUIDE_COMMANDS.setLineSpacing.run(paper, { spacing: "looser" }, ctxFor());
  check(
    looser.kind === "write" &&
      (looser.project.design?.pages[pageIds[0]!]?.textBoxes[0]?.lineHeight ?? 0) > 1.4,
    "looser line spacing raises the line height",
  );
  let spaced: Project = paper;
  for (let i = 0; i < 30; i += 1) {
    const step = GUIDE_COMMANDS.setLineSpacing.run(spaced, { spacing: "looser" }, ctxFor());
    if (step.kind !== "write") break;
    spaced = step.project;
  }
  check((spaced.design?.pages[pageIds[0]!]?.textBoxes[0]?.lineHeight ?? 0) <= 2.2, "line spacing stops at its ceiling");

  // --- Picture edits --------------------------------------------------------------------
  const drawnBook = {
    ...paper,
    illustrations: { [pageIds[1]!]: createVersionTree({ blobId: "blob", mimeType: "image/png" }) },
  } as unknown as Project;
  const edit = GUIDE_COMMANDS.editPicture;
  check(edit.paid === true && edit.aimsAtPages === true, "editPicture is a paid skill that aims at named pages");
  const withUmbrella = edit.run(drawnBook, { change: "an umbrella in her left hand" }, ctxFor([pageIds[1]!]));
  check(
    withUmbrella.kind === "effect" &&
      withUmbrella.effect.kind === "redrawPage" &&
      withUmbrella.effect.unitIds.length === 1 &&
      withUmbrella.effect.unitIds[0] === pageIds[1] &&
      withUmbrella.effect.instruction.includes("umbrella") &&
      withUmbrella.effect.mode === undefined,
    "a picture change on a drawn page offers a redraw of that page, editing what is there",
  );
  const fresh = edit.run(drawnBook, { change: "start over", mode: "new" }, ctxFor([pageIds[1]!]));
  check(fresh.kind === "effect" && fresh.effect.kind === "redrawPage" && fresh.effect.mode === "new", "mode new asks for a new picture");
  check(edit.run(drawnBook, { change: "an umbrella" }, ctxFor()).kind === "invalid", "a picture change with no page asks which, never guesses");
  const twoDrawn = {
    ...drawnBook,
    illustrations: {
      [pageIds[0]!]: createVersionTree({ blobId: "a", mimeType: "image/png" }),
      [pageIds[1]!]: createVersionTree({ blobId: "b", mimeType: "image/png" }),
    },
  } as unknown as Project;
  const named2 = (pages: string[]) => ({ ...ctxFor(pages), pagesNamed: true }) as unknown as CommandContext;
  const batch = edit.run(twoDrawn, { change: "a pink sky" }, named2([pageIds[0]!, pageIds[1]!, pageIds[0]!]));
  check(
    batch.kind === "effect" && batch.effect.kind === "redrawPage" && batch.effect.unitIds.join() === `${pageIds[0]},${pageIds[1]}`,
    "several drawn pages get one change together, each once",
  );
  const limited = edit.run(twoDrawn, { change: "a pink sky" }, { ...named2([pageIds[0]!, pageIds[1]!]), limits: { pictureBatch: 1, extrasPages: 12, refreshBatch: 24 } } as CommandContext);
  check(limited.kind === "invalid", "the admin's batch limit refuses a longer list of pictures");
  const partly = edit.run(drawnBook, { change: "a pink sky" }, named2([pageIds[0]!, pageIds[1]!]));
  check(
    partly.kind === "effect" && partly.effect.kind === "redrawPage" && partly.effect.unitIds.join() === pageIds[1],
    "a page with no picture is left out of a batch instead of failing it",
  );
  check(edit.run(drawnBook, { change: "an umbrella" }, ctxFor([pageIds[2]!])).kind === "invalid", "a page with no picture has nothing to change");
  check(edit.run(drawnBook, { change: "an umbrella" }, ctxFor(["gone"])).kind === "invalid", "a page that is gone has nothing to change");
  check(edit.run(drawnBook, { change: "" }, ctxFor([pageIds[1]!])).kind === "ask", "a picture change with no change asks what");

  // Pages that are only in view (a spread), not named, are asked about: never both by surprise.
  const implied = edit.run(twoDrawn, { change: "a pink sky" }, ctxFor([pageIds[0]!, pageIds[1]!]));
  check(
    implied.kind === "ask" && implied.arg === "pages" && implied.options.map((o) => o.id).join() === `${pageIds[0]},${pageIds[1]},both`,
    "a change meant for the pages in view asks which page, or both",
  );
  const pickedOne = edit.run(twoDrawn, { change: "a pink sky", pages: pageIds[1]! }, ctxFor([pageIds[0]!, pageIds[1]!]));
  check(pickedOne.kind === "effect" && pickedOne.effect.kind === "redrawPage" && pickedOne.effect.unitIds.join() === pageIds[1], "the page picked from the question is the only one changed");
  const pickedBoth = edit.run(twoDrawn, { change: "a pink sky", pages: "both" }, ctxFor([pageIds[0]!, pageIds[1]!]));
  check(pickedBoth.kind === "effect" && pickedBoth.effect.kind === "redrawPage" && pickedBoth.effect.unitIds.length === 2, "both changes both pages");

  // --- Cover words painted into the picture are redrawn, not left behind ------------------
  const paintedBox = (role: string, hidden: boolean) => ({ ...box("#000"), id: `cover-${role}`, role, hidden });
  const paintedCover = (hidden: boolean): Project => {
    const base = styled("#000");
    const withBoxes = {
      ...base,
      design: {
        ...base.design,
        pages: { ...base.design!.pages, [COVER_FRONT_ID]: { textBoxes: [paintedBox("book-author", hidden), paintedBox("book-title", hidden)] } },
      },
      illustrations: { [COVER_FRONT_ID]: createVersionTree({ blobId: "cover", mimeType: "image/png" }) },
    };
    return withBoxes as unknown as Project;
  };
  const retitle = GUIDE_COMMANDS.editCoverWords.run(paintedCover(true), { part: "author", words: "Papa & Katharine" }, ctxFor());
  check(
    retitle.kind === "write" && retitle.then?.kind === "redrawPage" && retitle.then.unitIds.join() === COVER_FRONT_ID && retitle.then.instruction.includes("Papa & Katharine"),
    "new author words painted into the cover redraw the front cover",
  );
  const liveWords = GUIDE_COMMANDS.editCoverWords.run(paintedCover(false), { part: "author", words: "Papa & Katharine" }, ctxFor());
  check(liveWords.kind === "write" && !liveWords.then, "words that are live text on the cover need no redraw");

  // --- The book is busy while anything draws ---------------------------------------------
  {
    const some = bookWithPages(4);
    const inside = interiorUnitIds(some);
    check(!bookBusyOf(some, {}).busy && !bookBusyOf(null, { activeUnitIds: new Set(["x"]) }).busy, "an idle book is not busy");
    const one = bookBusyOf(some, { activeUnitIds: new Set([inside[2]!]) });
    check(one.busy && one.items.length === 1 && one.items[0]!.page === 3, "one page drawing names its number");
    check(busyReason(one) === "Still drawing page 3. You can order when it finishes.", "the reason names the page");
    const cover = bookBusyOf(some, { activeUnitIds: new Set([inside[3]!, COVER_FRONT_ID, inside[0]!]) });
    check(cover.items.map((item) => item.kind === "cover" ? "cover" : item.page).join() === "cover,1,4", "the cover first, then pages in book order");
    check(!bookBusyOf(some, { activeUnitIds: new Set(["a page that was deleted"]) }).busy, "a unit the book no longer has is nothing to wait for");
    check(bookBusyOf(some, { held: [inside[1]!] }).busy, "a redraw about to start counts before its job exists");
    check(bookBusyOf(some, { planRunning: true }).busy, "planning the pages counts");
    check(busyReason(bookBusyOf(some, { activeUnitIds: new Set(inside) })) === "Still drawing 4 pictures. You can order when it finishes.", "many pictures are counted, not listed");
    const printCtx = { drawingReason: busyReason(one) } as unknown as CommandContext;
    const blocked = GUIDE_COMMANDS.orderBook.run(some, {}, printCtx);
    check(blocked.kind === "invalid" && blocked.reason.includes("Still drawing"), "ordering by message waits for the drawing");
  }

  // --- A change between subjects is a change to the scene ---------------------------------
  const pair = [
    { id: "a1", name: "Arthur", include: true },
    { id: "a2", name: "Amanda", include: true },
  ] as unknown as Project["anchors"];
  check(changesTheScene("make arthur the same size as amanda", pair), "two people named in one change are a change to the scene");
  check(changesTheScene("make Arthur bigger", pair) && changesTheScene("mach Arthur größer", pair), "size words are a change to the scene");
  check(!changesTheScene("make Arthur's hair yellow", pair) && !changesTheScene("give her an umbrella", pair), "one subject's attribute stays an in-place change");
  check(!changesTheScene("", pair), "an empty sentence changes nothing");

  // --- Somebody added to a page is drawn from their own sheet ----------------------------------
  const amanda = { id: "anchor-amanda", name: "Amanda", kind: "character", description: "a girl with red braids", include: true };
  const cast = { ...drawnBook, anchors: [amanda] } as unknown as Project;
  check(JSON.stringify(anchorsNamedIn("add amanda to page 3", cast.anchors).map((a) => a.id)) === '["anchor-amanda"]', "a name in a sentence finds the cast member, whatever the case");
  check(anchorsNamedIn("add Amandas dog", cast.anchors).length === 0 && anchorsNamedIn("add a girl", cast.anchors).length === 0, "only whole names match");
  const addedCast = edit.run(cast, { change: "add amanda" }, ctxFor([pageIds[1]!]));
  check(
    addedCast.kind === "write" && addedCast.then?.kind === "redrawPage" && castOnPage(addedCast.project, pageIds[1]!).includes("anchor-amanda"),
    "adding a cast member puts her on the page, then redraws it",
  );
  if (addedCast.kind === "write") {
    check(!castOnPage(cast, pageIds[1]!).includes("anchor-amanda"), "the book the skill started from is not touched");
    const saved = snapshotForFields(cast, addedCast.project);
    check(saved !== null && JSON.parse(saved).castBack, "Undo keeps who was on the page before");
    const back = restoreCastOf(addedCast.project, JSON.parse(saved ?? "{}") as Record<string, unknown>);
    check(!castOnPage(back, pageIds[1]!).includes("anchor-amanda"), "Undo takes her off the page again");
    const twice = edit.run(addedCast.project, { change: "add amanda" }, ctxFor([pageIds[1]!]));
    check(twice.kind === "effect", "she is not addedCast twice");
  }
  const viaModel = edit.run(cast, { change: "put her next to the tree", people: "Amanda" }, ctxFor([pageIds[1]!]));
  check(viaModel.kind === "write" && castOnPage(viaModel.project, pageIds[1]!).includes("anchor-amanda"), "a name the model passes is looked up too");
  const stranger = edit.run(cast, { change: "add Bella", people: "Bella" }, ctxFor([pageIds[1]!]));
  check(stranger.kind === "ask" && stranger.arg === "people", "a name the book does not have is asked about, not drawn as a stranger");
  const noReference = edit.run(cast, { change: "add Bella", people: "none" }, ctxFor([pageIds[1]!]));
  check(noReference.kind === "effect", "drawing noReference a reference goes ahead when the reader says so");
  check(edit.run(cast, { change: "make the sky pink", people: "" }, ctxFor([pageIds[1]!])).kind === "effect", "a change that names nobody leaves the page's people alone");

  // --- Bubbles, shapes and the page's own words ----------------------------------------
  const shapesOf = (p: Project, id: string) =>
    ((p.design?.pages[id] as unknown as { shapes?: { kind: string; fill: string; rect: { x: number; y: number; w: number; h: number }; text?: { paragraphs: unknown[] } }[] } | undefined)?.shapes ?? []);
  const textOfPage = (p: Project, id: string) =>
    (p.design?.pages[id]?.textBoxes[0]?.paragraphs ?? []).map((para) => para.spans.map((s) => s.text).join("")).join("\n\n");
  const bubble = GUIDE_COMMANDS.addBubble;
  check(Boolean(bubble) && bubble.aimsAtPages === true && bubble.undoable === true, "addBubble is an undoable skill that aims at named pages");
  const said = bubble.run(paper, { says: "Look at me!" }, ctxFor([pageIds[1]!]));
  check(
    said.kind === "write" &&
      shapesOf(said.project, pageIds[1]!).length === 1 &&
      shapesOf(said.project, pageIds[1]!)[0]!.kind === "bubble-round" &&
      shapesOf(said.project, pageIds[0]!).length === 0,
    "a bubble lands on the named page only",
  );
  if (said.kind === "write") {
    const rect = shapesOf(said.project, pageIds[1]!)[0]!.rect;
    check(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 1.0001 && rect.y + rect.h <= 1.0001, "a bubble stays on the page, in any spot");
    const spots = ["top", "bottom", "left", "right", "center", "top-left", "top-right", "bottom-left", "bottom-right"];
    for (const spot of spots) {
      const at = bubble.run(paper, { says: "x".repeat(140), position: spot }, ctxFor([pageIds[0]!]));
      const r = at.kind === "write" ? shapesOf(at.project, pageIds[0]!)[0]!.rect : null;
      check(r !== null && r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, `the longest bubble fits at ${spot}`);
    }
    const entry = entryOf(paper.design as BookDesign, said.project.design as BookDesign, "Added a bubble");
    const undone = applyEntry(said.project, entry, "undo", { force: true });
    check(shapesOf(undone.project, pageIds[1]!).length === 0, "undo takes the bubble away");
    check(shapesOf(applyEntry(undone.project, entry, "redo", { force: true }).project, pageIds[1]!).length === 1, "redo puts the bubble back");
  }
  check(bubble.run(paper, { says: "Hi" }, ctxFor()).kind === "invalid", "a bubble with no page asks which, never guesses");
  check(bubble.run(paper, { says: "Hi" }, ctxFor([pageIds[0]!, pageIds[1]!])).kind === "invalid", "a bubble goes on one page at a time");
  check(bubble.run(paper, { says: "" }, ctxFor([pageIds[0]!])).kind === "ask", "a bubble with nothing to say asks what");
  check(bubble.run(paper, { says: "Hi", position: "nowhere" }, ctxFor([pageIds[0]!])).kind === "invalid", "an unknown spot is refused");
  const thought = bubble.run(paper, { says: "Hmm", bubble: "thought" }, ctxFor([pageIds[0]!]));
  check(thought.kind === "write" && shapesOf(thought.project, pageIds[0]!)[0]!.kind === "bubble-thought", "a thought bubble is a thought bubble");

  const shape = GUIDE_COMMANDS.addShape;
  const star = shape.run(paper, { shape: "star", color: "yellow" }, ctxFor([pageIds[0]!, pageIds[2]!]));
  check(
    star.kind === "write" &&
      shapesOf(star.project, pageIds[0]!).length === 1 &&
      shapesOf(star.project, pageIds[2]!).length === 1 &&
      shapesOf(star.project, pageIds[1]!).length === 0 &&
      shapesOf(star.project, pageIds[0]!)[0]!.kind === "star" &&
      shapesOf(star.project, pageIds[0]!)[0]!.fill === "#f1c40f",
    "a yellow star goes on each named page, nowhere else",
  );
  check(shape.run(paper, { shape: "star", color: "blorple" }, ctxFor([pageIds[0]!])).kind === "invalid", "an unknown color is refused, not guessed");
  check(shape.run(paper, { shape: "dragon" }, ctxFor([pageIds[0]!])).kind === "invalid", "an unknown shape is refused");
  check(shape.run(paper, { shape: "heart" }, ctxFor()).kind === "invalid", "a shape with no page asks which");

  const clear = GUIDE_COMMANDS.removeDecorations;
  if (said.kind === "write" && star.kind === "write") {
    const both = clear.run(said.project, {}, ctxFor([pageIds[1]!]));
    check(both.kind === "write" && shapesOf(both.project, pageIds[1]!).length === 0, "removing takes the bubble off the page");
    check(clear.run(said.project, { what: "shapes" }, ctxFor([pageIds[1]!])).kind === "invalid", "asking for shapes leaves a bubble alone");
    check(clear.run(said.project, {}, ctxFor([pageIds[0]!])).kind === "invalid", "a page with nothing on it has nothing to remove");
    check(clear.run(said.project, {}, ctxFor()).kind === "invalid", "removing never works on the whole book by default");
    const mixed = clear.run(star.project, { what: "bubbles" }, ctxFor([pageIds[0]!]));
    check(mixed.kind === "invalid", "bubbles only: a star stays");
  }

  const extra = GUIDE_COMMANDS.editExtra;
  if (said.kind === "write" && star.kind === "write") {
    const blue = extra.run(said.project, { color: "blue" }, ctxFor([pageIds[1]!]));
    check(blue.kind === "write" && shapesOf(blue.project, pageIds[1]!)[0]!.fill === "#1d4ed8", "an existing bubble changes color");
    const reworded = extra.run(said.project, { says: "Wow!" }, ctxFor([pageIds[1]!]));
    check(
      reworded.kind === "write" && JSON.stringify(shapesOf(reworded.project, pageIds[1]!)[0]!.text).includes("Wow!"),
      "an existing bubble says something else",
    );
    const bigger = extra.run(star.project, { size: "larger" }, ctxFor([pageIds[0]!]));
    check(
      bigger.kind === "write" && shapesOf(bigger.project, pageIds[0]!)[0]!.rect.h > shapesOf(star.project, pageIds[0]!)[0]!.rect.h,
      "a shape gets larger",
    );
    const moved = extra.run(star.project, { position: "bottom-left" }, ctxFor([pageIds[0]!]));
    const mr = moved.kind === "write" ? shapesOf(moved.project, pageIds[0]!)[0]!.rect : null;
    check(mr !== null && mr.x < 0.3 && mr.y > 0.6 && mr.x >= 0 && mr.y + mr.h <= 1.0001, "a shape moves to the named spot and stays on the page");
    check(extra.run(star.project, { says: "Hi" }, ctxFor([pageIds[0]!])).kind === "invalid", "a star has no words to change");
    check(extra.run(star.project, { color: "blorple" }, ctxFor([pageIds[0]!])).kind === "invalid", "an unknown color is refused");
    check(extra.run(said.project, { color: "blue" }, ctxFor([pageIds[0]!])).kind === "invalid", "a page with no extras has nothing to change");
    check(extra.run(said.project, {}, ctxFor([pageIds[1]!])).kind === "ask", "no change given asks what");
    check(extra.run(said.project, { color: "blue" }, ctxFor()).kind === "invalid", "no page asks which");
    const twoOnPage = shape.run(said.project, { shape: "heart" }, ctxFor([pageIds[1]!]));
    if (twoOnPage.kind === "write") {
      check(extra.run(twoOnPage.project, { color: "red" }, ctxFor([pageIds[1]!])).kind === "invalid", "two extras on a page are never guessed between");
      const pick = extra.run(twoOnPage.project, { which: "heart", color: "red" }, ctxFor([pageIds[1]!]));
      check(pick.kind === "write" && shapesOf(pick.project, pageIds[1]!).find((s) => s.kind === "heart")?.fill === "#c0392b", "naming the kind picks the one");
      const bub = extra.run(twoOnPage.project, { which: "bubble", tail: "up" }, ctxFor([pageIds[1]!]));
      check(bub.kind === "write", "a bubble's tail can be turned");
    }
  }

  const coverBox = (role: string, text: string, extra: Record<string, unknown> = {}) => ({
    ...box("#111111"),
    id: `c-${role}`,
    role,
    paragraphs: [{ id: "p", spans: [{ text }] }],
    ...extra,
  });
  const withCover = (boxes: unknown[]): Project =>
    ({ ...paper, design: { ...(paper.design as BookDesign), pages: { ...(paper.design as BookDesign).pages, [COVER_FRONT_ID]: { textBoxes: boxes } } } }) as unknown as Project;
  const coverWords = GUIDE_COMMANDS.editCoverWords;
  check(coverWords.structural === true && coverWords.undoable === true, "cover words go back whole with Undo");
  const coverBook = withCover([coverBox("book-title", "T"), coverBox("book-subtitle", "")]);
  const retitled = coverWords.run(coverBook, { part: "title", words: "Moonlight" }, ctxFor());
  check(
    retitled.kind === "write" &&
      retitled.project.title === "Moonlight" &&
      (retitled.project.design?.pages[COVER_FRONT_ID]?.textBoxes[0]?.paragraphs[0]?.spans.map((s) => s.text).join("") ?? "") === "Moonlight",
    "a new cover title reaches the project name and the cover's text box",
  );
  const resub = coverWords.run(coverBook, { part: "subtitle", words: "A bedtime story" }, ctxFor());
  check(
    resub.kind === "write" && (resub.project.design?.pages[COVER_FRONT_ID]?.textBoxes[1]?.paragraphs[0]?.spans.map((s) => s.text).join("") ?? "") === "A bedtime story",
    "a new subtitle reaches the cover's text box",
  );
  const unsub = resub.kind === "write" ? coverWords.run(resub.project, { part: "subtitle", remove: "yes" }, ctxFor()) : resub;
  check(unsub.kind === "write" && /Removed the subtitle/.test(unsub.beat.receipt ?? ""), "a subtitle can be taken off the cover");
  check(coverWords.run(coverBook, { part: "title" }, ctxFor()).kind === "ask", "a title with no words asks what it should say");
  check(coverWords.run(coverBook, { part: "title", remove: "yes" }, ctxFor()).kind === "ask", "a title can't be removed");
  check(coverWords.run(coverBook, { part: "chapter", words: "x" }, ctxFor()).kind === "invalid", "an unknown part is refused");
  const painted = withCover([coverBox("book-title", "T", { hidden: true })]);
  const repainted = coverWords.run(painted, { part: "title", words: "New" }, ctxFor());
  check(repainted.kind === "write" && /painted into the cover picture/.test(repainted.beat.text ?? ""), "words painted into the cover picture say it keeps the old ones");

  const words = GUIDE_COMMANDS.editPageWords;
  const newWords = words.run(paper, { words: "Aren ran home." }, ctxFor([pageIds[1]!]));
  check(
    newWords.kind === "write" && textOfPage(newWords.project, pageIds[1]!) === "Aren ran home." && textOfPage(newWords.project, pageIds[0]!) === "Hello",
    "the words of one page change and the others stay",
  );
  const swapped = words.run(paper, { words: "Help", from: "hello" }, ctxFor([pageIds[0]!]));
  check(swapped.kind === "write" && textOfPage(swapped.project, pageIds[0]!) === "Help", "one word is replaced, whatever its case");
  check(words.run(paper, { words: "x", from: "zebra" }, ctxFor([pageIds[0]!])).kind === "invalid", "a word that is not on the page is reported");
  check(words.run(paper, { words: "Hello" }, ctxFor([pageIds[0]!])).kind === "noop", "the same words change nothing");
  check(words.run(paper, { words: "x" }, ctxFor()).kind === "invalid", "new words with no page asks which");
  check(words.run(paper, { words: "x" }, ctxFor([pageIds[0]!, pageIds[1]!])).kind === "invalid", "one page's words at a time");
  check(words.run(paper, { words: "x" }, ctxFor([COVER_FRONT_ID])).kind === "invalid", "the cover words are another skill");
  const longWords = words.run(paper, { words: "a ".repeat(2000) }, ctxFor([pageIds[0]!]));
  check(longWords.kind === "write" && textOfPage(longWords.project, pageIds[0]!).length <= 700, "page words are capped");

  // --- Out-of-date pictures, the print check and ordering ---------------------------------
  const refresh = GUIDE_COMMANDS.refreshPictures;
  const staleCtx = (stalePages: string[]) => ({ stalePages }) as unknown as CommandContext;
  check(refresh.paid === true, "refreshing pictures is a paid skill");
  check(refresh.run(twoDrawn, {}, staleCtx([])).kind === "invalid", "nothing out of date says so instead of redrawing");
  const refreshed = refresh.run(twoDrawn, {}, staleCtx([pageIds[0]!, pageIds[1]!, "gone", pageIds[2]!]));
  check(
    refreshed.kind === "effect" &&
      refreshed.effect.kind === "redrawPage" &&
      refreshed.effect.unitIds.join() === `${pageIds[0]},${pageIds[1]}` &&
      refreshed.effect.mode === "new",
    "only out-of-date pages that still have a picture are redrawn, drawn again",
  );
  const checkPrint = GUIDE_COMMANDS.checkPrint.run(paper, {}, ctxFor());
  check(checkPrint.kind === "noop" && /no picture yet/.test(checkPrint.beat?.text ?? ""), "the print check names pages with no picture");
  const order = GUIDE_COMMANDS.orderBook.run(paper, {}, ctxFor());
  check(order.kind === "invalid" && /no picture/.test(order.reason), "a book with undrawn pages cannot be ordered from the chat");

  // --- Page operations ------------------------------------------------------------------
  const five = bookWithPages(5);
  const fiveIds = interiorUnitIds(five);
  const orderOf = (p: Project) => interiorUnitIds(p).join(",");
  const run = (id: "addPage" | "removePage" | "duplicatePage" | "movePage", p: Project, args: Record<string, string>, pages?: string[]) =>
    GUIDE_COMMANDS[id].run(p, args, ctxFor(pages));

  const atEnd = run("addPage", five, {});
  check(atEnd.kind === "write" && interiorUnitIds(atEnd.project).length === 6 && interiorUnitIds(atEnd.project).slice(0, 5).join(",") === fiveIds.join(","), "a page added with no place goes at the end");
  const afterTwo = run("addPage", five, { where: "after" }, [fiveIds[1]!]);
  check(afterTwo.kind === "write" && interiorUnitIds(afterTwo.project)[2] !== fiveIds[2] && interiorUnitIds(afterTwo.project)[3] === fiveIds[2], "a page added after page 2 becomes page 3");
  const atStart = run("addPage", five, { where: "start" });
  check(atStart.kind === "write" && interiorUnitIds(atStart.project)[1] === fiveIds[0], "a page added at the start pushes the others down");
  check(run("addPage", five, { where: "before" }).kind === "invalid", "before with no page named asks which");

  const removed = run("removePage", five, {}, [fiveIds[2]!]);
  check(removed.kind === "write" && interiorUnitIds(removed.project).join(",") === fiveIds.filter((id) => id !== fiveIds[2]).join(","), "removing page 3 leaves the others in order");
  check(run("removePage", five, {}).kind === "invalid", "removing with no page named asks which, never guesses");
  check(run("removePage", five, {}, [fiveIds[0]!, fiveIds[1]!]).kind === "invalid", "two pages to remove at once are not guessed at");
  check(run("removePage", bookWithPages(1), {}, [interiorUnitIds(bookWithPages(1))[0]!]).kind === "invalid", "the last page can't be removed");
  check(GUIDE_COMMANDS.removePage.alwaysConfirm === true, "removing a page always confirms");
  const impact = GUIDE_COMMANDS.removePage.impact?.(five, {}, ctxFor([fiveIds[2]!]));
  check(impact?.level === "destructive" && impact.effects[0]?.kind === "removesPage" && (impact.effects[0] as { page: number }).page === 3, "the removal card names the page");

  const copy = run("duplicatePage", five, {}, [fiveIds[1]!]);
  check(copy.kind === "write" && interiorUnitIds(copy.project).length === 6 && interiorUnitIds(copy.project)[1] === fiveIds[1] && interiorUnitIds(copy.project)[2] !== fiveIds[2], "a copy lands right after its page");

  const toEnd = run("movePage", five, { to: "last" }, [fiveIds[0]!]);
  check(toEnd.kind === "write" && orderOf(toEnd.project) === [...fiveIds.slice(1), fiveIds[0]!].join(","), "page 1 to the end");
  const toThree = run("movePage", five, { to: "3" }, [fiveIds[0]!]);
  check(toThree.kind === "write" && orderOf(toThree.project) === [fiveIds[1], fiveIds[2], fiveIds[0], fiveIds[3], fiveIds[4]].join(","), "page 1 to page 3");
  const toFirst = run("movePage", five, { to: "first" }, [fiveIds[4]!]);
  check(toFirst.kind === "write" && orderOf(toFirst.project) === [fiveIds[4], ...fiveIds.slice(0, 4)].join(","), "page 5 to the start");
  check(run("movePage", five, { to: "9" }, [fiveIds[0]!]).kind === "invalid", "a place the book does not have is refused");
  check(run("movePage", five, { to: "1" }, [fiveIds[0]!]).kind === "noop", "moving a page where it is does nothing");

  // A page edit goes back whole through the change log, and forward again.
  if (removed.kind === "write") {
    const entry: ChangeEntry = {
      id: "structural",
      at: 1,
      source: "chat",
      label: "Removed page 3",
      pages: ["*"],
      ops: [],
      structural: {
        before: { design: undefined, screenplay: five.screenplay, illustrations: undefined },
        after: { design: undefined, screenplay: removed.project.screenplay, illustrations: undefined },
      },
      state: "applied",
    };
    const undone = applyEntry(removed.project, entry, "undo", { force: true });
    check(orderOf(undone.project) === fiveIds.join(","), "undoing a removed page brings it back in its place");
    const redone = applyEntry(undone.project, entry, "redo", { force: true });
    check(orderOf(redone.project) === orderOf(removed.project), "redoing the removal takes it out again");
  }

  // A spot marked on the page is mapped onto the picture before it becomes a mask.
  {
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const picture = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    const inside = regionOnPicture({ x: 0.2, y: 0.3, w: 0.2, h: 0.3 }, picture);
    check(
      !!inside && near(inside.x, 0.2) && near(inside.y, 1 / 6) && near(inside.w, 0.4) && near(inside.h, 0.5),
      "a spot inside the picture is read as fractions of the picture, not of the page",
    );
    const half = regionOnPicture({ x: 0.5, y: 0.3, w: 0.4, h: 0.2 }, picture);
    check(!!half && near(half.x, 0.8) && near(half.w, 0.2) && half.x + half.w <= 1 + 1e-9, "a spot that runs off the picture is cut at its edge");
    check(regionOnPicture({ x: 0.7, y: 0.3, w: 0.2, h: 0.2 }, picture) === null, "a spot beside the picture, on the page color, is dropped");
    check(regionOnPicture({ x: 0.59, y: 0.3, w: 0.2, h: 0.2 }, picture) === null, "a sliver of a spot on the picture is dropped");
    check(regionOnPicture({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })?.w === 1, "on a full-page picture the spot is unchanged");

    const withFrame = five as unknown as Project;
    const unit = fiveIds[0]!;
    const placed = {
      ...withFrame,
      design: {
        ...(withFrame.design as BookDesign),
        pages: {
          ...(withFrame.design?.pages ?? {}),
          [unit]: {
            textBoxes: [],
            images: [{ id: "im", kind: "illustration", rect: picture, z: 0, fit: "cover" }],
          },
        },
      },
    } as unknown as Project;
    const found = pictureRectOnPage(placed, unit);
    check(near(found.x, 0.1) && near(found.w, 0.5), "the picture's place on the page comes from the page's design");
    const bare = pictureRectOnPage(withFrame, fiveIds[1]!);
    check(bare.x === 0 && bare.w === 1 && bare.h === 1, "a page with no placed picture is read as all picture");
  }

  report.push(`  history     ${cases} cases`);
  return { failures, notes, report, cases };
}
