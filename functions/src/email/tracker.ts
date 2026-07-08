/**
 * Email telemetry: record send + delivery events into the aggregate
 * `appConfig/emailStats` window, correlate ZeptoMail webhook events back to the
 * template that produced them, and raise an admin alert when deliverability
 * degrades. Every function here is best-effort and never throws.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import { getEmailStats, recordEmailEvents } from "../appConfig";
import { raiseAlert } from "../alerts";
import { sumRecentDays } from "../../../books-frontend/src/core/config/emailStats";
import type { EmailEventType } from "../../../books-frontend/src/core/email/types";

const MESSAGE_MAP = "emailMessages";

/** Record one delivery event for a template (best-effort). */
export async function recordEmailEvent(templateId: string, type: EmailEventType, at?: number): Promise<void> {
  try {
    await recordEmailEvents([{ templateId, type, at }]);
  } catch (err) {
    console.warn("[email] failed to record event", type, err);
  }
}

/**
 * Persist a messageId → templateId mapping so asynchronous webhook events can be
 * attributed to the right template. Small, backend-only doc (client-denied by
 * default rules). Stores `at` so a future TTL sweep can prune it.
 */
export async function mapMessage(messageId: string, templateId: string, uid?: string): Promise<void> {
  if (!messageId) return;
  try {
    ensureAdmin();
    await getFirestore()
      .collection(MESSAGE_MAP)
      .doc(messageId)
      .set({ templateId, at: Date.now(), ...(uid ? { uid } : {}) }, { merge: true });
  } catch (err) {
    console.warn("[email] failed to map message", err);
  }
}

/** Resolve the template id for a webhook event's message id, if we recorded it. */
export async function templateForMessage(messageId: string): Promise<string> {
  if (!messageId) return "unknown";
  try {
    ensureAdmin();
    const snap = await getFirestore().collection(MESSAGE_MAP).doc(messageId).get();
    return snap.exists ? ((snap.get("templateId") as string) ?? "unknown") : "unknown";
  } catch {
    return "unknown";
  }
}

const BOUNCE_ALERT_MIN_SENT = 50;
const BOUNCE_ALERT_RATE = 0.05; // 5% hard-bounce rate over 7d
const COMPLAINT_ALERT_RATE = 0.001; // 0.1% spam-complaint rate over 7d

/**
 * After a negative delivery event, check the 7-day rates and raise a (daily,
 * idempotent) admin alert if bounces or complaints exceed healthy thresholds.
 */
export async function maybeAlertDeliverability(): Promise<void> {
  try {
    const stats = await getEmailStats();
    const recent = sumRecentDays(stats, 7);
    if (recent.sent < BOUNCE_ALERT_MIN_SENT) return;
    const bounceRate = recent.bounced / recent.sent;
    const complaintRate = recent.complained / recent.sent;
    const day = new Date().toISOString().slice(0, 10);

    if (bounceRate >= BOUNCE_ALERT_RATE) {
      await raiseAlert({
        severity: "warning",
        kind: "email.highBounceRate",
        message: `Email hard-bounce rate is ${(bounceRate * 100).toFixed(1)}% over the last 7 days (${recent.bounced}/${recent.sent}).`,
        meta: { bounced: recent.bounced, sent: recent.sent },
        ref: `bounce_${day}`,
      });
    }
    if (complaintRate >= COMPLAINT_ALERT_RATE) {
      await raiseAlert({
        severity: "critical",
        kind: "email.highComplaintRate",
        message: `Email spam-complaint rate is ${(complaintRate * 100).toFixed(2)}% over the last 7 days (${recent.complained}/${recent.sent}).`,
        meta: { complained: recent.complained, sent: recent.sent },
        ref: `complaint_${day}`,
      });
    }
  } catch (err) {
    console.warn("[email] deliverability check failed", err);
  }
}
