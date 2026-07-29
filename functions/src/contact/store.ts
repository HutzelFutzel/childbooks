/**
 * Durable storage for contact-form submissions.
 *
 * Firestore is the SYSTEM OF RECORD here, not a convenience copy. The form is
 * the primary way to reach us — the site publishes no address — so a submission
 * that isn't written down is a customer who was told "message sent" and then
 * ignored. Slack and any email copy are notifications layered on top; both are
 * best-effort and neither is allowed to be the only record.
 *
 * Backend-only: `contactMessages` is denied to all clients in `firestore.rules`
 * and read exclusively through the admin-gated routes.
 */
import { randomInt } from "node:crypto";
import { getFirestore, type Query } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import type { ContactTopicId } from "../../../books-frontend/src/core/contact/topics";
import type { ContactMessage, ContactMessageStatus } from "../../../books-frontend/src/core/contact/message";

export { isContactMessageStatus } from "../../../books-frontend/src/core/contact/message";
export type { ContactMessage, ContactMessageStatus } from "../../../books-frontend/src/core/contact/message";

export const CONTACT_COLLECTION = "contactMessages";

export interface ContactMessageInput {
  name: string;
  email: string;
  topic: ContactTopicId;
  message: string;
  /** Set when the sender was signed in (submissions carry the ID token). */
  uid?: string | null;
  /** Non-reversible caller fingerprint for correlating repeat abuse. */
  senderHash?: string | null;
  userAgent?: string | null;
}

/**
 * Alphabet for the reference: uppercase base32 with the characters people
 * reliably misread removed (no I, O, 0, 1), because these get read aloud on the
 * phone and retyped from screenshots.
 */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_LENGTH = 6;

function generateRef(): string {
  let out = "";
  for (let i = 0; i < REF_LENGTH; i++) {
    out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  }
  return `CB-${out}`;
}

/**
 * Persist a submission and return its reference.
 *
 * The reference doubles as the document id and is claimed with `create()`, so a
 * collision can never silently overwrite somebody else's message — it retries
 * with a fresh reference instead. Throws if it genuinely can't write, so the
 * route can tell the visitor the truth rather than a false "message sent".
 */
export async function saveContactMessage(input: ContactMessageInput): Promise<ContactMessage> {
  ensureAdmin();
  const db = getFirestore();

  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = generateRef();
    const record: ContactMessage = {
      ...input,
      uid: input.uid ?? null,
      senderHash: input.senderHash ?? null,
      userAgent: input.userAgent ?? null,
      ref,
      status: "new",
      createdAt: Date.now(),
      handledAt: null,
      handledBy: null,
    };
    try {
      await db.collection(CONTACT_COLLECTION).doc(ref).create(record);
      return record;
    } catch (err) {
      // ALREADY_EXISTS ⇒ reference collision; anything else is a real failure.
      if ((err as { code?: number }).code === 6) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a message reference.");
}

const MAX_PAGE_SIZE = 200;

/**
 * The admin inbox listing. Newest first, optionally filtered to `status`.
 *
 * Filtering by `status` needs the composite index (`status` asc + `createdAt`
 * desc) declared in `firestore.indexes.json` — deploy indexes alongside this.
 */
export async function listContactMessages(opts: {
  status?: ContactMessageStatus;
  limit?: number;
}): Promise<ContactMessage[]> {
  ensureAdmin();
  const db = getFirestore();
  let query: Query = db.collection(CONTACT_COLLECTION).orderBy("createdAt", "desc");
  if (opts.status) query = query.where("status", "==", opts.status);
  const snap = await query.limit(Math.min(opts.limit ?? 100, MAX_PAGE_SIZE)).get();
  return snap.docs.map((d) => d.data() as ContactMessage);
}

/** Flip a message to `handled` (or back to `new`), recording who and when. */
export async function setContactMessageHandled(
  ref: string,
  handled: boolean,
  byUid: string | undefined,
): Promise<ContactMessage> {
  ensureAdmin();
  const db = getFirestore();
  const docRef = db.collection(CONTACT_COLLECTION).doc(ref);
  const patch = handled
    ? { status: "handled" as const, handledAt: Date.now(), handledBy: byUid ?? null }
    : { status: "new" as const, handledAt: null, handledBy: null };
  await docRef.set(patch, { merge: true });
  const snap = await docRef.get();
  if (!snap.exists) throw new Error("Message not found.");
  return snap.data() as ContactMessage;
}
