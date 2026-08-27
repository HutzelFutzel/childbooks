/**
 * check-print-catalog.mjs — verify the curated print catalog against Lulu.
 *
 *   yarn check:print              # verify the catalog for the active LULU_ENV
 *   yarn check:print --live       # force the live catalog (sandbox by default)
 *   yarn check:print --costs      # also print the wholesale cost model per SKU
 *
 * Every product in `books-frontend/src/core/fulfillment/lulu/products.ts` is
 * quoted at its declared minimum AND maximum page count via
 * `/print-job-cost-calculations/`, which validates the `pod_package_id` and the
 * page range together. Both endpoints used here are read-only: nothing is
 * ordered and nothing is charged.
 *
 * Why not `/cover-dimensions/`: it computes geometry from the fields encoded in
 * the SKU and returns 200 for packages that DO NOT EXIST in the catalog. It
 * cannot verify a SKU. Only the cost endpoint can.
 *
 * Run this after editing the catalog, and again after switching LULU_ENV to
 * live — sandbox and live are separate catalogs behind separate credentials, so
 * a pass in one says nothing about the other. This checks the curated seed list
 * only; a product an admin already created is vouched for by its own
 * `provider.verifiedIn` record, written by the dashboard's Verify. An unverified
 * SKU or an out-of-range page count fails at print-job creation, which happens
 * AFTER the customer has been charged.
 */
import { mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readEnvLocal } from "./set-secrets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = new Set(process.argv.slice(2));
const CATALOG = join(ROOT, "books-frontend/src/core/fulfillment/lulu/products.ts");

/** A destination that must always quote (used for the page-range checks). */
const PROBE_ADDRESS = {
  name: "Catalog Check",
  street1: "1 Main St",
  city: "New York",
  state_code: "NY",
  postcode: "10001",
  country_code: "US",
  phone_number: "5555555555",
};

/** MAIL is the one level available in every country we sell to. */
const PROBE_LEVEL = "MAIL";

// ---- Parse the catalog we actually ship ------------------------------------

/**
 * Import the actual generated catalog through a tiny temporary bundle. The
 * catalog is composed from trim/binding rows now, so regex-parsing object
 * literals silently dropped every product and made this release gate useless.
 */
async function readCatalog() {
  const outDir = join(ROOT, "node_modules", ".cache", "childbooks-print-catalog");
  const outFile = join(outDir, "catalog.mjs");
  mkdirSync(outDir, { recursive: true });
  try {
    await build({
      entryPoints: [CATALOG],
      outfile: outFile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      external: ["zod"],
      logLevel: "warning",
    });
    const module = await import(`${pathToFileURL(outFile).href}?at=${Date.now()}`);
    return module.LULU_BOOK_PRODUCTS.map((product) => ({
      sku: product.sku,
      label: product.label,
      binding: product.binding,
      minPages: product.minPages,
      pageStep: product.pageStep,
      maxPages: product.maxPages,
    }));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// ---- Lulu ------------------------------------------------------------------

const env = readEnvLocal();
const which = ARGS.has("--live") ? "live" : (env.LULU_ENV || "sandbox").trim();
const base = which === "live" ? "https://api.lulu.com" : "https://api.sandbox.lulu.com";
const key = env[`LULU_${which.toUpperCase()}_CLIENT_KEY`] || env.LULU_CLIENT_KEY;
const secret = env[`LULU_${which.toUpperCase()}_CLIENT_SECRET`] || env.LULU_CLIENT_SECRET;

if (!key || !secret) {
  console.error(`\n❌ No Lulu credentials for LULU_ENV=${which} in functions/.env.local`);
  process.exit(1);
}

const tokenRes = await fetch(`${base}/auth/realms/glasstree/protocol/openid-connect/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
if (!tokenRes.ok) {
  console.error(`\n❌ Lulu auth failed (${tokenRes.status}) for LULU_ENV=${which}`);
  process.exit(1);
}
const token = (await tokenRes.json()).access_token;

async function quote(sku, pages) {
  const res = await fetch(`${base}/print-job-cost-calculations/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      line_items: [{ page_count: pages, pod_package_id: sku, quantity: 1 }],
      shipping_address: PROBE_ADDRESS,
      shipping_level: PROBE_LEVEL,
    }),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, msg: body.replace(/\s+/g, " ").slice(0, 140) };
  return {
    ok: true,
    printCost: Number(JSON.parse(body).line_item_costs?.[0]?.total_cost_excl_tax ?? 0),
  };
}

// ---- Verify ----------------------------------------------------------------

const products = await readCatalog();
if (products.length === 0) {
  console.error(`\n❌ Parsed no products from ${CATALOG} — has its shape changed?`);
  process.exit(1);
}

console.log(`\n▶ Print catalog vs Lulu (${which}) — ${products.length} products`);
const failures = [];

for (const p of products) {
  const lo = await quote(p.sku, p.minPages);
  const hi = await quote(p.sku, p.maxPages);
  const label = `${p.label} [${p.sku}]`;
  if (lo.ok && hi.ok) {
    console.log(
      `  ✅ ${p.label.padEnd(30)} ${p.minPages}–${p.maxPages} pages` +
        `  $${lo.printCost.toFixed(2)}–$${hi.printCost.toFixed(2)} print`,
    );
    continue;
  }
  // "does not exist" means the SKU is wrong; a page_count error means the
  // declared min/max disagrees with Lulu's range for this binding + paper.
  if (!lo.ok) failures.push(`${label} at min ${p.minPages} pages: ${lo.msg}`);
  if (!hi.ok) failures.push(`${label} at max ${p.maxPages} pages: ${hi.msg}`);
  console.error(`  ❌ ${p.label.padEnd(30)} ${p.minPages}–${p.maxPages} pages`);
}

if (ARGS.has("--costs")) {
  // Lulu prices a book linearly in page count, so two quotes pin the whole
  // curve — these are the numbers the admin catalog's cost table expects.
  console.log(`\n▶ Wholesale cost model (USD, print only, excl. shipping + tax)`);
  for (const p of products) {
    const a = await quote(p.sku, p.minPages);
    const b = await quote(p.sku, Math.min(p.minPages + 10, p.maxPages));
    if (!a.ok || !b.ok) continue;
    const span = Math.min(p.minPages + 10, p.maxPages) - p.minPages;
    const perPage = span > 0 ? (b.printCost - a.printCost) / span : 0;
    console.log(
      `  ${p.label.padEnd(30)} basePerUnit ${(a.printCost - perPage * p.minPages).toFixed(2)}` +
        `  perPage ${perPage.toFixed(3)}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} problem(s):`);
  for (const f of failures) console.error(`   • ${f}`);
  console.error(
    `\nA product that fails here is rejected at print-job creation — after payment.\n`,
  );
  process.exit(1);
}
console.log(`\n✅ Every product is valid in the ${which} catalog.\n`);
