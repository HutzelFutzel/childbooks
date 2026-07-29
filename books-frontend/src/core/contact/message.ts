/**
 * The shape of a stored contact-form submission (`contactMessages/{ref}`).
 *
 * Pure types only — imported by BOTH the backend (`functions/src/contact/store.ts`,
 * which owns reads/writes) and the admin dashboard (which only ever reads
 * through the admin-gated backend), so the two sides can't drift apart.
 */
import type { ContactTopicId } from "./topics";

/** Where a message is in the support workflow. */
export type ContactMessageStatus = "new" | "handled";

export function isContactMessageStatus(v: unknown): v is ContactMessageStatus {
  return v === "new" || v === "handled";
}

export interface ContactMessage {
  /** The human-quotable reference, also the Firestore document id. */
  ref: string;
  name: string;
  email: string;
  topic: ContactTopicId;
  message: string;
  /** Set when the sender was signed in (submissions carry the ID token). */
  uid: string | null;
  /** Non-reversible caller fingerprint for correlating repeat abuse. */
  senderHash: string | null;
  userAgent: string | null;
  status: ContactMessageStatus;
  createdAt: number;
  /** Set when an admin marks the message handled. */
  handledAt: number | null;
  handledBy: string | null;
}
