/**
 * The card on screen.
 *
 * One rule: a card the reader can see stays until its question is answered.
 * Nothing that happens meanwhile (a reading that finishes, a plan or a
 * portrait that lands, a reply, a failure) takes its place: it waits in line
 * and comes next, or, when it can't wait, shows beside it.
 *
 * A question closes when it is answered or done (the portrait it offered is
 * drawn). One that drops out of the list for a moment (two saves crossing, a
 * job landing) is not an answer: the card stays through a short grace. And
 * while the reader is on the card (typing in it, pointing at it) it stays
 * however long its question is gone; it goes once they act or move away.
 *
 * Pure, so the rule can be walked offline.
 */

export interface CardDeck {
  /** The card on screen, by identity (`cardId`). */
  shown: string | null;
  /** When it was put on screen. */
  since: number;
  /** When its question was first seen gone; null while it is still open. */
  missingSince: number | null;
  /** The card beside it (a reply to the reader, a failure), once on screen. */
  beside: string | null;
}

export const EMPTY_DECK: CardDeck = { shown: null, since: 0, missingSince: null, beside: null };

/** How long a question may be gone before its card goes, unless the reader is on it. */
export const CARD_GRACE_MS = 1200;

/**
 * Who a card is: its question and the one it is about. What it shows (names,
 * counts, prices) can change without it becoming another card.
 */
export function cardId(well: { kind: string }): string {
  const item = well as {
    kind: string;
    stale?: boolean;
    castId?: string;
    unitId?: string;
    ids?: string[];
    confirm?: { hash?: string };
    topic?: string;
  };
  switch (item.kind) {
    case "castLooks":
      return `castLooks:${item.castId ?? ""}`;
    case "portraits":
      return item.stale ? "portraits:stale" : "portraits";
    case "lookAlike":
      return `lookAlike:${(item.ids ?? []).join(",")}`;
    case "pageFix":
    case "printFix":
      return `${item.kind}:${item.unitId ?? ""}`;
    case "agentConfirm":
      return `agentConfirm:${item.confirm?.hash ?? ""}`;
    default:
      return item.kind;
  }
}

export interface DeckStep {
  /** The card to show now: the one on screen, or the next in line. */
  current: string | null;
  /** `current` is already on screen: it shows as it is, with no new line. */
  onScreen: boolean;
  deck: CardDeck;
  /** Look again after this long: the grace of a card whose question went. */
  recheckIn: number | null;
}

/**
 * Which card shows, given the questions open now (in the order they are
 * asked). The one on screen stays while its question is open; a new one is
 * taken from the front only when nothing is on screen.
 */
export function deckStep(
  deck: CardDeck,
  input: {
    open: readonly string[];
    now: number;
    /** The reader tapped or wrote since the card went on screen. */
    acted: boolean;
    /** The reader is on the card: focus or pointer inside it. */
    holding: boolean;
    /** The card on screen can still be drawn: its last look is known and what it is about is still there. */
    drawable: boolean;
  },
): DeckStep {
  const { open, now } = input;
  if (deck.shown && open.includes(deck.shown)) {
    return {
      current: deck.shown,
      onScreen: true,
      deck: deck.missingSince === null ? deck : { ...deck, missingSince: null },
      recheckIn: null,
    };
  }
  if (deck.shown && !input.acted && input.drawable) {
    const missing = deck.missingSince ?? now;
    const kept = missing === deck.missingSince ? deck : { ...deck, missingSince: missing };
    if (input.holding) return { current: deck.shown, onScreen: true, deck: kept, recheckIn: null };
    const left = CARD_GRACE_MS - (now - missing);
    if (left > 0) return { current: deck.shown, onScreen: true, deck: kept, recheckIn: left };
  }
  return {
    current: open[0] ?? null,
    onScreen: false,
    deck: deck.shown ? { ...deck, shown: null, since: 0, missingSince: null } : deck,
    recheckIn: null,
  };
}

export interface PickedCards<T> {
  step: DeckStep;
  /** The step card: the one on screen, else the next in line. */
  main: T | null;
  mainId: string | null;
  /** `main` is the live question, not its last look during the grace. */
  live: boolean;
  /** A reply to the reader, or a failure, shown beside the step card. */
  beside: T | null;
  besideId: string | null;
}

/**
 * The cards to show. The step card follows `deckStep`. A reply to the reader,
 * or a failure that ranks first while another card is on screen, goes beside
 * it: neither ever takes its place.
 */
export function pickCards<T extends { kind: string }>(input: {
  deck: CardDeck;
  pool: readonly T[];
  reply: T | null;
  now: number;
  acted: boolean;
  holding: boolean;
  lastLook: { id: string; well: T } | null;
  /** What the card is about is still in the book. */
  present: (well: T) => boolean;
  /** Kinds that can't wait in line: failures and blockers. */
  urgent: ReadonlySet<string>;
}): PickedCards<T> {
  const ids = input.pool.map(cardId);
  const look = input.lastLook;
  const step = deckStep(input.deck, {
    open: ids,
    now: input.now,
    acted: input.acted,
    holding: input.holding,
    drawable: look !== null && look.id === input.deck.shown && input.present(look.well),
  });
  const at = step.current ? ids.indexOf(step.current) : -1;
  const fromPool = at >= 0 ? input.pool[at]! : null;
  const main =
    fromPool ?? (step.onScreen && step.current && input.lastLook?.id === step.current ? input.lastLook.well : null);
  const mainId = main ? step.current : null;
  const first = input.pool[0];
  const urgent = step.onScreen && first && input.urgent.has(first.kind) && ids[0] !== mainId ? first : null;
  const candidate = input.reply ?? urgent;
  const beside = candidate && cardId(candidate) !== mainId ? candidate : null;
  return { step, main, mainId, live: fromPool !== null, beside, besideId: beside ? cardId(beside) : null };
}

/** The card goes on screen: from now on it stays until it is answered. */
export function placeCard(deck: CardDeck, id: string, now: number): CardDeck {
  if (deck.shown === id) return deck;
  return { ...deck, shown: id, since: now, missingSince: null };
}

export function sameDeck(a: CardDeck, b: CardDeck): boolean {
  return a.shown === b.shown && a.since === b.since && a.missingSince === b.missingSince && a.beside === b.beside;
}
