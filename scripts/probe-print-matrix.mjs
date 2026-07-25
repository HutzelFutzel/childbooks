/**
 * probe-print-matrix.mjs — discover which print variants actually exist.
 *
 *   yarn probe:print                    # sweep the matrix in the active LULU_ENV
 *   yarn probe:print --live             # sweep the live catalog
 *   yarn probe:print --json out.json    # also write the raw results
 *
 * The provider publishes no endpoint that lists valid `pod_package_id`s, so the
 * only way to know whether a combination is sellable is to ask it to price one.
 * This sweeps the whole trim × binding × print × paper × finish cross product
 * against `/print-job-cost-calculations/` and prints what survived.
 *
 * ONE probe answers two questions at once. Asking for an absurd page count makes
 * the provider either name the package's real page range ("page_count must be in
 * range 24-800" ⇒ the package exists, and now we know its bounds) or reject the
 * package itself ("Pod Package ... does not exist"). Everything here is
 * read-only: nothing is ordered and nothing is charged.
 *
 * Use it when adding formats or options to the catalog — the measured page ranges
 * belong in `books-frontend/src/core/fulfillment/lulu/products.ts`, and a
 * combination missing from the report must not be offered for sale. Sandbox and
 * live are separate catalogs, so a sweep of one says nothing about the other.
 */
import { writeFileSync } from "node:fs";
import { readEnvLocal } from "./set-secrets.mjs";

const ARGS = process.argv.slice(2);
const has = (flag) => ARGS.includes(flag);
const valueOf = (flag) => {
  const i = ARGS.indexOf(flag);
  return i === -1 ? null : ARGS[i + 1];
};

/** Absurd on purpose: the rejection names the package's real page range. */
const ABSURD_PAGES = 100_000;

/** How many probes are in flight at once — polite, but not slow. */
const CONCURRENCY = 4;

/** MAIL is the one shipping level available in every country we sell to. */
const PROBE_LEVEL = "MAIL";

const PROBE_ADDRESS = {
  name: "Catalog Probe",
  street1: "1 Main St",
  city: "New York",
  state_code: "NY",
  postcode: "10001",
  country_code: "US",
  phone_number: "5555555555",
};

// ---- The matrix ------------------------------------------------------------

const TRIMS = [
  { id: "8.5x8.5", code: "0850X0850", label: 'Square 8.5×8.5"' },
  { id: "11x8.5", code: "1100X0850", label: 'Landscape 11×8.5"' },
  { id: "8.5x11", code: "0850X1100", label: 'Portrait 8.5×11"' },
];

const BINDINGS = [
  { id: "saddle-stitch", code: "SS", label: "Saddle stitch" },
  { id: "perfect-bound", code: "PB", label: "Perfect bound" },
  { id: "coil-bound", code: "CO", label: "Coil bound" },
  { id: "casewrap", code: "CW", label: "Casewrap hardcover" },
];

/** Interior ink + print quality, as the one choice a customer actually makes. */
const PRINT_TIERS = [
  { id: "premium-colour", ink: "FC", quality: "PRE", label: "Premium colour" },
  { id: "standard-colour", ink: "FC", quality: "STD", label: "Standard colour" },
  { id: "premium-bw", ink: "BW", quality: "PRE", label: "Premium B&W" },
  { id: "standard-bw", ink: "BW", quality: "STD", label: "Standard B&W" },
];

const PAPERS = [
  { id: "80-coated-white", code: "080CW444", label: "80# coated white" },
  { id: "60-uncoated-white", code: "060UW444", label: "60# uncoated white" },
  { id: "60-uncoated-cream", code: "060UC444", label: "60# uncoated cream" },
];

const FINISHES = [
  { id: "gloss", code: "G", label: "Gloss" },
  { id: "matte", code: "M", label: "Matte" },
];

const sku = (trim, binding, print, paper, finish) =>
  `${trim.code}${print.ink}${print.quality}${binding.code}${paper.code}${finish.code}XX`;

// ---- Provider --------------------------------------------------------------

const env = readEnvLocal();
const which = has("--live") ? "live" : (env.LULU_ENV || "sandbox").trim();
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Price one combination. Returns `exists` plus the page range when the provider
 * volunteered it. A throttle or outage is reported as `null` rather than as a
 * rejection — recording "doesn't exist" for an unreachable provider would delete
 * good formats from the catalog.
 */
async function probe(id, pages = ABSURD_PAGES, attempt = 0) {
  let res;
  let body;
  try {
    res = await fetch(`${base}/print-job-cost-calculations/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        line_items: [{ page_count: pages, pod_package_id: id, quantity: 1 }],
        shipping_address: PROBE_ADDRESS,
        shipping_level: PROBE_LEVEL,
      }),
    });
    body = await res.text();
  } catch (err) {
    if (attempt < 3) {
      await sleep(500 * 2 ** attempt);
      return probe(id, pages, attempt + 1);
    }
    return { sku: id, verdict: null, message: String(err) };
  }

  if (res.status === 429 || res.status >= 500) {
    if (attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      return probe(id, pages, attempt + 1);
    }
    return { sku: id, verdict: null, message: `${res.status} after retries` };
  }

  const flat = body.replace(/\s+/g, " ");
  if (res.ok) {
    // Priced an absurd page count: real, and it declares no upper bound here.
    const cost = Number(JSON.parse(body).line_item_costs?.[0]?.total_cost_excl_tax ?? 0);
    return { sku: id, verdict: true, pages: null, cost };
  }
  const range = flat.match(/page_count must be in range\s*(\d+)\s*[-–]\s*(\d+)/i);
  if (range) {
    return { sku: id, verdict: true, pages: { min: Number(range[1]), max: Number(range[2]) } };
  }
  return { sku: id, verdict: false, message: flat.slice(0, 120) };
}

/** Run `jobs` with bounded concurrency, preserving order. */
async function pool(jobs, worker) {
  const out = new Array(jobs.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await worker(jobs[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// ---- Sweep -----------------------------------------------------------------

const combos = [];
for (const trim of TRIMS) {
  for (const binding of BINDINGS) {
    for (const print of PRINT_TIERS) {
      for (const paper of PAPERS) {
        for (const finish of FINISHES) {
          combos.push({
            trim,
            binding,
            print,
            paper,
            finish,
            sku: sku(trim, binding, print, paper, finish),
          });
        }
      }
    }
  }
}

console.log(
  `\n▶ Probing ${combos.length} combinations against the ${which} catalog ` +
    `(${TRIMS.length} trims × ${BINDINGS.length} bindings × ${PRINT_TIERS.length} print tiers × ` +
    `${PAPERS.length} papers × ${FINISHES.length} finishes)\n`,
);

let done = 0;
const results = await pool(combos, async (combo) => {
  const r = await probe(combo.sku);
  done += 1;
  if (done % 20 === 0) process.stdout.write(`  …${done}/${combos.length}\n`);
  return { ...combo, ...r };
});

// ---- Report ----------------------------------------------------------------

const ok = results.filter((r) => r.verdict === true);
const rejected = results.filter((r) => r.verdict === false);
const unknown = results.filter((r) => r.verdict === null);

console.log(`\n▶ Formats (trim × binding)\n`);
for (const trim of TRIMS) {
  for (const binding of BINDINGS) {
    const inFormat = results.filter((r) => r.trim === trim && r.binding === binding);
    const good = inFormat.filter((r) => r.verdict === true);
    const label = `${trim.label} · ${binding.label}`.padEnd(38);
    if (good.length === 0) {
      const why = inFormat.find((r) => r.message)?.message ?? "rejected";
      console.log(`  ❌ ${label} no variants — ${why.slice(0, 70)}`);
      continue;
    }
    const ranges = [...new Set(good.map((r) => (r.pages ? `${r.pages.min}–${r.pages.max}` : "unbounded")))];
    console.log(
      `  ✅ ${label} ${String(good.length).padStart(2)}/${inFormat.length} variants` +
        `  pages ${ranges.join(", ")}`,
    );
    // Page bounds that differ WITHIN a format mean the range depends on an
    // option, so the catalog can't carry one range for the whole format.
    if (ranges.length > 1) {
      for (const r of good) {
        console.log(
          `       ${r.print.id}/${r.paper.id}/${r.finish.id}: ` +
            `${r.pages ? `${r.pages.min}–${r.pages.max}` : "unbounded"}`,
        );
      }
    }
  }
}

console.log(`\n▶ Option coverage (how many formats offer each option)\n`);
const formatsWithVariants = new Set(ok.map((r) => `${r.trim.id}/${r.binding.id}`));
for (const [axis, options, pick] of [
  ["Print", PRINT_TIERS, (r) => r.print.id],
  ["Paper", PAPERS, (r) => r.paper.id],
  ["Finish", FINISHES, (r) => r.finish.id],
]) {
  for (const option of options) {
    const formats = new Set(ok.filter((r) => pick(r) === option.id).map((r) => `${r.trim.id}/${r.binding.id}`));
    const mark = formats.size === 0 ? "❌" : formats.size === formatsWithVariants.size ? "✅" : "⚠️ ";
    console.log(
      `  ${mark} ${axis.padEnd(7)} ${option.label.padEnd(22)} ${formats.size}/${formatsWithVariants.size} formats`,
    );
  }
}

console.log(
  `\n▶ ${ok.length} sellable · ${rejected.length} rejected · ${unknown.length} inconclusive ` +
    `(of ${combos.length})\n`,
);
if (unknown.length > 0) {
  console.log(`  ⚠️  Inconclusive probes learned nothing — re-run before trusting the report:`);
  for (const r of unknown.slice(0, 10)) console.log(`     • ${r.sku}: ${r.message}`);
  console.log("");
}

const out = valueOf("--json");
if (out) {
  writeFileSync(
    out,
    JSON.stringify(
      {
        env: which,
        at: new Date().toISOString(),
        results: results.map((r) => ({
          sku: r.sku,
          trim: r.trim.id,
          binding: r.binding.id,
          print: r.print.id,
          paper: r.paper.id,
          finish: r.finish.id,
          ok: r.verdict,
          pages: r.pages ?? null,
          message: r.message ?? null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`  Wrote ${out}\n`);
}
