/**
 * e2e-quote-emulator.mjs — drive the REAL checkout routes against the local emulators and Stripe's sandbox.
 *
 *   yarn e2e:quote                 # API checks. Cleans up after itself.
 *   yarn e2e:quote --pay           # also leave payable sessions open and print their URLs (see below)
 *   yarn e2e:quote --verify        # after paying them: check what the webhook did, then clean up
 *   yarn e2e:quote --abort         # throw away what --pay left open, unpaid
 *
 * Needs `yarn dev:backend --stripe` running (Auth, Firestore, Functions and Storage emulators, plus the
 * Stripe CLI forwarding webhooks) and a TEST key in functions/.env.local. It refuses anything else.
 *
 * What it proves, route by route: the number the quote shows is the number Stripe is asked to charge
 * and the number recorded on the payment; a stale, foreign, expired, reused or altered quote is refused
 * with `price_changed` and charges nothing; a refused attempt gives its coupon back.
 *
 * It touches the dev data minimally: a throwaway user per run, and one throwaway shared coupon added to
 * `adminSettings/coupons` (the original is restored — by `--verify` when `--pay` was used).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "package.json"));

const PROJECT = "childbook-60f89";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const API = `http://127.0.0.1:5001/${PROJECT}/us-central1/api`;
const STATE_FILE = join(root, "node_modules", ".cache", "e2e-quote-state.json");

const admin = require("firebase-admin");
const Stripe = require("stripe");

const argv = new Set(process.argv.slice(2));
const MODE = argv.has("--abort") ? "abort" : argv.has("--verify") ? "verify" : argv.has("--pay") ? "pay" : "api";

// ---- Environment guards -----------------------------------------------------------------------

const env = Object.fromEntries(
  readFileSync(join(root, "functions", ".env.local"), "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const stripeKey = env.STRIPE_SANDBOX_SECRET_KEY;
if (!stripeKey?.startsWith("sk_test_")) throw new Error("Refusing to run: STRIPE_SANDBOX_SECRET_KEY is missing or not a test key.");
if ((env.STRIPE_ENV || env.LULU_ENV) === "live") throw new Error("Refusing to run: STRIPE_ENV is live.");
const stripe = new Stripe(stripeKey);

for (const [name, port] of [["Auth", 9099], ["Firestore", 8081], ["Functions", 5001]]) {
  const up = await fetch(`http://127.0.0.1:${port}`).then(() => true, () => false);
  if (!up) throw new Error(`The ${name} emulator isn't listening on :${port}. Start it with \`yarn dev:backend --stripe\`.`);
}

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const auth = admin.auth();

// ---- Tiny test harness ------------------------------------------------------------------------

let passed = 0;
const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}
const eq = (label, actual, expected) =>
  check(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
const section = (title) => console.log(`\n${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newUser(tag) {
  const email = `quote-e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const user = await auth.createUser({ email, emailVerified: true, password: "e2e-test-password-1" });
  const custom = await auth.createCustomToken(user.uid);
  const res = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) },
  );
  const { idToken } = await res.json();
  if (!idToken) throw new Error("Couldn't sign in a test user through the Auth emulator.");
  return { uid: user.uid, email, idToken };
}

async function api(user, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.idToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json, code: json?.error?.code, message: json?.error?.message };
}

async function paymentOf(paymentId) {
  const snap = await db.doc(`payments/${paymentId}`).get();
  return snap.exists ? snap.data() : null;
}
async function sessionOf(paymentId) {
  const payment = await paymentOf(paymentId);
  if (!payment?.stripeSessionId) return null;
  return stripe.checkout.sessions.retrieve(payment.stripeSessionId);
}

// ---- Fixtures: one shared coupon, 25% off anything ---------------------------------------------

const CODE = "E2EQUOTE25";
const COUPON_ID = "coupon-e2e-quote";
/** The coupon asks for more than the shop allows on purpose: the cap is part of what must hold. */
const COUPON_PCT = 25;
const CAP_PCT = (await db.doc("appConfig/pricingSettings").get()).data()?.maxDiscountPct ?? 100;
const PCT = Math.min(COUPON_PCT, CAP_PCT);
/** What the engine must charge: the discount is rounded ONCE, on the line total. */
const afterPct = (minor, pct = PCT) => minor - Math.round((minor * pct) / 100);

async function installCoupon() {
  const ref = db.doc("adminSettings/coupons");
  const snap = await ref.get();
  const data = snap.data() ?? { coupons: [] };
  const coupons = data.coupons ?? [];
  const template = coupons.find((c) => c.issuance === "sharedCode") ?? coupons[0];
  if (!template) throw new Error("No coupon in adminSettings/coupons to copy the shape from.");
  const mine = {
    ...template,
    id: COUPON_ID,
    name: "E2E quote test",
    status: "active",
    issuance: "sharedCode",
    sharedCode: CODE,
    mechanic: { kind: "percentOff", percentOff: COUPON_PCT, maxDiscountAmount: 0 },
    restrictions: { ...template.restrictions, itemTypes: [], minSubtotal: 0, maxPerAccount: 0, dailyBudget: 0, lifetimeBudget: 0, maxRedemptions: 0, maxPerCode: 0, productIds: [], currencies: [], countries: [], planIds: [], firstPurchaseOnly: false, stackable: false },
    audience: { ...template.audience },
  };
  await ref.set({ ...data, coupons: [...coupons.filter((c) => c.id !== COUPON_ID), mine] });
  await db.doc(`couponCodes/${CODE}`).set({
    couponId: COUPON_ID, boundUid: null, redeemedCount: 0, reservedCount: 0, revoked: false, createdAt: Date.now(), batchId: "__shared",
  });
  return coupons.filter((c) => c.id !== COUPON_ID);
}
async function restoreCoupons(original) {
  const ref = db.doc("adminSettings/coupons");
  const data = (await ref.get()).data() ?? {};
  await ref.set({ ...data, coupons: original });
  await db.doc(`couponCodes/${CODE}`).delete().catch(() => undefined);
}
async function reservedCount() {
  const data = (await db.doc(`couponCodes/${CODE}`).get()).data();
  return { reserved: data?.reservedCount ?? 0, redeemed: data?.redeemedCount ?? 0 };
}

/** The functions emulator caches config for 30s; wait until it sees the coupon. */
async function waitForCoupon(user) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const r = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "small", currency: "USD", couponCode: CODE });
    if (r.status === 200 && r.json.discount) return true;
    await sleep(3000);
  }
  return false;
}

// ---- Print fixtures ----------------------------------------------------------------------------

const PRINT_SKU = "0850X0850FCPRECW080CW444GXX";
const PAGES = 24;
// The dev catalogue ships to the US only, where "Standard" is not offered.
const SHIPPING = "StandardPlus";
const IN = 72;

async function pdfBase64(widthIn, heightIn, pages) {
  const { PDFDocument } = require("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([widthIn * IN, heightIn * IN]);
  return Buffer.from(await doc.save()).toString("base64");
}

async function printAssets(user) {
  // Trim 8.5 x 8.5 + 0.125 bleed on every side; the cover size is whatever the printer says it is.
  const interior = await pdfBase64(8.75, 8.75, PAGES);
  const dims = await api(user, "POST", "/print/cover-dimensions", { sku: PRINT_SKU, pages: PAGES });
  if (dims.status !== 200) throw new Error(`Couldn't get the cover size (${dims.status} ${dims.message ?? ""}).`);
  const cover = await pdfBase64(dims.json.widthMm / 25.4, dims.json.heightMm / 25.4, 1);
  return [
    { printArea: "interior", base64: interior, contentType: "application/pdf" },
    { printArea: "cover", base64: cover, contentType: "application/pdf" },
  ];
}

const RECIPIENT = {
  name: "Quote Tester",
  phoneNumber: "+12125551234",
  email: "quote-e2e@example.com",
  address: { line1: "350 5th Ave", townOrCity: "New York", stateOrCounty: "NY", postalOrZipCode: "10118", countryCode: "US" },
};
const PRINT_QUOTE_BODY = {
  productSku: PRINT_SKU,
  copies: 2,
  pageCount: PAGES,
  shippingMethod: SHIPPING,
  destinationCountry: "US",
  line1: RECIPIENT.address.line1,
  city: RECIPIENT.address.townOrCity,
  state: RECIPIENT.address.stateOrCounty,
  postalCode: RECIPIENT.address.postalOrZipCode,
};

function printCheckoutBody(quote, assets, over = {}) {
  return {
    productSku: PRINT_SKU,
    copies: 2,
    pageCount: PAGES,
    destinationCountry: "US",
    shippingMethod: SHIPPING,
    recipient: RECIPIENT,
    assets,
    quoteId: quote.quoteId,
    couponCode: quote.discount?.code ?? undefined,
    // The carrier may suggest a correction; the dialog makes the buyer answer, and so does this.
    addressConfirmed: true,
    addressChoice: "entered",
    ...over,
  };
}

// ---- The checks --------------------------------------------------------------------------------

const created = { sessions: [], customers: [], users: [], payments: [], quotes: [] };

/** Every session is closed at the end, and none may offer the buyer a converted second price. */
function trackSession(session) {
  created.sessions.push(session.id);
  check(`${session.id.slice(-6)}: the payment page offers no converted currency (Adaptive Pricing off)`, session.adaptive_pricing?.enabled === false, JSON.stringify(session.adaptive_pricing));
}

function track(user, res) {
  if (res?.json?.paymentId) created.payments.push(res.json.paymentId);
  return res;
}

async function packChecks(user, other) {
  section("Spark packs");
  const small = 299;
  const medium = 799;

  const plain = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "small", currency: "USD" });
  eq("quote without a code: 200", plain.status, 200);
  eq("quote without a code: total is the sticker price", plain.json?.lines?.totalMinor, small);
  eq("quote without a code: no discount", plain.json?.discount, null);

  const coded = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "small", currency: "USD", couponCode: CODE });
  eq("quote with the code: total", coded.json?.lines?.totalMinor, afterPct(small));
  eq("quote with the code: discount shown", coded.json?.lines?.discountMinor, small - afterPct(small));
  eq("quote with the code: items + shipping = total", (coded.json?.lines?.itemsMinor ?? 0) + (coded.json?.lines?.shippingMinor ?? 0), afterPct(small));

  const dashed = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "small", currency: "USD", couponCode: "  e2e-quote 25 " });
  eq("a code typed in another shape applies the same discount", dashed.json?.lines?.totalMinor, afterPct(small));

  const bad = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "small", currency: "USD", couponCode: "NOSUCHCODE" });
  eq("an unknown code: price unchanged", bad.json?.lines?.totalMinor, small);
  check("an unknown code: says why", Boolean(bad.json?.couponRejection?.message));

  const before = await reservedCount();
  const bought = track(user, await api(user, "POST", "/checkout/sparks-pack", { packId: "small", currency: "USD", quoteId: coded.json.quoteId, couponCode: CODE }));
  eq("checkout by quote id: 200", bought.status, 200);
  check("checkout by quote id: a payment URL", /^https:\/\/checkout\.stripe\.com\//.test(bought.json?.url ?? ""), JSON.stringify(bought.json));
  if (bought.status === 200) {
    const session = await sessionOf(bought.json.paymentId);
    trackSession(session);
    eq("Stripe will charge exactly the quoted total", session.amount_total, afterPct(small));
    eq("Stripe's subtotal is the quoted total", session.amount_subtotal, afterPct(small));
    const payment = await paymentOf(bought.json.paymentId);
    eq("the payment records the quoted total", Math.round((payment?.amount ?? 0) * 100), afterPct(small));
    eq("the payment remembers its quote", payment?.quote?.id, coded.json.quoteId);
    const mid = await reservedCount();
    eq("the coupon is held while the payment is open", mid.reserved, before.reserved + 1);

    const replay = await api(user, "POST", "/checkout/sparks-pack", { packId: "small", currency: "USD", quoteId: coded.json.quoteId, couponCode: CODE });
    eq("the same quote cannot be charged twice", replay.status, 409);
    const afterReplay = await reservedCount();
    eq("a refused replay holds no second coupon", afterReplay.reserved, mid.reserved);
  }

  const foreign = await api(other, "POST", "/checkout/sparks-pack", { packId: "small", currency: "USD", quoteId: plain.json.quoteId });
  eq("someone else's quote: refused", foreign.status, 409);
  eq("someone else's quote: as price_changed", foreign.code, "price_changed");

  const wrongPack = await api(user, "POST", "/checkout/sparks-pack", { packId: "medium", currency: "USD", quoteId: plain.json.quoteId });
  eq("a quote for another pack: refused", wrongPack.status, 409);
  eq("a quote for another pack: as price_changed", wrongPack.code, "price_changed");

  const wrongCode = await api(user, "POST", "/checkout/sparks-pack", { packId: "small", currency: "USD", quoteId: plain.json.quoteId, couponCode: CODE });
  eq("a code the quote wasn't made with: refused", wrongCode.code, "price_changed");

  const wrongCurrency = await api(user, "POST", "/checkout/sparks-pack", { packId: "small", currency: "EUR", quoteId: plain.json.quoteId });
  eq("a quote in another currency: refused", wrongCurrency.code, "price_changed");

  const gone = await api(user, "POST", "/checkout/sparks-pack", { packId: "small", currency: "USD", quoteId: "no-such-quote" });
  eq("an unknown quote id: refused", gone.code, "price_changed");

  const stale = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "medium", currency: "USD" });
  await db.doc(`checkoutQuotes/${stale.json.quoteId}`).update({ expiresAt: Date.now() - 1000 });
  const heldBefore = await reservedCount();
  const expired = await api(user, "POST", "/checkout/sparks-pack", { packId: "medium", currency: "USD", quoteId: stale.json.quoteId });
  eq("an expired quote: refused", expired.code, "price_changed");
  eq("an expired quote holds no coupon", (await reservedCount()).reserved, heldBefore.reserved);

  // A quote whose arithmetic was tampered with in storage must not be charged.
  const tamper = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "medium", currency: "USD" });
  await db.doc(`checkoutQuotes/${tamper.json.quoteId}`).update({ "lines.totalMinor": medium - 100 });
  const tampered = await api(user, "POST", "/checkout/sparks-pack", { packId: "medium", currency: "USD", quoteId: tamper.json.quoteId });
  eq("a quote whose total no longer adds up: refused", tampered.code, "price_changed");

  const oneClick = track(user, await api(user, "POST", "/checkout/sparks-pack", { packId: "medium", currency: "USD", couponCode: CODE }));
  eq("one-click (no quote id, a typed code): 200", oneClick.status, 200);
  if (oneClick.status === 200) {
    const session = await sessionOf(oneClick.json.paymentId);
    trackSession(session);
    eq("one-click: Stripe charges the discounted price", session.amount_total, afterPct(medium));
  }
  const oneClickBad = await api(user, "POST", "/checkout/sparks-pack", { packId: "medium", currency: "USD", couponCode: "NOSUCHCODE" });
  check("one-click with a bad code: no payment page", oneClickBad.status >= 400 && !oneClickBad.json?.url, JSON.stringify(oneClickBad.json));

  const eur = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "large", currency: "EUR", couponCode: CODE });
  eq("EUR pack with the code", eur.json?.lines?.totalMinor, afterPct(1799));
  const gbp = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "medium", currency: "GBP", couponCode: CODE });
  eq("GBP pack with the code", gbp.json?.lines?.totalMinor, afterPct(699));

  section("Spark gifts");
  const giftQuote = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "large", currency: "EUR", couponCode: CODE });
  const gift = track(user, await api(user, "POST", "/checkout/sparks-gift", {
    packId: "large", currency: "EUR", quoteId: giftQuote.json.quoteId, couponCode: CODE, recipientEmail: "friend@example.com", message: "Enjoy!",
  }));
  eq("gift by quote id: 200", gift.status, 200);
  if (gift.status === 200) {
    const session = await sessionOf(gift.json.paymentId);
    trackSession(session);
    eq("gift: Stripe charges exactly the quoted total", session.amount_total, afterPct(1799));
    eq("gift: the session is in the quote's currency", session.currency, "eur");
  }
  const giftForeign = await api(other, "POST", "/checkout/sparks-gift", { packId: "large", currency: "EUR", quoteId: giftQuote.json.quoteId });
  eq("gift with someone else's quote: refused", giftForeign.code, "price_changed");
  const giftReuse = await api(user, "POST", "/checkout/sparks-gift", { packId: "large", currency: "EUR", quoteId: giftQuote.json.quoteId, couponCode: CODE });
  eq("a gift quote cannot be charged twice", giftReuse.status, 409);
}

const TINY_PDF = await pdfBase64(8.5, 8.5, 1);

async function ebookChecks(user, other) {
  section("Ebook");
  const projectId = `e2e-book-${randomUUID().slice(0, 8)}`;
  const plain = await api(user, "POST", "/checkout/ebook/quote", { projectId, currency: "EUR" });
  eq("quote: 200", plain.status, 200);
  eq("quote: total is the sticker price", plain.json?.priceQuote?.lines?.totalMinor, 999);
  const coded = await api(user, "POST", "/checkout/ebook/quote", { projectId, currency: "EUR", couponCode: CODE });
  eq("quote with the code: total", coded.json?.priceQuote?.lines?.totalMinor, afterPct(999));
  eq("quote with the code: the ebook's own price is unchanged", coded.json?.price, 9.99);

  const legacy = await api(user, "POST", "/checkout/ebook/quote", { projectId, currency: "XXX" });
  eq("an unsupported currency: refused", legacy.status, 400);

  const bought = track(user, await api(user, "POST", "/checkout/ebook", {
    projectId, title: "E2E Book", currency: "EUR", pdfBase64: TINY_PDF, quoteId: coded.json.priceQuote.quoteId, couponCode: CODE,
  }));
  eq("checkout by quote id: 200", bought.status, 200);
  if (bought.status === 200) {
    const session = await sessionOf(bought.json.paymentId);
    trackSession(session);
    eq("Stripe's subtotal is the quoted price before tax", session.amount_subtotal, afterPct(999));
    check("tax is left to Stripe's payment page", ["requires_location_inputs", "complete", "not_collecting"].includes(session.automatic_tax?.status ?? "none"), JSON.stringify(session.automatic_tax));
    const payment = await paymentOf(bought.json.paymentId);
    eq("the payment records the quoted price", Math.round((payment?.amount ?? 0) * 100), afterPct(999));
    check("the payment says tax is deferred", payment?.quote?.taxDeferred === true, JSON.stringify(payment?.quote));
  }

  const foreign = await api(other, "POST", "/checkout/ebook", { projectId, title: "E2E", currency: "EUR", pdfBase64: TINY_PDF, quoteId: plain.json.priceQuote.quoteId });
  eq("someone else's quote: refused", foreign.code, "price_changed");
  const wrongBook = await api(user, "POST", "/checkout/ebook", { projectId: `${projectId}-other`, title: "E2E", currency: "EUR", pdfBase64: TINY_PDF, quoteId: plain.json.priceQuote.quoteId });
  eq("a quote for another book: refused", wrongBook.code, "price_changed");
  const wrongCurrency = await api(user, "POST", "/checkout/ebook", { projectId, title: "E2E", currency: "USD", pdfBase64: TINY_PDF, quoteId: plain.json.priceQuote.quoteId });
  eq("a quote in another currency: refused", wrongCurrency.code, "price_changed");
  const pack = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "small", currency: "EUR" });
  const crossKind = await api(user, "POST", "/checkout/ebook", { projectId, title: "E2E", currency: "EUR", pdfBase64: TINY_PDF, quoteId: pack.json.quoteId });
  eq("a Spark pack quote cannot buy an ebook", crossKind.code, "price_changed");
  const reuse = await api(user, "POST", "/checkout/ebook", { projectId, title: "E2E", currency: "EUR", pdfBase64: TINY_PDF, quoteId: coded.json.priceQuote.quoteId, couponCode: CODE });
  eq("an ebook quote cannot be charged twice", reuse.status, 409);
}

async function printChecks(user, other) {
  section("Print order");
  const assets = await printAssets(user);
  const plain = await api(user, "POST", "/checkout/quote", PRINT_QUOTE_BODY);
  eq("quote: 200", plain.status, 200);
  if (plain.status !== 200) console.log(`      ${plain.message}`);
  const q0 = plain.json;
  if (plain.status !== 200) return;
  const lines0 = q0.lines;
  eq("quote: books + shipping (+ tax if added on top) = total", lines0.itemsMinor + lines0.shippingMinor + (lines0.taxBehavior === "exclusive" ? lines0.taxMinor : 0), lines0.totalMinor);
  eq("quote: no discount without a code", lines0.discountMinor, 0);

  const coded = await api(user, "POST", "/checkout/quote", { ...PRINT_QUOTE_BODY, couponCode: CODE });
  const q = coded.json;
  const l = q.lines;
  eq("quote with the code: books are discounted once, on the line total", l.itemsMinor, afterPct(l.listItemsMinor));
  eq("quote with the code: shipping is not discounted", l.shippingMinor, l.listShippingMinor);
  eq("quote with the code: books + shipping (+ tax if on top) = total", l.itemsMinor + l.shippingMinor + (l.taxBehavior === "exclusive" ? l.taxMinor : 0), l.totalMinor);
  eq("quote with the code: the quote carries the code", q.discount?.code, CODE);

  const bad = await api(user, "POST", "/checkout/quote", { ...PRINT_QUOTE_BODY, couponCode: "NOSUCHCODE" });
  eq("an unknown code: the price is the sticker price", bad.json?.lines?.totalMinor, lines0.totalMinor);
  check("an unknown code: says why", Boolean(bad.json?.couponRejection?.message));

  const body = (over = {}) => printCheckoutBody(q, assets, over);
  const heldBeforeRefusals = await reservedCount();

  const foreign = await api(other, "POST", "/checkout", body());
  eq("someone else's quote: refused", foreign.code, "price_changed");

  const otherAddress = await api(user, "POST", "/checkout", body({ recipient: { ...RECIPIENT, address: { ...RECIPIENT.address, postalOrZipCode: "10001" } } }));
  eq("a different ZIP than the quote's: refused", otherAddress.code, "price_changed");
  const otherCopies = await api(user, "POST", "/checkout", body({ copies: 3 }));
  eq("a different number of copies: refused", otherCopies.code, "price_changed");
  const otherCode = await api(user, "POST", "/checkout", body({ couponCode: undefined }));
  eq("dropping the code the quote was made with: refused", otherCode.code, "price_changed");
  eq("none of the refusals held a coupon", (await reservedCount()).reserved, heldBeforeRefusals.reserved);

  const before = await reservedCount();
  const bought = track(user, await api(user, "POST", "/checkout", body()));
  eq("checkout by quote id: 200", bought.status, 200);
  check("checkout by quote id: a payment URL", /^https:\/\/checkout\.stripe\.com\//.test(bought.json?.url ?? ""), JSON.stringify(bought.json));
  if (bought.status === 200) {
    const session = await sessionOf(bought.json.paymentId);
    trackSession(session);
    eq("Stripe will charge EXACTLY the quoted total", session.amount_total, l.totalMinor);
    eq("Stripe's tax is exactly the quoted tax", session.total_details?.amount_tax ?? 0, l.taxMinor);
    eq("Stripe's shipping is exactly the quoted shipping", session.total_details?.amount_shipping ?? 0, l.shippingMinor);
    eq("Stripe's currency is the quote's", session.currency, l.currency.toLowerCase());
    const payment = await paymentOf(bought.json.paymentId);
    eq("the payment records the quoted total", Math.round((payment?.amount ?? 0) * 100), l.totalMinor);
    eq("the payment remembers its quote", payment?.quote?.id, q.quoteId);
    eq("the coupon is held while the payment is open", (await reservedCount()).reserved, before.reserved + 1);
    const replay = await api(user, "POST", "/checkout", body());
    eq("the same quote cannot be charged twice", replay.status, 409);
    if (replay.status !== 409) console.log(`      ${replay.status}: ${replay.message}`);
  }
}

async function runApiChecks() {
  const user = await newUser("a");
  const other = await newUser("b");
  created.users.push(user.uid, other.uid);
  console.log(`Coupon asks for ${COUPON_PCT}% off; the shop caps discounts at ${CAP_PCT}%, so ${PCT}% is what must apply.`);
  console.log(`Test users ${user.email}, ${other.email}`);

  const original = await installCoupon();
  console.log("Waiting for the backend to pick up the test coupon…");
  if (!(await waitForCoupon(user))) throw new Error("The backend never applied the test coupon.");
  return { user, other, original };
}

// ---- Cleanup ------------------------------------------------------------------------------------

async function cleanup(state, { keepPayable }) {
  for (const id of state.sessions ?? []) await stripe.checkout.sessions.expire(id).catch(() => undefined);
  const customerIds = new Set(state.customers ?? []);
  for (const paymentId of state.payments ?? []) {
    const payment = await paymentOf(paymentId).catch(() => null);
    if (payment?.stripeCustomerId) customerIds.add(payment.stripeCustomerId);
  }
  for (const uid of state.users ?? []) {
    const profile = (await db.doc(`users/${uid}`).get().catch(() => null))?.data();
    for (const key of ["stripeCustomerId", "stripe_customer_id"]) if (profile?.[key]) customerIds.add(profile[key]);
  }
  for (const id of customerIds) await stripe.customers.del(id).catch(() => undefined);
  for (const uid of state.users ?? []) {
    for (const col of ["payments", "checkoutQuotes", "couponRedemptions", "couponAccountUsage"]) {
      const docs = await db.collection(col).where("uid", "==", uid).get().catch(() => null);
      for (const d of docs?.docs ?? []) await d.ref.delete().catch(() => undefined);
    }
    await db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => undefined);
    await auth.deleteUser(uid).catch(() => undefined);
  }
  void keepPayable;
}

// ---- Modes --------------------------------------------------------------------------------------

async function modeApi({ andPay }) {
  const { user, other, original } = await runApiChecks();
  let payUrls = null;
  try {
    await packChecks(user, other);
    await ebookChecks(user, other);
    await printChecks(user, other);
    if (andPay) payUrls = await openPayableSessions();
  } finally {
    if (andPay && payUrls) {
      mkdirpState({ original, payUrls, users: created.users, customers: created.customers });
    } else {
      await cleanup({ ...created, sessions: created.sessions }, { keepPayable: false });
      await restoreCoupons(original);
    }
  }
}

function mkdirpState(state) {
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) require("node:fs").mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Fresh sessions, kept open, for a person (or a browser) to pay with the test card. */
async function openPayableSessions() {
  section("Payable sessions (left open)");
  const user = await newUser("pay");
  created.users.push(user.uid);
  const out = {};
  const pack = await api(user, "POST", "/checkout/sparks-pack/quote", { packId: "medium", currency: "USD", couponCode: CODE });
  const packBuy = await api(user, "POST", "/checkout/sparks-pack", { packId: "medium", currency: "USD", quoteId: pack.json.quoteId, couponCode: CODE });
  out.pack = { ...packBuy.json, expectTotalMinor: pack.json.lines.totalMinor, uid: user.uid };
  const projectId = `e2e-pay-${randomUUID().slice(0, 8)}`;
  const eb = await api(user, "POST", "/checkout/ebook/quote", { projectId, currency: "EUR", couponCode: CODE });
  const ebBuy = await api(user, "POST", "/checkout/ebook", { projectId, title: "E2E Pay Book", currency: "EUR", pdfBase64: TINY_PDF, quoteId: eb.json.priceQuote.quoteId, couponCode: CODE });
  out.ebook = { ...ebBuy.json, expectSubtotalMinor: eb.json.priceQuote.lines.totalMinor, uid: user.uid, projectId };
  const assets = await printAssets(user);
  const pq = await api(user, "POST", "/checkout/quote", { ...PRINT_QUOTE_BODY, couponCode: CODE });
  const printBuy = await api(user, "POST", "/checkout", printCheckoutBody(pq.json, assets));
  out.print = { ...printBuy.json, expectTotalMinor: pq.json.lines.totalMinor, expectTaxMinor: pq.json.lines.taxMinor, uid: user.uid };
  for (const [name, v] of Object.entries(out)) console.log(`  ${name}: ${v.url ?? JSON.stringify(v)}`);
  console.log("\nPay each with 4242 4242 4242 4242, then run `yarn e2e:quote --verify`.");
  return out;
}

/** Throw away what `--pay` left open, without paying it. */
async function modeAbort() {
  if (!existsSync(STATE_FILE)) throw new Error("Nothing to abort.");
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const payments = Object.values(state.payUrls ?? {}).map((p) => p.paymentId).filter(Boolean);
  const sessions = [];
  for (const id of payments) {
    const payment = await paymentOf(id).catch(() => null);
    if (payment?.stripeSessionId) sessions.push(payment.stripeSessionId);
  }
  await cleanup({ users: state.users, customers: state.customers, payments, sessions }, { keepPayable: false });
  await restoreCoupons(state.original);
  unlinkSync(STATE_FILE);
  console.log("Cleaned up.");
}

async function modeVerify() {
  if (!existsSync(STATE_FILE)) throw new Error("Nothing to verify — run `yarn e2e:quote --pay` first.");
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const { pack, ebook, print } = state.payUrls;
  try {
    for (const [name, p] of [["Spark pack", pack], ["Ebook", ebook], ["Print order", print]]) {
      section(name);
      let payment = null;
      for (let i = 0; i < 20; i++) {
        payment = await paymentOf(p.paymentId);
        if (payment?.status === "paid" || payment?.status === "fulfilling" || payment?.status === "fulfilled") break;
        await sleep(1500);
      }
      check("the webhook marked the payment paid", ["paid", "fulfilling", "fulfilled", "completed"].includes(payment?.status), `status ${payment?.status}`);
      const session = await stripe.checkout.sessions.retrieve(payment.stripeSessionId, { expand: ["payment_intent"] });
      eq("Stripe took payment", session.payment_status, "paid");
      const expectTotal = p.expectTotalMinor;
      if (expectTotal != null) {
        eq("Stripe took exactly the quoted total", session.amount_total, expectTotal);
        eq("the payment record agrees with Stripe", Math.round((payment.amount ?? 0) * 100), session.amount_total);
      } else {
        eq("Stripe's pre-tax amount is the quoted price", session.amount_subtotal, p.expectSubtotalMinor);
        const tax = session.total_details?.amount_tax ?? 0;
        console.log(`    (Stripe tax on this ebook: ${tax}; total ${session.amount_total})`);
        const taxOnTop = session.total_details?.amount_tax != null && session.amount_total === session.amount_subtotal + tax;
        const taxInside = session.amount_total === session.amount_subtotal;
        check("total = pre-tax amount + tax (or tax is inside it)", taxOnTop || taxInside, `subtotal ${session.amount_subtotal}, tax ${tax}, total ${session.amount_total}`);
      }
      const redemptions = await db.collection("couponRedemptions").where("uid", "==", p.uid).get();
      const mine = redemptions.docs.filter((d) => d.data().paymentRef === p.paymentId || d.id.includes(p.paymentId));
      check("the coupon was settled (used), not left held", mine.length > 0 && mine.every((d) => d.data().status === "settled" || d.data().status === "redeemed"), mine.map((d) => d.data().status).join(","));
    }
    section("Alerts");
    const alerts = await db.collection("adminAlerts").where("kind", "in", ["checkout_price_mismatch", "payment_differs_from_quote"]).get();
    const recent = alerts.docs.filter((d) => (d.data().createdAt ?? 0) > Date.now() - 3_600_000);
    eq("no price-mismatch alert was raised", recent.length, 0);
    for (const d of recent) console.log(`    ${d.data().kind}: ${d.data().message}`);

    const sparks = (await db.doc(`users/${pack.uid}`).get()).data();
    console.log(`    (pack buyer's Sparks fields: ${JSON.stringify(Object.fromEntries(Object.entries(sparks ?? {}).filter(([k]) => /spark/i.test(k))))})`);
  } finally {
    await cleanup({ users: state.users, customers: state.customers, payments: [pack.paymentId, ebook.paymentId, print.paymentId], sessions: [] }, { keepPayable: false });
    await restoreCoupons(state.original);
    unlinkSync(STATE_FILE);
  }
}

try {
  console.log(`Quote ↔ checkout e2e (${MODE}) against the emulators and Stripe's sandbox`);
  if (MODE === "abort") await modeAbort();
  else if (MODE === "verify") await modeVerify();
  else await modeApi({ andPay: MODE === "pay" });
} catch (err) {
  failures.push("script error");
  console.error("\nThe run stopped:", err instanceof Error ? err.stack : err);
}

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
