/**
 * Client access to the user's **Sparks** balance + ledger.
 *
 * Both are backend-authoritative (written only via the Admin SDK), so the client
 * just subscribes read-only:
 *   - balance lives on the `users/{uid}` profile doc (`sparkBalance`);
 *   - the audit trail lives under `users/{uid}/sparksLedger`.
 *
 * Rules let an owner READ both but never write them, so the figures can't be
 * forged. Purchasing/claiming goes through the backend (see `platform/payments`).
 */
import { collection, doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import { normalizeLedgerEntry, type SparksLedgerEntry } from "../core/config/sparks";

/** Subscribe to the signed-in user's Spark balance (0 when unset / signed out). */
export function subscribeSparkBalance(cb: (balance: number) => void): Unsubscribe {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    cb(0);
    return () => {};
  }
  const ref = doc(getFirebaseDb(), `users/${uid}`);
  return onSnapshot(
    ref,
    (snap) => {
      const v = snap.exists() ? (snap.get("sparkBalance") as unknown) : 0;
      cb(typeof v === "number" && Number.isFinite(v) ? v : 0);
    },
    () => cb(0),
  );
}

/** Subscribe to the signed-in user's Spark ledger, newest-first. */
export function subscribeSparkLedger(cb: (entries: SparksLedgerEntry[]) => void): Unsubscribe {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    cb([]);
    return () => {};
  }
  const col = collection(getFirebaseDb(), `users/${uid}/sparksLedger`);
  return onSnapshot(
    col,
    (snap) => {
      const list = snap.docs.map((d) => normalizeLedgerEntry(d.id, d.data()));
      list.sort((a, b) => b.at - a.at);
      cb(list);
    },
    () => cb([]),
  );
}
