/**
 * Compare two directories of captured HTML, ignoring the things that differ
 * between any two builds.
 *
 * Build hashes, React's per-render nonce comments and chunk filenames change on
 * every `next build`, so a raw byte diff of two builds is all noise. This
 * reports two views:
 *
 *   1. **markup** — the SSR'd DOM with `<script>`/`<link>` stripped. This is the
 *      page a reader and a crawler see, and it is the view that must not change.
 *   2. **full** — everything, hashes normalised. Differences here that don't
 *      appear in the markup view are payload plumbing (chunk ids inside the RSC
 *      stream), which is expected to move between builds.
 *
 * `--ignore-dir` drops the `dir="ltr"` attribute, for comparing against a
 * baseline captured before the attribute existed.
 *
 * Usage: node scripts/diff-html.mjs <baseDir> <newDir> [--ignore-dir]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const ignoreDir = args.includes("--ignore-dir");
const [baseDir, newDir] = args.filter((a) => !a.startsWith("--"));
if (!baseDir || !newDir) {
  console.error("usage: node scripts/diff-html.mjs <baseDir> <newDir> [--ignore-dir]");
  process.exit(2);
}

function base(html) {
  let out = html
    .replace(/[a-f0-9]{16,}/g, "HASH")
    .replace(/\/_next\/static\/[^"'/]+\//g, "/_next/static/BUILD/")
    .replace(/<!--[^>]*-->/g, "");
  if (ignoreDir) out = out.replace(/ dir="ltr"/g, "");
  return out;
}

const full = (html) => base(html).replace(/>\s+</g, "><").trim();

const markup = (html) =>
  base(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<link\b[^>]*>/g, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/>\s+</g, ">\n<")
    .trim();

/** Line-level hunks, capped so a genuinely different page doesn't flood output. */
function hunks(a, b, limit = 6) {
  const al = a.split("\n");
  const bl = b.split("\n");
  const out = [];
  for (let i = 0, j = 0; (i < al.length || j < bl.length) && out.length < limit; ) {
    if (al[i] === bl[j]) {
      i += 1;
      j += 1;
      continue;
    }
    // Resynchronise by finding the next line that matches on both sides.
    const at = bl.indexOf(al[i], j);
    const bt = al.indexOf(bl[j], i);
    if (at !== -1 && (bt === -1 || at - j <= bt - i)) {
      out.push(`    + ${bl.slice(j, at).join(" | ").slice(0, 200)}`);
      j = at;
    } else if (bt !== -1) {
      out.push(`    - ${al.slice(i, bt).join(" | ").slice(0, 200)}`);
      i = bt;
    } else {
      out.push(`    - ${(al[i] ?? "").slice(0, 200)}`);
      out.push(`    + ${(bl[j] ?? "").slice(0, 200)}`);
      i += 1;
      j += 1;
    }
  }
  return out;
}

let markupDiffs = 0;
let fullDiffs = 0;

for (const name of readdirSync(baseDir).filter((f) => f.endsWith(".html"))) {
  const aRaw = readFileSync(join(baseDir, name), "utf8");
  let bRaw;
  try {
    bRaw = readFileSync(join(newDir, name), "utf8");
  } catch {
    console.log(`${name}: MISSING in ${newDir}`);
    markupDiffs += 1;
    continue;
  }

  const sameMarkup = markup(aRaw) === markup(bRaw);
  const sameFull = full(aRaw) === full(bRaw);
  if (!sameMarkup) markupDiffs += 1;
  if (!sameFull) fullDiffs += 1;

  console.log(
    `${name}: markup ${sameMarkup ? "identical" : "DIFFERS"}, full ${sameFull ? "identical" : "differs"}`,
  );
  if (!sameMarkup) console.log(hunks(markup(aRaw), markup(bRaw)).join("\n"));
}

console.log(
  markupDiffs === 0
    ? `\nRendered markup identical on every page (${fullDiffs} page(s) differ only in build plumbing).`
    : `\n${markupDiffs} page(s) differ in rendered markup.`,
);
process.exit(markupDiffs === 0 ? 0 : 1);
