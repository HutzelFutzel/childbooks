/**
 * Fulfillment invariants — the order pipeline's rules that don't throw when they
 * are broken, they just quietly cost money.
 *
 * What would hurt a customer or the bill:
 *
 * - A rejected print job is never mistaken for a placed one, and its replacement
 *   can never be answered with the job that already died.
 * - A paid order is never silently parked: every state that waits on a person
 *   says so, and says why, once — while an order that is being re-placed by
 *   itself is not paged about.
 * - What a person already looked at stays quiet until something changes.
 * - The printer job can always be created (it needs a contact email) and the
 *   recovery lookup only ever returns a live job.
 *
 * Offline and deterministic: the lifecycle is pure, the provider runs against a
 * fake HTTP layer. Firestore-backed writers are covered by the emulator flows.
 */
import assert from "node:assert/strict";
import {
  ATTENTION_THRESHOLDS,
  applyPatch,
  deriveState,
  emptyPrintOrder,
  evaluateAttention,
  paymentIdFromExternalId,
  placementKeyFor,
  providerJobIsLive,
  type PrintOrderPatch,
  type PrintOrderPrintPrep,
  type PrintOrderRecord,
  type PrintPrepStatus,
} from "../books-frontend/src/core/orders/lifecycle";
import { upscaleTargetFor } from "../books-frontend/src/core/print/printPrep";
import { capabilityForFormat, normalizeProductCapability } from "../books-frontend/src/core/config/productCapability";
import { normalizeMarketCapability } from "../books-frontend/src/core/config/marketCapability";
import { createLuluProvider } from "../books-frontend/src/core/fulfillment/lulu/provider";
import { FulfillmentError } from "../books-frontend/src/core/fulfillment/errors";
import type { OrderDraft } from "../books-frontend/src/core/fulfillment/types";

const H = 3_600_000;
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);

/** An order built the way the writer builds it: from patches, through `applyPatch`. */
function order(patches: { at: number; patch: PrintOrderPatch }[]): PrintOrderRecord {
  let rec = emptyPrintOrder("pay_1", patches[0]?.at ?? T0);
  for (const { at, patch } of patches) rec = applyPatch(rec, patch, at);
  return rec;
}

const paid = (at = T0): { at: number; patch: PrintOrderPatch } => ({
  at,
  patch: { paymentId: "pay_1", paymentStatus: "paid", amountPaid: 30, currency: "USD", paidAt: at, env: "live" },
});

// --- Placement keys ------------------------------------------------------------

assert.equal(placementKeyFor("pay_1", 0), "pay_1", "The first job uses the payment id.");
assert.equal(placementKeyFor("pay_1", 1), "pay_1:r1", "A replacement never reuses the dead job's key.");
assert.notEqual(placementKeyFor("pay_1", 2), placementKeyFor("pay_1", 1), "Each replacement is its own key.");
for (const n of [0, 1, 2, 7]) {
  assert.equal(paymentIdFromExternalId(placementKeyFor("pay_1", n)), "pay_1", "A job maps back to its payment.");
}
assert.equal(paymentIdFromExternalId(null), null);
assert.equal(paymentIdFromExternalId(""), null);

// --- State ----------------------------------------------------------------------

assert.equal(deriveState({ luluStatus: null, currentJobId: null, fulfillmentState: null, paymentStatus: "paid", autoReplacing: false }), "paid");
assert.equal(deriveState({ luluStatus: "REJECTED", currentJobId: "j1", fulfillmentState: "retrying", paymentStatus: "paid", autoReplacing: true }), "retrying", "A rejected job with a replacement coming is retrying.");
assert.equal(deriveState({ luluStatus: "REJECTED", currentJobId: "j1", fulfillmentState: "failed", paymentStatus: "paid", autoReplacing: false }), "rejected", "A rejected job nobody re-places is rejected.");
assert.equal(deriveState({ luluStatus: "CANCELED", currentJobId: "j1", fulfillmentState: "placed", paymentStatus: "refunded", autoReplacing: false }), "refunded", "Cancelled and refunded is simply refunded.");
assert.equal(deriveState({ luluStatus: "SHIPPED", currentJobId: "j1", fulfillmentState: "placed", paymentStatus: "paid", autoReplacing: false }), "shipped");
assert.equal(deriveState({ luluStatus: "UNPAID", currentJobId: "j1", fulfillmentState: "placed", paymentStatus: "paid", autoReplacing: false }), "on_hold");
assert.ok(providerJobIsLive("IN_PRODUCTION") && !providerJobIsLive("REJECTED") && !providerJobIsLive("CANCELED"), "Only a live job can still be printed.");

// --- A healthy order never asks for a person -------------------------------------

const healthy = order([
  paid(),
  { at: T0 + 60_000, patch: { currentJobId: "j1", jobIds: ["j1"], luluStatus: "CREATED", fulfillmentState: "placed", lastSyncAt: T0 + 60_000 } },
  { at: T0 + 2 * H, patch: { luluStatus: "IN_PRODUCTION", lastWebhookAt: T0 + 2 * H } },
  { at: T0 + 5 * H, patch: { luluStatus: "SHIPPED", lastWebhookAt: T0 + 5 * H } },
]);
assert.equal(healthy.state, "shipped");
assert.equal(healthy.open, false, "A shipped order is done: the sweeps stop asking about it.");
assert.equal(healthy.needsAttention, false);
assert.ok(healthy.shippedAt && healthy.inProductionAt && healthy.placedAt, "Every milestone it passed is stamped.");

// --- Paid but never placed -------------------------------------------------------

const stalled = order([paid()]);
assert.equal(applyPatch(stalled, {}, T0 + ATTENTION_THRESHOLDS.notPlacedMs - 60_000).needsAttention, false, "Not paged inside the retry window.");
const late = applyPatch(stalled, {}, T0 + ATTENTION_THRESHOLDS.notPlacedMs + 60_000);
assert.equal(late.attention?.reason, "not_placed", "Paid and waiting too long is the headline problem.");
assert.ok(late.attention?.detail.length, "…and it says how long, not just that.");
const later = applyPatch(late, {}, T0 + ATTENTION_THRESHOLDS.notPlacedMs + 3 * H);
assert.equal(later.attention?.since, late.attention?.since, "The wait is measured from when it first went wrong, not from the last sweep.");

const failing = order([paid(), { at: T0 + H, patch: { fulfillmentState: "failed", attempts: 5, lastError: "boom" } }]);
assert.equal(failing.attention?.reason, "placement_failed", "Exhausted retries need a person.");
assert.ok(failing.attention?.detail.includes("boom"), "The error travels with the alert.");

// --- A rejection that is being re-placed is not an emergency -----------------------

const rejectedAt = T0 + 3 * 24 * H;
const replaced = order([
  paid(),
  { at: T0 + 60_000, patch: { currentJobId: "j1", jobIds: ["j1"], luluStatus: "CREATED", fulfillmentState: "placed" } },
  { at: rejectedAt, patch: { luluStatus: "REJECTED", autoReplacing: true, fulfillmentState: "retrying", lastError: "bad file" } },
]);
assert.equal(replaced.state, "retrying");
assert.equal(applyPatch(replaced, {}, rejectedAt + 20 * 60_000).needsAttention, false, "A job rejected three days after payment is a fresh problem, not one three days old.");
assert.equal(applyPatch(replaced, {}, rejectedAt + ATTENTION_THRESHOLDS.notPlacedMs + 60_000).attention?.reason, "not_placed", "…but it does escalate if the replacement never lands.");

const gaveUp = applyPatch(replaced, { autoReplacing: false, fulfillmentState: "failed" }, rejectedAt + H);
assert.equal(gaveUp.attention?.reason, "rejected", "Once nothing more will be tried, a person is told.");

// --- Acknowledging ---------------------------------------------------------------

const acked = applyPatch(
  late,
  { ack: { reason: "not_placed", at: T0 + 4 * H, by: "admin", note: "customer contacted" } },
  T0 + 4 * H,
);
assert.equal(acked.needsAttention, false, "Looked at, handled: it stops asking.");
assert.equal(applyPatch(acked, {}, T0 + 30 * H).needsAttention, false, "…and stays quiet over time.");
const moved = applyPatch(acked, { currentJobId: "j2", luluStatus: "CREATED", fulfillmentState: "placed" }, T0 + 5 * H);
assert.equal(moved.ack, null, "A new state invalidates 'someone already handled this'.");

// --- Money out, job still running --------------------------------------------------

const refundedLive = order([
  paid(),
  { at: T0 + 60_000, patch: { currentJobId: "j1", jobIds: ["j1"], luluStatus: "IN_PRODUCTION", fulfillmentState: "placed", lastSyncAt: T0 + 60_000 } },
  { at: T0 + H, patch: { paymentStatus: "refunded", refundedAmount: 30 } },
]);
assert.equal(refundedLive.attention?.reason, "refunded_active", "Refunded while the printer is still making it: we pay for a book nobody gets.");

// --- Printer silence ---------------------------------------------------------------

const quiet = order([
  paid(),
  { at: T0 + 60_000, patch: { currentJobId: "j1", jobIds: ["j1"], luluStatus: "IN_PRODUCTION", fulfillmentState: "placed", lastSyncAt: T0 + 60_000 } },
]);
assert.equal(applyPatch(quiet, {}, T0 + 3 * H).needsAttention, false);
assert.equal(applyPatch(quiet, {}, T0 + ATTENTION_THRESHOLDS.syncStaleMs + 2 * H).attention?.reason, "sync_stale", "An open order nobody has heard about for hours is flagged.");

// --- Print-resolution files: waiting is bounded, never silent -----------------------

const deadline = T0 + 3 * H;
const prep = (status: PrintPrepStatus, finishedAt: number | null = null): PrintOrderPrintPrep => ({
  status,
  startedAt: T0,
  deadlineAt: deadline,
  finishedAt,
  reason: null,
  images: { total: 4, done: 1, failed: 0 },
  tiers: {},
  costUsd: 0,
});
const preparing = order([paid(), { at: T0 + 60_000, patch: { printPrep: prep("upscaling") } }]);
assert.equal(preparing.state, "preparing_files", "A paid order waiting for its print files says so.");
assert.equal(
  applyPatch(preparing, {}, deadline - 60_000).needsAttention,
  false,
  "Inside its own deadline it is not 'not placed', even past the usual two hours.",
);
const filesStuck = applyPatch(preparing, {}, deadline + ATTENTION_THRESHOLDS.filesNotReadyGraceMs + 60_000);
assert.equal(filesStuck.attention?.reason, "files_not_ready", "Past the deadline, the fallback didn't run: a person places it.");
const fellBack = applyPatch(preparing, { printPrep: prep("fallback", T0 + H) }, T0 + H);
assert.equal(fellBack.state, "paid", "A settled preparation hands the order back to placement.");

const settings = { minUpscaleRatio: 1.15, maxUpscaleRatio: 6, maxOutputMegapixels: 24 };
assert.equal(upscaleTargetFor({ scale: 1.1, naturalWidth: 1536, naturalHeight: 1024 }, settings), null, "Nearly sharp enough is left alone.");
const t2 = upscaleTargetFor({ scale: 1.9, naturalWidth: 1536, naturalHeight: 1024 }, settings)!;
assert.equal(t2.modelScale, 2);
assert.equal(t2.width, Math.round(1536 * 1.9), "The target is exactly what the page needs.");
const big = upscaleTargetFor({ scale: 5, naturalWidth: 2048, naturalHeight: 2048 }, settings)!;
assert.ok(big.width * big.height <= 24_000_000 + 2 * big.width, "The megapixel budget caps a huge spread.");
assert.equal(big.modelScale, 4);
assert.equal(upscaleTargetFor({ scale: 9, naturalWidth: 100, naturalHeight: 100 }, settings)!.ratio, 6, "Enlargement is capped.");

// --- The provider: recovery never returns a dead job; creation needs an email --------

const SKU = "0600X0900BWSTDPB060UW444MXX";
const calls: string[] = [];

function job(id: number, externalId: string, status: string): Record<string, unknown> {
  return { id, external_id: externalId, status: { name: status }, line_items: [] };
}

function fakeProvider(results: Record<string, unknown>[]) {
  return createLuluProvider({
    httpFetch: async (url, init) => {
      const u = String(url);
      calls.push(`${(init as { method?: string } | undefined)?.method ?? "GET"} ${u}`);
      const ok = (body: unknown) =>
        ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
      if (u.includes("/token")) return ok({ access_token: "t", expires_in: 3600 });
      if (u.includes("/print-jobs/?search=")) return ok({ results });
      throw new Error(`unexpected request ${u}`);
    },
    assetHost: { id: "fake", upload: async () => ({ url: "https://files.example/x.pdf" }) },
    clientKey: () => "key",
    clientSecret: () => "secret",
    env: "sandbox",
  });
}

{
  const provider = fakeProvider([job(1, "pay_1", "REJECTED"), job(2, "pay_1", "CANCELED")]);
  const found = await provider.findOrderByIdempotencyKey!("pay_1");
  assert.equal(found, null, "A job the printer rejected or that was cancelled is not 'already placed'.");
}
{
  const provider = fakeProvider([job(1, "pay_1", "REJECTED"), job(3, "pay_1", "IN_PRODUCTION"), job(4, "pay_10", "CREATED")]);
  const found = await provider.findOrderByIdempotencyKey!("pay_1");
  assert.equal(found?.id, "3", "The live job is the one that is returned — not the dead one, not a neighbour with a similar id.");
}
{
  const provider = fakeProvider([job(9, "pay_1:r1", "CREATED")]);
  assert.equal(await provider.findOrderByIdempotencyKey!("pay_1"), null, "A replacement's key is not the original's.");
  assert.equal((await provider.findOrderByIdempotencyKey!("pay_1:r1"))?.id, "9");
}
{
  const provider = fakeProvider([]);
  const draft: OrderDraft = {
    productSku: SKU,
    copies: 1,
    recipient: {
      name: "Ada",
      phoneNumber: "+1555000111",
      address: { line1: "1 Main St", townOrCity: "Springfield", postalOrZipCode: "12345", countryCode: "US", stateOrCounty: "IL" },
    },
    shippingMethod: "Budget",
    assets: [],
    sourceFileUrls: { interior: "https://files.example/i.pdf", cover: "https://files.example/c.pdf" },
    destinationCountry: "US",
    currency: "USD",
    merchantReference: "book_1",
    idempotencyKey: "pay_1",
  };
  const before = calls.length;
  await assert.rejects(
    () => provider.createOrder(draft),
    (err: unknown) => err instanceof FulfillmentError && err.kind === "validation" && /email/i.test(err.message),
    "A job without a contact email is refused with a clear reason before anything is sent.",
  );
  assert.ok(
    !calls.slice(before).some((c) => c.startsWith("POST") && c.includes("/print-jobs/")),
    "…and nothing was posted to the printer.",
  );
}

// ---- Which coverage governs a format -----------------------------------------
{
  const cell = (country: string, status: "available" | "refused") => ({
    country,
    status,
    levels: status === "available" ? [{ level: "MAIL", method: "StandardPlus", traceable: false, postboxOk: true, businessOnly: false }] : [],
    probedAt: 1,
  });
  const countryLevel = normalizeMarketCapability({
    version: 1,
    probe: { sku: "S", pageCount: 32, copies: 1, currency: "USD", env: "sandbox" },
    countries: [cell("DE", "available"), cell("AU", "available")],
    sweptAt: 1,
  });
  const perFormat = normalizeProductCapability({
    version: 1,
    probe: { copies: 1, currency: "USD", env: "sandbox" },
    products: [{ sku: "HARD", pageCount: 24, countries: [cell("AU", "refused")] }],
    sweptAt: 1,
  });
  assert.equal(
    capabilityForFormat(countryLevel, perFormat, "sandbox", "hard").get("AU")?.status,
    "refused",
    "A format's own measurement beats the country-level answer (case-insensitive SKU).",
  );
  assert.equal(
    capabilityForFormat(countryLevel, perFormat, "sandbox", "SOFT").get("AU")?.status,
    "available",
    "A format nobody measured falls back to the country-level answer instead of vanishing.",
  );
  assert.equal(
    capabilityForFormat(countryLevel, perFormat, "live", "HARD").size,
    0,
    "Evidence recorded against the other environment governs nothing.",
  );
}

console.log("fulfillment invariants: ok");
