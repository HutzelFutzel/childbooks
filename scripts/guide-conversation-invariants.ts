/**
 * Invariants for how the Chat's buttons take part in the conversation.
 *
 * The claims worth checking are the ones a parent would notice:
 *
 * - a card shows under the line that asked for it. When the reader edits the
 *   book, the card updates without a new line. A tap, or a card that needs
 *   attention, is asked first;
 * - while the guide waits on an answer in words, no unrelated card appears,
 *   except one that needs attention;
 * - news that lands meanwhile doesn't hide the card it arrived under;
 * - one message never asks two things, and never drops its question;
 * - every line that introduces a card has a default and an admin hint.
 *
 * Offline and deterministic: pure functions over synthesized transcripts.
 */
import { holdsWell } from "../books-frontend/src/core/guide/attention";
import { ATTENTION_WELLS, WELL_INTRO_LINES, floorIsOpen, isQuietMessage, latestTurn, wellForKeys, wellStage } from "../books-frontend/src/core/guide/conversation";
import { DEFAULT_GUIDE_COPY, GUIDE_COPY_HELP, type GuideLineKey } from "../books-frontend/src/core/guide/copy";
import type { GuideMessage } from "../books-frontend/src/core/guide/session";
import { arbitrateGuideLines, type GuideLineCandidate } from "../books-frontend/src/core/guide/speech";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

let nextId = 0;
function guide(text: string, extra: Partial<GuideMessage> = {}): GuideMessage {
  nextId += 1;
  return { id: `g${nextId}`, role: "guide", text, at: nextId, ...extra };
}
function reader(text: string, extra: Partial<GuideMessage> = {}): GuideMessage {
  nextId += 1;
  return { id: `r${nextId}`, role: "reader", text, at: nextId, ...extra };
}

const stage = (messages: GuideMessage[], over: Partial<Parameters<typeof wellStage>[0]> = {}) =>
  wellStage({ topic: "styleChoice", kind: "styleChoice", messages, busy: false, hasIntro: true, canAnswer: true, locale: "en-US", ...over });

// --- Intro lines: said, explained, pointing at a card ---------------------------------------------

{
  const keys = Object.keys(WELL_INTRO_LINES) as GuideLineKey[];
  for (const key of keys) {
    check(Boolean(DEFAULT_GUIDE_COPY[key]?.trim()), `Intro line ${key} has no default wording.`);
    check(Boolean(GUIDE_COPY_HELP[key]?.trim()), `Intro line ${key} has no admin hint.`);
    check(wellForKeys([key]) === WELL_INTRO_LINES[key], `Intro line ${key} doesn't tag the card it introduces.`);
  }
  check(wellForKeys(["acknowledge" as GuideLineKey]) === undefined, "A line that introduces no card was tagged with one.");
  for (const kind of ["styleChoice", "formatChoice", "layoutChoice", "storyBrief", "drawBook", "order"]) {
    check(Object.values(WELL_INTRO_LINES).includes(kind), `The ${kind} card has no line to introduce it.`);
  }
  report.push("Conversation");
  report.push(`  ${keys.length} intro lines, ${ATTENTION_WELLS.size} cards that may interrupt`);
}

// --- Stages: show, announce, wait -----------------------------------------------------------------

{
  check(stage([], { hasIntro: false }) === "show", "A card without an intro line is held back.");
  check(stage([]) === "announce", "A card on an empty thread shows without its line.");
  check(stage([], { busy: true }) === "wait", "A card is announced while a turn is still running.");

  const intro = guide("How should the book look? Pick the style you like best.", { well: "styleChoice", keys: ["askLook"] });
  check(stage([intro]) === "show", "A card doesn't show under the line that introduced it.");
  check(stage([intro], { busy: true }) === "show", "A card disappears while the reader's tap on it is answered.");

  const notice = guide("Maya's picture is ready.", { keys: ["firstPortrait", "notice"] });
  check(isQuietMessage(notice), "A notice counts as the guide taking the floor.");
  check(stage([intro, notice]) === "show", "A notice that landed under a card hides the card.");
  check(latestTurn([intro, notice]) === intro, "A notice counts as the guide's latest word.");

  const other = guide("What shape and size should the book be?", { well: "formatChoice", keys: ["askFormat"] });
  check(stage([other]) === "show", "An edit on the book makes the guide ask again instead of updating the card.");
  check(
    stage([other], { topic: "pageFix", kind: "pageFix" }) === "announce",
    "A failed picture updates the card without the guide saying so.",
  );
  check(
    stage([other], { topic: "bookUpdate", kind: "bookUpdate" }) === "announce",
    "An edit after the pages started updates the card without saying the pictures need updating.",
  );
  check(stage([other], { busy: true }) === "wait", "A card is announced over a running turn.");

  const facts = guide("Who is the story for, and how old are they?", { keys: ["askNamesAges" as GuideLineKey] });
  check(stage([facts]) === "wait", "The style card appears while the guide asks who the story is for.");
  check(stage([facts], { canAnswer: false }) === "announce", "A question nobody can answer (no message field) blocks the card forever.");
  check(
    stage([facts], { topic: "castFix", kind: "castFix" }) === "announce",
    "A card that needs attention waits behind an ordinary question.",
  );

  const statement = guide("Lovely, that's a good start.");
  check(stage([statement]) === "announce", "A card shows under a line that didn't introduce it.");

  const tap = reader("Watercolor", { keys: ["tap"] });
  check(stage([intro, tap]) === "announce", "A card shows under the reader's tap without the guide saying anything.");
  check(stage([intro, tap], { busy: true }) === "wait", "The next card is announced before the tap is answered.");

  const pending = guide("Wie soll das Buch aussehen?", { well: "styleChoice", pending: true });
  check(stage([facts, pending]) === "wait", "A card shows before its line has been phrased.");
  check(latestTurn([facts, pending]) === pending, "A line still being phrased isn't the latest word.");

  check(floorIsOpen([facts], "en-US"), "A question in words doesn't hold the floor.");
  check(floorIsOpen([intro], "en-US"), "A line introducing a card doesn't hold the floor.");
  check(!floorIsOpen([statement], "en-US"), "A plain statement holds the floor.");
  check(!floorIsOpen([facts, reader("Maya, 4")], "en-US"), "The floor stays held after the reader answered.");

  const german = guide("Who is it for?", { localized: { locale: "de-DE", text: "Für wen ist es." } });
  check(floorIsOpen([german], "en-US") && !floorIsOpen([german], "de-DE"), "The floor ignores the language the line is shown in.");
}

// --- One message, one question ----------------------------------------------------------------------

{
  const lines = (candidates: GuideLineCandidate[]) => arbitrateGuideLines(candidates)?.keys ?? [];
  const four = lines([
    { key: "firstPortrait", priority: "result" },
    { key: "storyReady", priority: "result" },
    { key: "castConfirmed", priority: "answer" },
    { key: "askLook", priority: "question" },
  ]);
  check(four.length === 3, `Four candidates became ${four.length} lines, not three.`);
  check(four[four.length - 1] === "askLook", "The question was dropped or not said last.");

  const twoQuestions = lines([
    { key: "askLook", priority: "question" },
    { key: "askFormat", priority: "question" },
  ]);
  check(twoQuestions.length === 1 && twoQuestions[0] === "askLook", "One message asks two things.");

  const blocked = lines([
    { key: "storyFailed", priority: "blocking" },
    { key: "askLook", priority: "question" },
  ]);
  check(blocked.length === 1 && blocked[0] === "storyFailed", "A blocking line isn't said alone.");
}

// --- One place for attention ---------------------------------------------------------------------------

{
  const held = (wellKind: string, over: Partial<Parameters<typeof holdsWell>[0]> = {}) =>
    holdsWell({ storyFocus: "editing", wellKind, asked: false, ...over });
  for (const kind of ["storyDone", "audienceConfirm", "castAges", "storyBrief", "styleChoice", "coverWords", "drawBook", "portraits", "order"]) {
    check(held(kind), `The ${kind} card is put in front of the reader while they type in the story.`);
    check(held(kind, { storyFocus: "reviewing" }), `The ${kind} card is put in front of the reader while they review a change.`);
    check(!held(kind, { storyFocus: null }), `The ${kind} card is held when the reader is not in the story.`);
    check(!held(kind, { asked: true }), `The ${kind} card is held although the reader asked for it.`);
  }
  for (const kind of [...ATTENTION_WELLS, "extractionRetry", "whichName", "redraw", "manuscriptChoice", "agentConfirm", "agentAsk", "agentBlocked", "sparksOffer"]) {
    check(!held(kind), `The ${kind} card is held back, but it is a failure or something the reader just asked for.`);
  }
  check(!holdsWell({ storyFocus: "editing", wellKind: null, asked: false }), "Nothing is held when no card is open.");
  report.push(`  attention: held while typing or reviewing, never failures or what the reader asked for`);
}

notes.push("Conversation: cards shown, announced and held against synthesized transcripts");

export function checkGuideConversation(): CheckResult {
  return { failures, notes, report, cases };
}
