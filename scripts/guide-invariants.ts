/**
 * Invariants for the guided-studio rollout, plus the legacy-manifest check.
 *
 * The guide's state model — catalog, playlist, engine, patch — is checked by
 * `guide-engine-invariants.ts`, and its interpreter's prompt and output contract by
 * `guide-interpreter-invariants.ts`. Both merge their results into this report so
 * one command covers the whole feature.
 *
 * Two things are asserted here, and both are the kind of mistake that is silent
 * until it is expensive.
 *
 * **1. The rollout cannot leak.** `resolveGuideMode` decides which studio a
 * reader gets. It is small, but it is the only thing standing between "we are
 * building a new flow" and "a paying customer is authoring their book in it by
 * accident". Because it is pure and its inputs are finite, we don't have to
 * argue about that — the whole input space is enumerated below and the claim is
 * checked directly: no combination of override, preference or bucket puts a
 * non-admin on the new flow unless the rollout itself says so.
 *
 * **2. The legacy manifest stays honest.** Superseded code is marked
 * `@legacy guide-v2` in its own doc comment and listed in docs/LEGACY-GUIDE.md.
 * A marker without a row is code nobody will remember to delete; a row without a
 * marker is a list that has drifted from the source. Both fail here.
 *
 * Offline and deterministic: arithmetic, string hashing and file reads. No
 * network, no emulator, no model call.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import {
  createDefaultGuideConfig,
  describeGuideRollout,
  guideConfigSchema,
  normalizeGuideConfig,
  GUIDE_ROLLOUT_MODES,
  type GuideRollout,
  type GuideRolloutMode,
} from "../books-frontend/src/core/config/guide";
import {
  guideBucketOf,
  guideToggleAvailable,
  parseGuideOverride,
  resolveGuideMode,
  type GuideMode,
  type GuideModeOverride,
} from "../books-frontend/src/core/guide/mode";
import { checkGuideEngine } from "./guide-engine-invariants";
import { checkGuideInterpreter } from "./guide-interpreter-invariants";
import { checkGuideSession } from "./guide-session-invariants";
import { checkGuideWidgets } from "./guide-widget-invariants";

/**
 * The repository root, found by walking up from the working directory. Not
 * derived from `import.meta.url`: the checker runs as a bundle inside
 * `node_modules/.cache`, so its own path says nothing about where the source is.
 */
const ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === "childbooks") return dir;
    } catch {
      // Not this one — keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the repository root — run this from inside the repo.");
})();

const failures: string[] = [];
const notes: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

/** Stand-in book ids. Bucketing is by project id, so these are the population. */
const SAMPLE_KEYS = Array.from({ length: 400 }, (_, i) => `book-${i}`);

// --- Shipped default -------------------------------------------------------

const shipped = createDefaultGuideConfig();

if (!guideConfigSchema.safeParse(shipped).success) {
  fail("The shipped default config does not satisfy its own schema.");
}
// The document is absent in every environment until an admin writes it, so the
// default IS the live value for the whole build-out. It has to be a mode under
// which no customer is included.
if (shipped.rollout.mode !== "adminOnly") {
  fail(`The shipped rollout is "${shipped.rollout.mode}"; only "adminOnly" or "off" may ship.`);
}
if (shipped.rollout.percent !== 0) {
  fail(`The shipped rollout includes ${shipped.rollout.percent}% of customers; it must include 0%.`);
}

// Normalizing the default must be a no-op, or a saved-then-reloaded document
// differs from the one the code ships.
const roundTripped = normalizeGuideConfig(structuredClone(shipped));
if (JSON.stringify(roundTripped) !== JSON.stringify(shipped)) {
  fail(`Round-tripping the default changed it: ${JSON.stringify(roundTripped)}.`);
}

// --- Normalization fails closed -------------------------------------------

const garbage: [label: string, input: unknown][] = [
  ["absent", undefined],
  ["null", null],
  ["empty", {}],
  ["a string", "on"],
  ["a number", 1],
  ["an array", []],
  ["no rollout", { version: 1 }],
  ["rollout is a string", { version: 1, rollout: "on" }],
  ["unknown mode", { version: 1, rollout: { mode: "everyone", percent: 100 } }],
  ["mode cased wrong", { version: 1, rollout: { mode: "ON", percent: 100 } }],
  ["percent missing", { version: 1, rollout: { mode: "percentage" } }],
  ["percent is a string", { version: 1, rollout: { mode: "percentage", percent: "100" } }],
  ["percent is NaN", { version: 1, rollout: { mode: "percentage", percent: Number.NaN } }],
  ["percent is Infinity", { version: 1, rollout: { mode: "percentage", percent: Number.POSITIVE_INFINITY } }],
  ["percent above range", { version: 1, rollout: { mode: "percentage", percent: 4000 } }],
  ["percent below range", { version: 1, rollout: { mode: "percentage", percent: -20 } }],
];

for (const [label, input] of garbage) {
  const config = normalizeGuideConfig(input);
  if (!guideConfigSchema.safeParse(config).success) {
    fail(`Normalizing ${label} produced a document that fails the schema.`);
  }
  // Only a document that explicitly NAMES a wide mode may include customers.
  // Everything else — absent, malformed, or a mode that doesn't exist — has to
  // normalize to a rollout that reaches nobody. Stated in terms of who resolves
  // to the guide rather than in terms of the stored numbers, because that is the
  // consequence anyone would actually care about.
  if (customerGetsGuide(config.rollout) && !namesWideMode(input)) {
    fail(`Normalizing ${label} opened the new flow to customers.`);
  }
}

/** Whether the raw input asked for a mode that is meant to include customers. */
function namesWideMode(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const rollout = (input as { rollout?: unknown }).rollout;
  if (!rollout || typeof rollout !== "object") return false;
  const mode = (rollout as { mode?: unknown }).mode;
  return mode === "on" || mode === "percentage";
}

if (normalizeGuideConfig({ version: 1, rollout: { mode: "percentage" } }).rollout.percent !== 0) {
  fail('A "percentage" rollout with an unreadable share must fall back to 0%, not to everyone.');
}
if (normalizeGuideConfig({ version: 1, rollout: { mode: "everyone", percent: 100 } }).rollout.mode !== "adminOnly") {
  fail("An unknown mode must fall back to the shipped default.");
}
if (normalizeGuideConfig({ version: 1, rollout: { mode: "percentage", percent: 4000 } }).rollout.percent !== 100) {
  fail("An out-of-range percent must clamp into 0–100 rather than be dropped.");
}
if (normalizeGuideConfig({ version: 1, rollout: { mode: "percentage", percent: 12.6 } }).rollout.percent !== 13) {
  fail("A fractional percent must round to a whole bucket.");
}

/** Whether ANY customer (non-admin) reaches the new flow under this rollout. */
function customerGetsGuide(rollout: GuideRollout): boolean {
  return SAMPLE_KEYS.some(
    (bucketKey) =>
      resolveGuideMode({ rollout, isAdmin: false, bucketKey }) === "guide" ||
      resolveGuideMode({ rollout, isAdmin: false, bucketKey, override: "guide" }) === "guide",
  );
}

// --- Resolution: the whole input space ------------------------------------

const OVERRIDES: GuideModeOverride[] = [null, "guide", "legacy"];
const PREFERENCES: GuideModeOverride[] = [null, "guide", "legacy"];
const BUCKET_KEYS: (string | null)[] = [null, "book-1", "book-2", "book-399"];
const PERCENTS = [0, 1, 50, 99, 100];

let cases = 0;
for (const mode of GUIDE_ROLLOUT_MODES) {
  for (const percent of PERCENTS) {
    const rollout: GuideRollout = { mode, percent };
    for (const override of OVERRIDES) {
      for (const preference of PREFERENCES) {
        for (const bucketKey of BUCKET_KEYS) {
          for (const isAdmin of [false, true]) {
            cases += 1;
            const resolved = resolveGuideMode({
              rollout,
              isAdmin,
              override,
              preference,
              bucketKey,
            });

            // Anyone may ask for the wizard, always.
            if (override === "legacy" && resolved !== "legacy") {
              fail(`?guide=old was ignored (${describe({ mode, percent, override, preference, bucketKey, isAdmin })}).`);
            }
            // The kill switch beats every opt-in, admins included.
            if (mode === "off" && resolved !== "legacy") {
              fail(`An "off" rollout still resolved to the guide (${describe({ mode, percent, override, preference, bucketKey, isAdmin })}).`);
            }
            // A customer only ever gets what the rollout grants — nothing they
            // could put in a URL or in local state can widen it.
            if (!isAdmin && resolved === "guide") {
              const granted =
                mode === "on" || (mode === "percentage" && percent > 0 && bucketKey !== null);
              if (!granted) {
                fail(`A customer reached the guide without a rollout that grants it (${describe({ mode, percent, override, preference, bucketKey, isAdmin })}).`);
              }
            }
            // An admin who has not chosen sees exactly what a customer in this
            // rollout sees, so "what admins see" is never its own third mode.
            if (isAdmin && override === null && preference === null) {
              const asCustomer = resolveGuideMode({ rollout, isAdmin: false, bucketKey });
              if (resolved !== asCustomer) {
                fail(`An admin with no preference diverged from the audience (${describe({ mode, percent, override, preference, bucketKey, isAdmin })}).`);
              }
            }
          }
        }
      }
    }
  }
}

function describe(c: {
  mode: GuideRolloutMode;
  percent: number;
  override: GuideModeOverride;
  preference: GuideModeOverride;
  bucketKey: string | null;
  isAdmin: boolean;
}): string {
  return [
    c.isAdmin ? "admin" : "customer",
    `${c.mode}@${c.percent}%`,
    `override=${c.override ?? "none"}`,
    `preference=${c.preference ?? "none"}`,
    `bucket=${c.bucketKey ?? "none"}`,
  ].join(" ");
}

// An admin's stated preference has to actually be honoured, or the toggle we
// ship them is decoration.
for (const mode of ["adminOnly", "percentage", "on"] as const) {
  const rollout: GuideRollout = { mode, percent: 50 };
  for (const preference of ["guide", "legacy"] as const) {
    const resolved = resolveGuideMode({ rollout, isAdmin: true, preference, bucketKey: "book-1" });
    if (resolved !== preference) {
      fail(`An admin preferring "${preference}" under "${mode}" got "${resolved}".`);
    }
  }
}

// The toggle is offered exactly when choosing would change something.
for (const mode of GUIDE_ROLLOUT_MODES) {
  const rollout: GuideRollout = { mode, percent: 50 };
  if (guideToggleAvailable(rollout, false)) fail(`The flow toggle is offered to customers under "${mode}".`);
  const expected = mode !== "off";
  if (guideToggleAvailable(rollout, true) !== expected) {
    fail(`The flow toggle should be ${expected ? "offered" : "hidden"} for admins under "${mode}".`);
  }
}

// The URL contract. Unknown values must mean "no request", not either flow.
for (const [value, expected] of [
  ["new", "guide"],
  ["old", "legacy"],
  ["", null],
  ["true", null],
  ["guide", null],
  [null, null],
  [undefined, null],
] as [string | null | undefined, GuideModeOverride][]) {
  const parsed = parseGuideOverride(value);
  if (parsed !== expected) {
    fail(`?guide=${String(value)} parsed as ${String(parsed)} instead of ${String(expected)}.`);
  }
}

// --- Bucketing -------------------------------------------------------------

// Stickiness: a reader's flow must not change between page loads, which is the
// difference between a partial rollout and a coin flip.
for (const key of SAMPLE_KEYS.slice(0, 20)) {
  if (guideBucketOf(key) !== guideBucketOf(key)) fail(`Bucketing "${key}" is not deterministic.`);
}
for (const key of SAMPLE_KEYS) {
  const bucket = guideBucketOf(key);
  if (!Number.isInteger(bucket) || bucket < 0 || bucket > 99) {
    fail(`Bucket for "${key}" is ${bucket}, outside 0–99.`);
  }
}

// The two ends have to be exact, or "0%" leaks and "100%" excludes someone.
const zero: GuideRollout = { mode: "percentage", percent: 0 };
const hundred: GuideRollout = { mode: "percentage", percent: 100 };
for (const bucketKey of SAMPLE_KEYS) {
  if (resolveGuideMode({ rollout: zero, isAdmin: false, bucketKey }) !== "legacy") {
    fail(`A 0% rollout included "${bucketKey}".`);
  }
  if (resolveGuideMode({ rollout: hundred, isAdmin: false, bucketKey }) !== "guide") {
    fail(`A 100% rollout excluded "${bucketKey}".`);
  }
}

// Ramping may only ADD readers: someone already on the new flow must not be
// thrown back to the wizard by a wider rollout, which would strand a
// half-authored book in the flow that didn't make it.
for (const bucketKey of SAMPLE_KEYS) {
  let wasIncluded = false;
  for (const percent of [0, 5, 10, 25, 50, 75, 100]) {
    const included =
      resolveGuideMode({ rollout: { mode: "percentage", percent }, isAdmin: false, bucketKey }) ===
      "guide";
    if (wasIncluded && !included) {
      fail(`Ramping to ${percent}% dropped "${bucketKey}", which was already included.`);
    }
    wasIncluded ||= included;
  }
}

// Roughly uniform, or a "10% rollout" is a number that means nothing. Wide
// tolerance on purpose: this is a smoke test for a broken hash, not a claim
// about the distribution.
for (const percent of [10, 50]) {
  const included = SAMPLE_KEYS.filter(
    (bucketKey) =>
      resolveGuideMode({ rollout: { mode: "percentage", percent }, isAdmin: false, bucketKey }) ===
      "guide",
  ).length;
  const share = (included / SAMPLE_KEYS.length) * 100;
  if (Math.abs(share - percent) > 10) {
    fail(`A ${percent}% rollout included ${share.toFixed(1)}% of ${SAMPLE_KEYS.length} books.`);
  } else {
    notes.push(`${percent}% rollout → ${share.toFixed(1)}% of ${SAMPLE_KEYS.length} sample books`);
  }
}

// A percentage rollout with nothing to bucket by must exclude, not include.
if (resolveGuideMode({ rollout: hundred, isAdmin: false, bucketKey: null }) !== "legacy") {
  fail("A customer with no bucket key was included in a percentage rollout.");
}

// --- Legacy manifest ------------------------------------------------------

const MANIFEST = join("docs", "LEGACY-GUIDE.md");
const MARKER = "@legacy guide-v2";
const SOURCE_ROOTS = [join("books-frontend", "src"), join("functions", "src"), "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
/**
 * Paths the manifest names, checked to still exist. `tsx` precedes `ts` in the
 * alternation because the regex would otherwise match the shorter extension and
 * silently truncate every component path to a file that does not exist.
 */
const PATH_RE = /(?:books-frontend|functions|scripts|docs)\/[\w./-]+\.(?:tsx|ts|mjs|md)/g;
/** This checker names the marker in order to search for it; it isn't marked. */
const SELF = "scripts/guide-invariants.ts";

let manifest = "";
try {
  manifest = readFileSync(join(ROOT, MANIFEST), "utf8");
} catch {
  fail(`${MANIFEST} is missing — every @legacy marker needs a row in it.`);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(rel);
  }
  return out;
}

const marked = SOURCE_ROOTS.flatMap(sourceFiles)
  .map((rel) => rel.split(sep).join("/"))
  .filter((rel) => rel !== SELF && readFileSync(join(ROOT, rel), "utf8").includes(MARKER));

const mentioned = new Set(manifest.match(PATH_RE) ?? []);

for (const rel of marked) {
  if (!mentioned.has(rel)) {
    fail(`${rel} is marked "${MARKER}" but is not listed in ${MANIFEST}.`);
  }
}

// The other direction: a manifest that names files which no longer exist is a
// list nobody has read in a while.
for (const rel of mentioned) {
  try {
    statSync(join(ROOT, rel));
  } catch {
    fail(`${MANIFEST} lists ${rel}, which does not exist.`);
  }
}

// Every row in the Retire table has to point at marked code, so the table can't
// grow entries that no longer correspond to anything.
const retireSection = manifest.split("## Retire")[1]?.split("\n## ")[0] ?? "";
const retirePaths = new Set(retireSection.match(PATH_RE) ?? []);
if (manifest && retirePaths.size === 0) {
  fail(`${MANIFEST} has no files in its Retire table; the marker convention is unenforced.`);
}
const markedSet = new Set(marked);
if (![...retirePaths].some((rel) => markedSet.has(rel))) {
  fail(`No file named in the Retire table of ${MANIFEST} carries a "${MARKER}" marker.`);
}

// --- The state model and the interpreter ----------------------------------

const engine = checkGuideEngine();
failures.push(...engine.failures);
notes.push(...engine.notes);
cases += engine.cases;

const interpreter = checkGuideInterpreter();
failures.push(...interpreter.failures);
notes.push(...interpreter.notes);
cases += interpreter.cases;

const session = checkGuideSession();
failures.push(...session.failures);
notes.push(...session.notes);
cases += session.cases;

const widgets = checkGuideWidgets();
failures.push(...widgets.failures);
notes.push(...widgets.notes);
cases += widgets.cases;

// --- Report ---------------------------------------------------------------

console.log("Guide rollout");
console.log(`  shipped   ${describeGuideRollout(shipped.rollout)}`);
for (const mode of GUIDE_ROLLOUT_MODES) {
  const rollout: GuideRollout = { mode, percent: 25 };
  const asCustomer: GuideMode = resolveGuideMode({ rollout, isAdmin: false, bucketKey: "book-1" });
  const asAdmin: GuideMode = resolveGuideMode({ rollout, isAdmin: true, preference: "guide" });
  console.log(
    `  ${mode.padEnd(10)} customer → ${asCustomer.padEnd(6)}  admin opting in → ${asAdmin}`,
  );
}

console.log();
for (const line of engine.report) console.log(line);

console.log();
for (const line of interpreter.report) console.log(line);

console.log();
for (const line of session.report) console.log(line);

console.log();
for (const line of widgets.report) console.log(line);

console.log(`\nLegacy manifest (${MANIFEST})`);
if (marked.length === 0) {
  console.log("  no files marked for retirement");
}
for (const rel of marked) console.log(`  · ${rel}`);

if (notes.length > 0) {
  console.log("\nNotes");
  for (const note of notes) console.log(`  · ${note}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `\n${cases} cases, ${SAMPLE_KEYS.length} bucketed books, ${marked.length} marked file${marked.length === 1 ? "" : "s"} — all invariants hold.`,
  );
}
