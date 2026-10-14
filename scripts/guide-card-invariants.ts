/**
 * The card on screen stays until it is answered (`core/guide/cardDeck.ts`).
 *
 * Walks long random runs of what happens around a card: questions that open
 * ahead of it or behind it, a reading, a plan or a portrait that finishes, a
 * question that leaves the list without an answer (for a moment or for good),
 * data that changes under the card, replies to the reader, failures, a person
 * removed from the book, and the reader answering. After every step the card
 * that was on screen must still be there unless the reader answered it, its
 * question stayed done past the grace with nobody on the card, or the person
 * it is about is gone.
 */
import {
  CARD_GRACE_MS,
  EMPTY_DECK,
  cardId,
  pickCards,
  placeCard,
  type CardDeck,
} from "../books-frontend/src/core/guide/cardDeck";
import { ATTENTION_WELLS } from "../books-frontend/src/core/guide/conversation";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(ok: boolean, message: string): void {
  cases += 1;
  if (!ok && failures.length < 40) failures.push(`cards: ${message}`);
}

interface Card {
  kind: string;
  castId?: string;
  stale?: boolean;
  names?: string[];
  castIds?: string[];
}

/** A tiny deterministic random source, so a failing run can be replayed. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const STEPS: Card[] = [
  { kind: "formatChoice" },
  { kind: "layoutChoice" },
  { kind: "coverWords" },
  { kind: "audienceConfirm" },
  { kind: "castAges" },
  { kind: "pictureNotes" },
  { kind: "castLooks", castId: "arthur" },
  { kind: "castLooks", castId: "amanda" },
  { kind: "styleChoice" },
  { kind: "portraits", castIds: ["a", "b", "c"], names: ["Arthur", "Amanda", "Mom"] },
  { kind: "drawBook" },
];
const URGENT: Card[] = [{ kind: "castFix" }, { kind: "bookUpdate" }, { kind: "storyRetry" }];
const REPLIES: Card[] = [{ kind: "redraw" }, { kind: "whichName" }, { kind: "manuscriptChoice" }, { kind: "extractionRetry" }];

const presentIn =
  (removed: ReadonlySet<string>) =>
  (card: Card): boolean =>
    !(card.castId && removed.has(card.castId));

// --- Random runs ---------------------------------------------------------------------------------

let replaced = 0;
let kept = 0;
let keptStale = 0;
let answered = 0;
for (let seed = 1; seed <= 400; seed += 1) {
  const random = rng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  let pool: Card[] = STEPS.filter(() => random() < 0.5);
  let reply: Card | null = null;
  let deck: CardDeck = EMPTY_DECK;
  let lastLook: { id: string; well: Card } | null = null;
  let now = 1_000;
  let actedAt = -1;
  let left: Card | null = null;
  let holding = false;
  let goneSince: number | null = null;
  const removed = new Set<string>();

  for (let tick = 0; tick < 120; tick += 1) {
    const before = deck.shown;
    const placedAt = deck.since;
    now += Math.floor(random() * 400) + 20;
    // The reader moves onto the card (typing in it) and away again.
    if (random() < 0.2) holding = !holding;
    const roll = random();
    let answer = false;
    let personGone = false;
    let returned = false;
    if (left && random() < 0.3) {
      if (!pool.some((item) => cardId(item) === cardId(left!))) pool = [left, ...pool];
      left = null;
      returned = true;
    }
    if (roll < 0.18) {
      // A question opens: often ahead of the one on screen.
      const next = pick(STEPS);
      if (!pool.some((item) => cardId(item) === cardId(next)) && presentIn(removed)(next)) {
        const at = random() < 0.6 ? 0 : Math.floor(random() * (pool.length + 1));
        pool = [...pool.slice(0, at), next, ...pool.slice(at)];
      }
    } else if (roll < 0.26) {
      // A failure or blocker opens ahead of everything.
      const next = pick(URGENT);
      if (!pool.some((item) => item.kind === next.kind)) pool = [next, ...pool];
    } else if (roll < 0.36 && before && !returned) {
      // The question on screen leaves the list without an answer: a plan lands,
      // two saves cross. Sometimes it comes back, sometimes not.
      const card = pool.find((item) => cardId(item) === before);
      if (card) {
        pool = pool.filter((item) => item !== card);
        if (random() < 0.5) left = card;
      }
    } else if (roll < 0.46 && before) {
      // What the card shows changes underneath it.
      pool = pool.map((item) =>
        cardId(item) === before && item.castIds ? { ...item, castIds: item.castIds.slice(1), names: item.names?.slice(1) } : item,
      );
    } else if (roll < 0.56) {
      reply = random() < 0.5 ? pick(REPLIES) : null;
    } else if (roll < 0.66 && before) {
      // The reader answers the card on screen.
      pool = pool.filter((item) => cardId(item) !== before);
      if (left && cardId(left) === before) left = null;
      actedAt = now;
      answer = true;
    } else if (roll < 0.69 && before?.startsWith("castLooks:")) {
      // The person the card is about is taken out of the book.
      const id = before.slice("castLooks:".length);
      removed.add(id);
      pool = pool.filter((item) => item.castId !== id);
      if (left?.castId === id) left = null;
      personGone = true;
    } else if (roll < 0.75) {
      // Something behind the card goes away.
      const behind = pool.filter((item) => cardId(item) !== before);
      if (behind.length > 0) {
        const gone = pick(behind);
        pool = pool.filter((item) => item !== gone);
      }
    }

    const stillOpen = before !== null && pool.some((item) => cardId(item) === before);
    goneSince = before && !stillOpen ? (goneSince ?? now) : null;

    const picked = pickCards({
      deck,
      pool,
      reply,
      now,
      acted: deck.shown !== null && actedAt > deck.since,
      holding,
      lastLook,
      present: presentIn(removed),
      urgent: ATTENTION_WELLS,
    });
    deck = picked.step.deck;
    if (picked.main && picked.mainId) {
      if (!picked.step.onScreen) deck = placeCard(deck, picked.mainId, now);
      if (picked.live) lastLook = { id: picked.mainId, well: picked.main };
    }
    const after = deck.shown;
    const actedOnIt = actedAt > placedAt;
    const inGrace = goneSince !== null && now - goneSince < CARD_GRACE_MS;

    if (before && !answer && !personGone && (stillOpen || (!actedOnIt && (holding || inGrace)))) {
      check(after === before, `seed ${seed} tick ${tick}: "${before}" was replaced by "${after}" before the reader answered it.`);
      check(picked.step.onScreen, `seed ${seed} tick ${tick}: "${before}" was announced again although it was on screen.`);
      kept += 1;
      if (!stillOpen) keptStale += 1;
    }
    if (before && !stillOpen && !holding && goneSince !== null && !inGrace) {
      check(after !== before, `seed ${seed} tick ${tick}: "${before}" stayed although its question was done and nobody was on it.`);
    }
    if (after !== before) goneSince = null;
    if (before && answer) {
      answered += 1;
      check(after !== before, `seed ${seed} tick ${tick}: "${before}" stayed after the reader answered it.`);
      check(after === (pool[0] ? cardId(pool[0]) : null), `seed ${seed} tick ${tick}: after an answer, "${after}" came instead of the next in line.`);
    }
    if (before && personGone) {
      check(after !== before, `seed ${seed} tick ${tick}: "${before}" stayed after its person left the book.`);
    }
    if (before && after !== before) replaced += 1;
    check(
      picked.besideId === null || picked.besideId !== picked.mainId,
      `seed ${seed} tick ${tick}: the same card shows twice.`,
    );
    if (reply && before && stillOpen) {
      check(picked.mainId === before, `seed ${seed} tick ${tick}: a reply took the place of "${before}".`);
      check(picked.beside === reply || cardId(reply) === before, `seed ${seed} tick ${tick}: a reply to the reader is not shown.`);
    }
    if (picked.main && cardId(picked.main) !== picked.mainId) {
      check(false, `seed ${seed} tick ${tick}: the card shown is not the card on record.`);
    }
  }
}
const runs = `  random runs: ${kept} steps kept a card on screen (${keptStale} after its question left the list), ${answered} answers moved on, ${replaced} changes in all`;

// --- The reported cases --------------------------------------------------------------------------

{
  const present = (): boolean => true;
  const base = { reply: null, now: 20, acted: false, holding: false, present, urgent: ATTENTION_WELLS };
  // Typing in the story never hides the audience card: nothing about focus elsewhere reaches the deck.
  const audience = { kind: "audienceConfirm" };
  let deck = placeCard(EMPTY_DECK, cardId(audience), 10);
  const picked = pickCards({ ...base, deck, pool: [audience], lastLook: { id: "audienceConfirm", well: audience } });
  check(picked.mainId === "audienceConfirm" && picked.step.onScreen, "The audience card left the screen.");

  // The reading finishes during the layout question: the people's questions come after it.
  const layout = { kind: "layoutChoice" };
  deck = placeCard(EMPTY_DECK, "layoutChoice", 10);
  const read = pickCards({
    ...base,
    deck,
    pool: [{ kind: "castFix" }, { kind: "castAges" }, layout, { kind: "coverWords" }],
    lastLook: { id: "layoutChoice", well: layout },
  });
  check(read.mainId === "layoutChoice", "The layout card was replaced when the reading finished.");
  check(read.besideId === "castFix", "A blocker from the reading isn't shown beside the layout card.");

  // Portraits land while the cover words are typed: the cover card stays; the redraw offer comes beside it.
  const cover = { kind: "coverWords" };
  deck = placeCard(EMPTY_DECK, "coverWords", 10);
  const landed = pickCards({
    ...base,
    deck,
    pool: [{ kind: "castLooks", castId: "amanda" }, cover],
    reply: { kind: "redraw" },
    lastLook: { id: "coverWords", well: cover },
  });
  check(landed.mainId === "coverWords" && landed.besideId === "redraw", "Portraits landing replaced the cover card.");

  // The cover question drops out for one save: the card stays through it.
  const blip = pickCards({ ...base, deck, pool: [{ kind: "castAges" }], now: 40, lastLook: { id: "coverWords", well: cover } });
  check(blip.mainId === "coverWords" && blip.step.onScreen, "The cover card left during a moment its question was gone.");

  // A question closes while the reader is typing in its card: the card stays,
  // however long they take, and goes only once they answer.
  const notesCard = { kind: "pictureNotes" };
  let notesDeck = placeCard(EMPTY_DECK, "pictureNotes", 10);
  const later = [{ kind: "lookAlike" }, { kind: "castLooks", castId: "arthur" }];
  for (let wait = 0; wait < 50; wait += 1) {
    const typing = pickCards({
      ...base,
      deck: notesDeck,
      pool: later,
      now: 20 + wait * 1000,
      holding: true,
      lastLook: { id: "pictureNotes", well: notesCard },
    });
    notesDeck = typing.step.deck;
    check(typing.mainId === "pictureNotes" && typing.step.onScreen, "A card being typed in was replaced when its question closed.");
  }
  const next = pickCards({
    ...base,
    deck: notesDeck,
    pool: later,
    now: 60_000,
    acted: true,
    holding: true,
    lastLook: { id: "pictureNotes", well: notesCard },
  });
  check(next.mainId === cardId({ kind: "lookAlike" }) && !next.step.onScreen, "After the notes were answered, the next card didn't come.");

  // An offer the book finished by itself (the portrait it offered got drawn)
  // goes once nobody is on it: it would otherwise offer to pay for it again.
  const offer = { kind: "portraits", castIds: ["amanda"], names: ["Amanda"] };
  let offerDeck = placeCard(EMPTY_DECK, cardId(offer), 10);
  const done = [{ kind: "drawBook" }];
  offerDeck = pickCards({ ...base, deck: offerDeck, pool: done, now: 100, lastLook: { id: cardId(offer), well: offer } }).step.deck;
  const settled = pickCards({ ...base, deck: offerDeck, pool: done, now: 100 + CARD_GRACE_MS, lastLook: { id: cardId(offer), well: offer } });
  check(settled.mainId === "drawBook", "A portrait offer stayed after the portrait was drawn.");

  // A person taken out of the book takes their card with them, even while the reader is on it.
  const looks = { kind: "castLooks", castId: "amanda" };
  const out = pickCards({
    ...base,
    deck: placeCard(EMPTY_DECK, cardId(looks), 10),
    pool: [{ kind: "styleChoice" }],
    holding: true,
    lastLook: { id: cardId(looks), well: looks },
    present: (card) => card.castId !== "amanda",
  });
  check(out.mainId === "styleChoice", "A removed person's card stayed on screen.");

  // A portrait finishing changes the card's names, not the card.
  const drawing = { kind: "portraits", castIds: ["a", "b"], names: ["Arthur", "Amanda"] };
  const fewer = { ...drawing, castIds: ["b"], names: ["Amanda"] };
  check(cardId(drawing) === cardId(fewer), "A finished portrait made the portraits card a new card.");
  check(cardId({ kind: "castLooks", castId: "a" }) !== cardId({ kind: "castLooks", castId: "b" }), "Two people's looks are one card.");
}

report.push("Cards on screen");
report.push("  stay until answered, and while the reader is on them; new ones wait in line; replies and failures show beside");
report.push(runs);
notes.push("Cards: random runs of openings, failures, replies, questions leaving, people removed and answers around the card on screen");

export function checkGuideCards(): CheckResult {
  return { failures, notes, report, cases };
}
