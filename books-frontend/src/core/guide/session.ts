/**
 * The conversation, as stored data.
 *
 * Deliberately separate from `Project`. The book is what the reader made; this is
 * how they got there, and the two have different lifetimes and different owners.
 * Keeping the transcript out of the project document matters for three concrete
 * reasons:
 *
 *   - **`rev` and undo.** Every project write bumps the revision and enters the
 *     undo history. A chat message is not an edit to a book, and a transcript
 *     living in the project would make "undo" walk back through remarks.
 *   - **Conflict.** The project save is a compare-and-set on `rev`; two tabs
 *     talking at once would collide on the book rather than on the chat.
 *   - **Deletion.** A reader can reasonably want the conversation gone and the book
 *     kept. That's only possible if they are separate documents.
 *
 * What it is NOT is a source of truth. Every fact lives in the book, and the guide
 * derives what to do next from the book alone (see `engine.ts`) — so a transcript
 * that was lost, truncated or written by an older version of the app costs the
 * reader their history and nothing else. That is why normalization here can afford
 * to be brutal: anything it doesn't recognise, it drops.
 */
import { isGuideComponentId, type GuideComponentId } from "./components";
import { GUIDE_SLOT_IDS, type GuideSlotId } from "./slots";

export type GuideRole = "reader" | "guide";

export interface GuideMessage {
  id: string;
  role: GuideRole;
  text: string;
  at: number;
  /**
   * Facts this turn actually changed. Shown under the message as a quiet receipt,
   * because the alternative — a reader stating an age and seeing no sign it landed
   * — is the single easiest way for a conversational interface to feel broken.
   */
  applied?: GuideSlotId[];
  /** Components the reader declined in this turn. */
  skipped?: GuideComponentId[];
  /** Set when the turn failed to send, so the composer can offer a retry. */
  failed?: boolean;
  /**
   * For a guide message: the component it was asking about.
   *
   * This is what stops the guide repeating itself. It speaks unprompted whenever
   * the book moves on without the reader saying anything — a render lands, a job
   * finishes — and the only way to know whether the current question has already
   * been asked is to have recorded which one the last thing it said was about.
   * Stored on the message rather than as session state so it survives a reload,
   * which is the case where a re-derived flag would ask everything twice.
   */
  about?: GuideComponentId;
  /**
   * The facts as they stood BEFORE this turn changed them, in patch shape (see
   * `captureGuideFacts`). Present only on turns that changed something, which is
   * exactly the set of points worth returning to.
   *
   * This is what makes "take me back to before I said that" possible without
   * snapshotting whole books into the transcript: the guide's writable facts are a
   * small, closed set, and restoring them is the same operation as applying any other
   * patch. Artifacts are deliberately not here — see the note on `captureGuideFacts`
   * for why getting the old pictures back would be the wrong answer.
   */
  before?: Record<string, unknown>;
  /**
   * Chat studio: top-level book fields as they were before this message's skills
   * wrote them (`title`, `config`, `anchors`, `authoringState`), as JSON — the
   * book holds nested arrays the transcript store cannot. Undo puts them back.
   */
  restore?: string;
  /**
   * Chat studio: the entry in the book's change log (`state/bookHistory.ts`)
   * for the page-design changes this message made. Undo takes back that entry,
   * and only it, so later changes (the reader's or the chat's) stay, and the
   * thread keeps the message: whether it is undone is read from the entry.
   */
  changeId?: string;
  /**
   * Chat studio: on a reader line, the pages it named ("page 18", "the back
   * cover"), as unit ids read by the app when it was sent. Kept as ids so a
   * page added or moved later cannot make the chip point at another page; the
   * number shown is read from the book now, and a page that is gone says so.
   */
  pageRefs?: string[];
  /** Chat studio: the configured lines this message said (confirm-once bookkeeping). */
  keys?: string[];
  /**
   * Chat studio: the one-row receipt under a guide line, read from the book
   * after the patch — never from what the model claimed.
   */
  receipt?: GuideReceipt;
  /**
   * Chat studio: the age-fit read of the reader's story, shown as a card under
   * the guide's line. Trusted structure from the story checker, not phrasing.
   */
  fit?: StoryFitCard;
  /**
   * Chat studio: on a reader line, the passage of the story they had marked
   * when they sent it, so "make this nicer" still says what "this" was. A
   * record only; what a request acted on was decided when it was sent.
   */
  quote?: string;
  /** Chat studio: the line phrased in the chat language, once it arrived. */
  localized?: { locale: string; text: string };
  /**
   * Chat studio: the well this line introduces (see `core/guide/conversation.ts`).
   * Its buttons show under it while it is still the guide's latest line.
   */
  well?: string;
  /** Chat studio: still being phrased. Held back, with everything after it, until revealed. Never stored. */
  pending?: boolean;
}

/**
 * The story check's answer as the thread shows it. `textHash` names the story
 * it read, so the card can say when the story has changed since.
 */
export interface StoryFitCard {
  verdict: "good" | "minor" | "mismatch";
  headline: string;
  notes: string[];
  /** Qualities notably lighter or richer than usual for the age group. */
  dimensions: { label: string; fit: "lighter" | "richer" }[];
  /** The age group the read was about, as the reader knows it. */
  band: string;
  textHash: string;
}

/** A thumbnail that scrolls the book pane to its unit. */
export interface ReceiptThumb {
  blobId: string;
  unitId: string;
  view: "pages" | "cast" | "cover" | "style";
}

export interface GuideReceipt {
  /** Short parts; values are shown dark. An inference is named once. */
  parts: { label?: string; value: string; inferred?: boolean }[];
  /** Thumbnails, in the order the line names them. */
  thumbs?: ReceiptThumb[];
}

/** Receipts show a handful of thumbnails at most. */
const MAX_THUMBS = 8;

export interface GuideSession {
  version: 1;
  messages: GuideMessage[];
  /** Optional components the reader has declined. Never includes required ones. */
  skipped: GuideComponentId[];
}

/**
 * Messages kept per book.
 *
 * A cap rather than a rolling window on the wire: the model only ever sees the last
 * handful (see `guideInterpret.ts`), so this number is purely about what the reader
 * can scroll back to versus what fits in one Firestore document. At a few hundred
 * bytes a message this is nowhere near the 1 MB ceiling, and a conversation long
 * enough to hit it has long since stopped being scrolled.
 */
export const MAX_GUIDE_MESSAGES = 200;

/** Longest single message kept. Matches the backend's own cap on what it reads. */
const MAX_TEXT = 2000;

export function createGuideSession(): GuideSession {
  return { version: 1, messages: [], skipped: [] };
}

export function guideMessage(
  role: GuideRole,
  text: string,
  extra: Omit<GuideMessage, "id" | "role" | "text" | "at"> = {},
): GuideMessage {
  return { id: messageId(), role, text, at: Date.now(), ...extra };
}

function messageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Rebuild a session from whatever was stored, keeping only what still makes sense.
 *
 * Closed-world on both id lists: a skip naming a component that no longer exists
 * (renamed, or removed from the catalog) is dropped rather than carried, because a
 * skip the engine can't interpret would silently suppress nothing — or worse,
 * something else after a rename. Same for the applied-slot receipts, which are
 * cosmetic and must never be a reason a transcript fails to load.
 */
export function normalizeGuideSession(input: unknown): GuideSession {
  if (!input || typeof input !== "object" || Array.isArray(input)) return createGuideSession();
  const raw = input as { messages?: unknown; skipped?: unknown };

  const messages: GuideMessage[] = [];
  if (Array.isArray(raw.messages)) {
    for (const entry of raw.messages) {
      const message = normalizeMessage(entry);
      if (message) messages.push(message);
    }
  }

  const skipped: GuideComponentId[] = [];
  if (Array.isArray(raw.skipped)) {
    for (const id of raw.skipped) {
      if (isGuideComponentId(id) && !skipped.includes(id)) skipped.push(id);
    }
  }

  return { version: 1, messages: messages.slice(-MAX_GUIDE_MESSAGES), skipped };
}

function normalizeMessage(input: unknown): GuideMessage | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<GuideMessage>;
  if (raw.role !== "reader" && raw.role !== "guide") return null;
  const text = typeof raw.text === "string" ? raw.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return null;

  const applied = Array.isArray(raw.applied)
    ? raw.applied.filter((id): id is GuideSlotId => GUIDE_SLOT_IDS.includes(id as GuideSlotId))
    : [];
  const skipped = Array.isArray(raw.skipped)
    ? raw.skipped.filter(isGuideComponentId)
    : [];

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : messageId(),
    role: raw.role,
    text,
    at: typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : Date.now(),
    ...(applied.length > 0 ? { applied } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(raw.failed === true ? { failed: true as const } : {}),
    ...(isGuideComponentId(raw.about) ? { about: raw.about } : {}),
    ...(normalizeBefore(raw.before) ?? {}),
    ...(normalizeRestore(raw.restore) ?? {}),
    ...(typeof raw.changeId === "string" && raw.changeId && raw.changeId.length <= 80 ? { changeId: raw.changeId } : {}),
    ...(raw.role === "reader" && Array.isArray(raw.pageRefs)
      ? (() => {
          const refs = raw.pageRefs.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 80).slice(0, 12);
          return refs.length > 0 ? { pageRefs: refs } : {};
        })()
      : {}),
    ...(Array.isArray(raw.keys) && raw.keys.every((k) => typeof k === "string")
      ? { keys: raw.keys.slice(0, 8) }
      : {}),
    ...(normalizeReceipt(raw.receipt) ?? {}),
    ...(normalizeFit(raw.fit) ?? {}),
    ...(raw.role === "reader" && typeof raw.quote === "string" && raw.quote.trim()
      ? { quote: raw.quote.trim().slice(0, 240) }
      : {}),
    ...(typeof raw.well === "string" && raw.well && raw.well.length <= 160 ? { well: raw.well } : {}),
    ...(raw.localized &&
    typeof raw.localized.locale === "string" &&
    typeof raw.localized.text === "string" &&
    raw.localized.text.trim()
      ? { localized: { locale: raw.localized.locale, text: raw.localized.text.slice(0, MAX_TEXT) } }
      : {}),
  };
}

function normalizeFit(input: unknown): { fit: StoryFitCard } | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<StoryFitCard>;
  if (raw.verdict !== "good" && raw.verdict !== "minor" && raw.verdict !== "mismatch") return null;
  if (typeof raw.textHash !== "string" || !raw.textHash) return null;
  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((note): note is string => typeof note === "string" && note.trim() !== "").slice(0, 3)
    : [];
  const dimensions = Array.isArray(raw.dimensions)
    ? raw.dimensions
        .filter(
          (d): d is StoryFitCard["dimensions"][number] =>
            Boolean(d) && typeof d.label === "string" && (d.fit === "lighter" || d.fit === "richer"),
        )
        .slice(0, 8)
        .map((d) => ({ label: d.label.slice(0, 80), fit: d.fit }))
    : [];
  return {
    fit: {
      verdict: raw.verdict,
      headline: typeof raw.headline === "string" ? raw.headline.slice(0, 400) : "",
      notes: notes.map((note) => note.slice(0, 400)),
      dimensions,
      band: typeof raw.band === "string" ? raw.band.slice(0, 80) : "",
      textHash: raw.textHash.slice(0, 80),
    },
  };
}

function normalizeReceipt(input: unknown): { receipt: GuideReceipt } | null {
  if (!input || typeof input !== "object") return null;
  // `thumb` is the single thumbnail stored before receipts held several.
  const raw = input as Partial<GuideReceipt> & { thumb?: unknown };
  const parts = Array.isArray(raw.parts)
    ? raw.parts
        .filter((part) => part && typeof part.value === "string" && part.value.trim())
        .slice(0, 8)
        .map((part) => ({
          value: part.value.slice(0, 200),
          ...(typeof part.label === "string" && part.label ? { label: part.label.slice(0, 80) } : {}),
          ...(part.inferred === true ? { inferred: true } : {}),
        }))
    : [];
  const listed = Array.isArray(raw.thumbs) ? raw.thumbs : raw.thumb ? [raw.thumb] : [];
  const thumbs = listed.flatMap(normalizeThumb).slice(0, MAX_THUMBS);
  if (parts.length === 0 && thumbs.length === 0) return null;
  return { receipt: { parts, ...(thumbs.length > 0 ? { thumbs } : {}) } };
}

function normalizeThumb(input: unknown): ReceiptThumb[] {
  const raw = input as Partial<ReceiptThumb> | null;
  return raw &&
    typeof raw.blobId === "string" &&
    typeof raw.unitId === "string" &&
    typeof raw.view === "string" &&
    ["pages", "cast", "cover", "style"].includes(raw.view)
    ? [{ blobId: raw.blobId, unitId: raw.unitId, view: raw.view }]
    : [];
}

/**
 * A stored checkpoint, kept only if it is still a plausible patch.
 *
 * Not validated slot by slot here, deliberately: `applyGuidePatch` is the closed world
 * and it will reject anything unrecognised when the reader actually jumps back — so a
 * second validator would only be a second thing to keep in step. This just refuses
 * shapes that could not be a patch at all, and drops the key entirely when empty so a
 * restore point with nothing in it does not offer a button that would do nothing.
 */
/** Undo snapshots larger than this are not kept; that message simply has no undo. */
export const GUIDE_RESTORE_MAX_CHARS = 150_000;

function normalizeRestore(input: unknown): { restore: string } | null {
  if (typeof input !== "string" || !input.startsWith("{") || input.length > GUIDE_RESTORE_MAX_CHARS) return null;
  return { restore: input };
}

function normalizeBefore(input: unknown): { before: Record<string, unknown> } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const before = input as Record<string, unknown>;
  return Object.keys(before).length > 0 ? { before } : null;
}

/**
 * The component the guide last spoke about, or null if it hasn't spoken.
 *
 * Compared against the engine's current component to decide whether there is
 * anything new to say. Read from the transcript rather than held as state so a
 * reload doesn't re-ask a question the reader is already looking at.
 */
export function lastSpokenAbout(session: GuideSession): GuideComponentId | null {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i]!;
    if (message.role === "guide") return message.about ?? null;
  }
  return null;
}

/** Append a message, holding the session to its cap. */
export function appendGuideMessage(
  session: GuideSession,
  message: GuideMessage,
): GuideSession {
  return {
    ...session,
    messages: [...session.messages, message].slice(-MAX_GUIDE_MESSAGES),
  };
}

/**
 * Record declined components.
 *
 * Filtered against the caller's list of what is actually declinable, so this can
 * be handed a model's suggestion directly. The engine ignores a skip of a required
 * component anyway, but storing one would leave a permanent instruction that reads
 * as if it were honoured.
 */
/**
 * The turns a reader can return to, newest first.
 *
 * A turn is a restore point only if it changed a fact — a message that asked a
 * question or answered one without landing anything has nothing to go back to. Read
 * from the transcript rather than tracked separately so it survives a reload.
 */
export function guideRestorePoints(session: GuideSession): GuideMessage[] {
  return session.messages.filter((message) => message.before).reverse();
}

/**
 * Rewind the transcript to just before a turn.
 *
 * Drops that turn and everything after it, because the alternative — leaving the
 * conversation on screen while the book goes back — puts the reader in front of a
 * transcript that describes a book that no longer exists. Skips are kept: declining a
 * question is not a fact this restores, and silently re-asking something they already
 * turned down would be its own annoyance.
 *
 * Returns the session unchanged when the id isn't a restore point, so a stale button
 * from an older transcript is inert rather than destructive.
 */
export function rewoundGuideSession(session: GuideSession, messageId: string): GuideSession {
  const index = session.messages.findIndex(
    (message) => message.id === messageId && (message.before || message.restore),
  );
  if (index < 0) return session;
  return { ...session, messages: session.messages.slice(0, index) };
}

export function withGuideSkips(
  session: GuideSession,
  ids: readonly GuideComponentId[],
  declinable: (id: GuideComponentId) => boolean,
): GuideSession {
  const next = [...session.skipped];
  for (const id of ids) {
    if (!declinable(id) || next.includes(id)) continue;
    next.push(id);
  }
  return next.length === session.skipped.length ? session : { ...session, skipped: next };
}

/** The recent turns the interpreter is given. Oldest first. */
export function guideTranscriptWindow(
  session: GuideSession,
  size: number,
): { role: GuideRole; text: string }[] {
  return session.messages
    .filter((message) => !message.failed)
    .slice(-size)
    .map((message) => ({ role: message.role, text: message.text }));
}
