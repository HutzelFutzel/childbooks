/**
 * English copy is American English.
 *
 * Scans every English message (`messages/en.json`) and every string a person
 * could read in the frontend and backend sources — string literals and JSX
 * text, not identifiers or comments — for the British spellings the guide's
 * composer also rejects (`BRITISH_SPELLINGS`). Model prompts are skipped: they
 * are instructions, not UI. Short lowercase tokens ("premium-colour",
 * "cancelled") are skipped too: those are ids and provider values, and
 * renaming them would break stored data.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import en from "../books-frontend/messages/en.json";
import { BRITISH_SPELLINGS } from "../books-frontend/src/core/guide/agent/compose";

export interface CheckResult {
  failures: string[];
  notes: string[];
  report: string[];
  cases: number;
}

const ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === "childbooks") return dir;
    } catch {
      // Keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
})();

/** Model instructions and provider data, not UI. */
const SKIP = [
  "books-frontend/src/core/config/audienceCatalog.ts",
  "books-frontend/src/core/prompts/",
  "books-frontend/src/core/pipeline/",
  "books-frontend/src/core/providers/",
  "books-frontend/src/core/book/regionText.ts",
  "books-frontend/src/core/config/options.ts",
  "books-frontend/src/core/guide/agent/compose.ts",
  "books-frontend/src/core/guide/agent/resolve.ts",
  "books-frontend/src/core/guide/agent/screen.ts",
  // Words printed in a book, per book language: an en-GB book says "Mum & Dad".
  "books-frontend/src/core/guide/coverWords.ts",
];

const ID_LITERAL = /^["'`][a-z0-9_:/.-]+["'`]$/;

function sourceFiles(relativeDir: string): string[] {
  const absoluteDir = join(ROOT, relativeDir);
  const out: string[] = [];
  for (const entry of readdirSync(absoluteDir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const absolute = join(absoluteDir, entry);
    const rel = relative(ROOT, absolute).split(sep).join("/");
    if (statSync(absolute).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

/** String literals and JSX text, outside comments. */
function readableSpans(source: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (source.startsWith("//", i)) {
      const j = source.indexOf("\n", i);
      i = j < 0 ? n : j;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const j = source.indexOf("*/", i + 2);
      i = j < 0 ? n : j + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "\n" && c !== "`") break;
        j += 1;
      }
      out.push({ text: source.slice(i, j + 1), at: i });
      i = j + 1;
      continue;
    }
    if (c === ">") {
      const m = /^>([^<>{}]*[A-Za-z][^<>{}]*)</.exec(source.slice(i, i + 2000));
      if (m && /[\s]/.test(m[1]!) && !/[;=()]/.test(m[1]!)) {
        out.push({ text: m[1]!, at: i + 1 });
        i += m[0].length - 1;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

function british(text: string): string[] {
  return BRITISH_SPELLINGS.filter(([pattern]) => pattern.test(text)).map(([, american]) => american);
}

export function checkEnUsCopy(): CheckResult {
  const failures: string[] = [];
  let cases = 0;

  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") {
      cases += 1;
      const found = british(value);
      if (found.length) failures.push(`messages/en.json ${path} is British English (${found.join(", ")}).`);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(en, "");

  let files = 0;
  for (const dir of ["books-frontend/src", "functions/src"]) {
    for (const file of sourceFiles(dir)) {
      if (SKIP.some((prefix) => file.startsWith(prefix))) continue;
      files += 1;
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const span of readableSpans(source)) {
        if (ID_LITERAL.test(span.text)) continue;
        cases += 1;
        const found = british(span.text);
        if (found.length) {
          const line = source.slice(0, span.at).split("\n").length;
          failures.push(`${file}:${line} is British English (${found.join(", ")}): ${span.text.trim().slice(0, 80)}`);
        }
      }
    }
  }

  return {
    failures,
    notes: [`American English: ${files} source files and every English message checked.`],
    report: [],
    cases,
  };
}
