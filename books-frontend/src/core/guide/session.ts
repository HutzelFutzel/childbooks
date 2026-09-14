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
}

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
  };
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
