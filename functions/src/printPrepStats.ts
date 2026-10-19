/**
 * Daily roll-up of print preparation's money: what upscaling cost us and what
 * the surcharge collected. `printPrepStats/{YYYY-MM-DD}` (UTC), increments only.
 *
 * Kept apart from `printPrep.ts` so the wallet's settlement path can write the
 * "collected" side without importing the pipeline, and so the dashboard and the
 * cost alert read a month in thirty small documents instead of scanning runs.
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";

export interface PrintPrepDay {
  day: string;
  /** Upscaling spend, USD. */
  costUsd: number;
  /** Pictures freshly upscaled (cache hits excluded). */
  images: number;
  /** Pictures per provider tier ("esrgan", "lanczos"). */
  tiers: Record<string, number>;
  /** Surcharge Sparks charged on first renders. */
  sparks: number;
  /** The same Sparks at the peg, USD. */
  collectedUsd: number;
  /** Slots that paid the surcharge. */
  slots: number;
}

export function utcDay(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

function dayRef(day: string) {
  ensureAdmin();
  return getFirestore().doc(`printPrepStats/${day}`);
}

/** Book one fresh upscale. Never throws. */
export async function recordPrintPrepSpend(costUsd: number, tier: string): Promise<void> {
  try {
    await dayRef(utcDay()).set(
      {
        day: utcDay(),
        costUsd: FieldValue.increment(Math.max(0, costUsd)),
        images: FieldValue.increment(1),
        tiers: { [tier]: FieldValue.increment(1) },
      },
      { merge: true },
    );
  } catch (err) {
    console.warn("[printPrepStats] spend write failed", err);
  }
}

/** Book one surcharge actually charged. Never throws. */
export async function recordPrintPrepCharge(sparks: number, sparkValueUsd: number): Promise<void> {
  if (!(sparks > 0)) return;
  try {
    await dayRef(utcDay()).set(
      {
        day: utcDay(),
        sparks: FieldValue.increment(sparks),
        collectedUsd: FieldValue.increment(sparks * Math.max(0, sparkValueUsd)),
        slots: FieldValue.increment(1),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn("[printPrepStats] charge write failed", err);
  }
}

/** The last `days` UTC days, oldest first, zero-filled. */
export async function readPrintPrepDays(days: number): Promise<PrintPrepDay[]> {
  ensureAdmin();
  const keys: string[] = [];
  for (let d = days - 1; d >= 0; d -= 1) keys.push(utcDay(Date.now() - d * 86_400_000));
  const snaps = await getFirestore().getAll(...keys.map((k) => dayRef(k)));
  return snaps.map((snap, i) => {
    const x = (snap.data() ?? {}) as Partial<PrintPrepDay>;
    return {
      day: keys[i],
      costUsd: x.costUsd ?? 0,
      images: x.images ?? 0,
      tiers: x.tiers ?? {},
      sparks: x.sparks ?? 0,
      collectedUsd: x.collectedUsd ?? 0,
      slots: x.slots ?? 0,
    };
  });
}
