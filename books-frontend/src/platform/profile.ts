/**
 * Client access to the signed-in user's profile + saved address book.
 *
 *   - `users/{uid}`              — the profile root doc.
 *   - `users/{uid}/addresses/{id}` — the saved address book (subcollection).
 *
 * Firestore rules make both readable + writable by their owner only (with field
 * validation on writes). The target uid is resolved per call from the Auth SDK,
 * so this module always points at the current user. When signed out, reads are
 * empty/no-op and writes throw — callers gate on the auth state.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import {
  migrateAddress,
  migrateProfile,
  PROFILE_SCHEMA_VERSION,
  type SavedAddress,
  type UserProfile,
} from "../core/profile/types";

function currentUid(): string | null {
  try {
    return getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

function requireUid(): string {
  const uid = currentUid();
  if (!uid) throw new Error("Not signed in: profile operation requires authentication.");
  return uid;
}

function profileRef(uid: string) {
  return doc(getFirebaseDb(), "users", uid);
}

function addressRef(uid: string, id: string) {
  return doc(getFirebaseDb(), `users/${uid}/addresses`, id);
}

/** Subscribe to the profile doc. Fires null until it exists. */
export function subscribeProfile(cb: (profile: UserProfile | null) => void): Unsubscribe {
  const uid = currentUid();
  if (!uid) {
    cb(null);
    return () => {};
  }
  return onSnapshot(
    profileRef(uid),
    (snap) => cb(snap.exists() ? migrateProfile(snap.data()) : null),
    () => cb(null),
  );
}

/** Subscribe to the saved address book, newest-first. */
export function subscribeAddresses(cb: (addresses: SavedAddress[]) => void): Unsubscribe {
  const uid = currentUid();
  if (!uid) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    collection(getFirebaseDb(), `users/${uid}/addresses`),
    (snap) => {
      const list = snap.docs.map((d) => migrateAddress(d.id, d.data()));
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      cb(list);
    },
    () => cb([]),
  );
}

/**
 * Merge a partial profile update. Stamps `schemaVersion` + `updatedAt` (and
 * `createdAt` on first write). Best-effort by design — callers don't block UX
 * on persistence.
 */
export async function saveProfile(patch: Partial<UserProfile>): Promise<void> {
  const uid = requireUid();
  const now = Date.now();
  const payload: Record<string, unknown> = {
    ...patch,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    updatedAt: now,
  };
  // `merge:true` updates in place; createdAt is only written when absent so it
  // pins the first-seen time. Setting it on every merge would clobber it.
  if (patch.createdAt == null) delete payload.createdAt;
  await setDoc(profileRef(uid), payload, { merge: true });
}

/** Identity + device fields recorded on each app session. */
export interface SessionStamp {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  /** How the account was created — only recorded the first time. */
  signupSource: string | null;
  /** Coarse user-agent string — refreshed each session. */
  userAgent: string | null;
}

/**
 * Record a login/session against the profile. Identity fields + `lastActiveAt`
 * refresh every session; the write-once fields (`createdAt`, `meta.firstSeenAt`,
 * `meta.signupSource`) are only set when the profile doc doesn't exist yet, so
 * the first-seen timestamp and origin aren't clobbered on return visits.
 */
export async function recordSession(stamp: SessionStamp): Promise<void> {
  const uid = requireUid();
  const ref = profileRef(uid);
  const now = Date.now();

  let exists = false;
  try {
    exists = (await getDoc(ref)).exists();
  } catch {
    // If we can't tell, fall through and write the create-time fields too — a
    // duplicate first-seen stamp is harmless and rare.
  }

  const meta: Record<string, unknown> = { lastActiveAt: now, lastUserAgent: stamp.userAgent };
  const payload: Record<string, unknown> = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    displayName: stamp.displayName,
    email: stamp.email,
    photoURL: stamp.photoURL,
    updatedAt: now,
    meta,
  };
  if (!exists) {
    payload.createdAt = now;
    meta.firstSeenAt = now;
    meta.signupSource = stamp.signupSource;
  }
  // merge:true deep-merges `meta`, so omitting firstSeenAt/signupSource on
  // return visits preserves their original values.
  await setDoc(ref, payload, { merge: true });
}

/** Create or update a saved address (the doc id is the address id). */
export async function saveAddress(address: SavedAddress): Promise<void> {
  const uid = requireUid();
  await setDoc(addressRef(uid, address.id), { ...address, updatedAt: Date.now() });
}

/** Delete a saved address. */
export async function deleteAddress(id: string): Promise<void> {
  const uid = requireUid();
  await deleteDoc(addressRef(uid, id));
}
