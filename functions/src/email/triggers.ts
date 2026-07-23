/**
 * Thin, best-effort trigger helpers called from the payment/gift/referral flows.
 *
 * Each wraps {@link sendTemplatedEmail} with a natural idempotency key so a
 * webhook retry (or a duplicate Stripe event) can't send the same email twice.
 * They resolve the recipient from a `uid` (via Admin Auth) unless an explicit
 * address is given. None of them throw — a failed email must never break the
 * money/reward flow that produced it.
 */
import { sendTemplatedEmail, type SendTemplateResult } from "./service";

/**
 * Welcome (and, for unverified email/password signups, verify) email.
 *
 * Passing `verifyUrl` turns the primary CTA into an email-verification link (a
 * Firebase action link generated server-side — see `authRoutes.ts`). Because the
 * "resend" button must be able to re-send a FRESH link, the verify variant is
 * NOT deduped; the plain welcome variant (verified identities) dedupes on uid so
 * it's sent at most once.
 */
export async function sendWelcomeEmail(args: {
  uid?: string;
  to?: string | null;
  name?: string | null;
  verifyUrl?: string;
  /** Dedupe on uid (default true). Set false so a resend can re-send. */
  dedupe?: boolean;
}): Promise<SendTemplateResult> {
  return sendTemplatedEmail({
    templateId: "welcome",
    uid: args.uid,
    to: args.to,
    vars: { name: args.name ?? undefined, verifyUrl: args.verifyUrl },
    dedupeKey: args.dedupe === false ? undefined : args.uid,
  });
}

export async function sendOrderShippedEmail(args: {
  uid: string;
  orderRef: string;
  carrier?: string | null;
  trackingUrl?: string | null;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "order_shipped",
    uid: args.uid,
    vars: {
      orderRef: args.orderRef,
      carrier: args.carrier ?? undefined,
      trackingUrl: args.trackingUrl ?? undefined,
    },
    // One "shipped" email per order (the provider may re-post SHIPPED webhooks).
    dedupeKey: `shipped_${args.orderRef}`,
  });
}

export async function sendOrderFailedEmail(args: {
  uid: string;
  orderRef: string;
  paymentId: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "order_failed",
    uid: args.uid,
    vars: { orderRef: args.orderRef },
    // One "problem" email per payment, even though retries exhaust over time.
    dedupeKey: `failed_${args.paymentId}`,
  });
}

export async function sendOrderConfirmationEmail(args: {
  uid: string;
  orderRef: string;
  itemLabel: string;
  orderUrl?: string;
  paymentId: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "order_confirmation",
    uid: args.uid,
    vars: { orderRef: args.orderRef, itemLabel: args.itemLabel, orderUrl: args.orderUrl },
    dedupeKey: args.paymentId,
  });
}

export async function sendSparksPurchasedEmail(args: {
  uid: string;
  sparks: number;
  paymentId: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "sparks_purchased",
    uid: args.uid,
    vars: { sparks: args.sparks },
    dedupeKey: args.paymentId,
  });
}

export async function sendGiftPurchasedEmail(args: {
  uid: string;
  sparks: number;
  code: string;
  recipientEmail?: string | null;
  paymentId: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "gift_purchased",
    uid: args.uid,
    vars: { sparks: args.sparks, code: args.code, recipientEmail: args.recipientEmail ?? undefined },
    dedupeKey: args.paymentId,
  });
}

export async function sendGiftReceivedEmail(args: {
  to: string;
  sparks: number;
  code: string;
  message?: string | null;
  senderName?: string | null;
  paymentId: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "gift_received",
    to: args.to,
    vars: {
      sparks: args.sparks,
      code: args.code,
      message: args.message ?? undefined,
      senderName: args.senderName ?? undefined,
    },
    dedupeKey: `${args.paymentId}_recipient`,
  });
}

export async function sendGiftClaimedEmail(args: {
  uid: string;
  sparks: number;
  code: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "gift_claimed",
    uid: args.uid,
    vars: { sparks: args.sparks },
    dedupeKey: `claim_${args.code}`,
  });
}

export async function sendReferralRewardEmail(args: {
  uid: string;
  sparks: number;
  kind: "referrer" | "referred";
  refUid: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "referral_reward",
    uid: args.uid,
    vars: { sparks: args.sparks, kind: args.kind },
    dedupeKey: `referral_${args.refUid}_${args.kind}`,
  });
}

export async function sendSubscriptionStartedEmail(args: {
  uid: string;
  planName: string;
  sparks?: number;
  subscriptionId: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "subscription_started",
    uid: args.uid,
    vars: { planName: args.planName, sparks: args.sparks },
    dedupeKey: args.subscriptionId,
  });
}

export async function sendSubscriptionCancelledEmail(args: {
  uid: string;
  planName: string;
  endDate?: string;
  subscriptionId: string;
}): Promise<void> {
  await sendTemplatedEmail({
    templateId: "subscription_cancelled",
    uid: args.uid,
    vars: { planName: args.planName, endDate: args.endDate },
    dedupeKey: `${args.subscriptionId}_cancel`,
  });
}
