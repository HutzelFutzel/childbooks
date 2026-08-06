/**
 * Durable storage for affiliate-program applications.
 *
 * Firestore is the system of record; Slack and the ack email are notifications.
 * Backend-only: `affiliateApplications` is denied to all clients in firestore.rules.
 */
import { randomInt } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import type {
  AffiliateApplication,
  AffiliateAudienceId,
  AffiliateChannelId,
} from "../../../books-frontend/src/core/affiliates/application";

export const AFFILIATE_APPLICATIONS_COLLECTION = "affiliateApplications";

export interface AffiliateApplicationInput {
  name: string;
  email: string;
  channel: AffiliateChannelId;
  channelUrl: string;
  audience: AffiliateAudienceId;
  pitch: string;
  uid?: string | null;
  senderHash?: string | null;
  userAgent?: string | null;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_LENGTH = 6;

function generateRef(): string {
  let out = "";
  for (let i = 0; i < REF_LENGTH; i++) {
    out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  }
  return `AFF-${out}`;
}

export async function saveAffiliateApplication(
  input: AffiliateApplicationInput,
): Promise<AffiliateApplication> {
  ensureAdmin();
  const db = getFirestore();

  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = generateRef();
    const record: AffiliateApplication = {
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
      await db.collection(AFFILIATE_APPLICATIONS_COLLECTION).doc(ref).create(record);
      return record;
    } catch (err) {
      if ((err as { code?: number }).code === 6) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate an application reference.");
}
