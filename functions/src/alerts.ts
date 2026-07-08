/**
 * Admin alerts — a tiny persistent inbox for events that need a human
 * (fulfillment failures, grant-abuse velocity, etc.). Server-write-only;
 * surfaced in the admin Finance tab. Best-effort by design.
 */
import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AdminAlert {
  id: string;
  at: number;
  severity: AlertSeverity;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
  resolvedAt?: number | null;
}

function db() {
  ensureAdmin();
  return getFirestore();
}

/** Append an alert. `ref` makes it idempotent (one alert per underlying fact). */
export async function raiseAlert(args: {
  severity: AlertSeverity;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
  ref?: string;
}): Promise<void> {
  try {
    const id = args.ref ? `${args.kind}_${args.ref}` : randomUUID();
    const doc = {
      at: Date.now(),
      severity: args.severity,
      kind: args.kind,
      message: args.message.slice(0, 2000),
      ...(args.meta ? { meta: args.meta } : {}),
      resolvedAt: null,
    };
    if (args.ref) await db().collection("adminAlerts").doc(id).create(doc);
    else await db().collection("adminAlerts").doc(id).set(doc);
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 6) return; // ALREADY_EXISTS — idempotent
    console.error("[alerts] failed to raise alert", args.kind, err);
  }
}

/** Newest alerts first (unresolved and resolved; the client can filter). */
export async function listAlerts(limit = 100): Promise<AdminAlert[]> {
  const snap = await db()
    .collection("adminAlerts")
    .orderBy("at", "desc")
    .limit(Math.min(limit, 500))
    .get();
  return snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      at: (raw.at as number) ?? 0,
      severity: (raw.severity as AlertSeverity) ?? "info",
      kind: (raw.kind as string) ?? "unknown",
      message: (raw.message as string) ?? "",
      meta: (raw.meta as Record<string, unknown>) ?? undefined,
      resolvedAt: (raw.resolvedAt as number) ?? null,
    };
  });
}

/** Mark an alert as handled. */
export async function resolveAlert(id: string): Promise<void> {
  await db().collection("adminAlerts").doc(id).set({ resolvedAt: Date.now() }, { merge: true });
}
