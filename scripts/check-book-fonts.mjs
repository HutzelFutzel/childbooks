#!/usr/bin/env node

/**
 * Keeps the book-language font policy honest.
 *
 * Runtime filtering trusts the exact @fontsource subset imported by
 * `ui/typography/fonts.ts`. This check fails when a declared font disappears,
 * its import no longer exists, or a font offered for Polish/Turkish loses its
 * latin-ext face.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  root,
  "books-frontend",
  "src",
  "ui",
  "typography",
  "fonts.ts",
);
const source = fs.readFileSync(sourcePath, "utf8");
const require = createRequire(import.meta.url);

const rows = [...source.matchAll(
  /\{\s*id:\s*"([^"]+)".*?import\("@fontsource\/([^/]+)\/([^"]+)"\)\s*\}/g,
)].map((match) => ({ id: match[1], packageId: match[2], importFile: match[3] }));

const westernBlock = source.match(
  /const WESTERN_ONLY_FONT_IDS = new Set\(\[([\s\S]*?)\]\);/,
)?.[1] ?? "";
const westernOnly = new Set([...westernBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]));

const failures = [];
for (const row of rows) {
  if (row.id !== row.packageId) {
    failures.push(`${row.id}: id does not match @fontsource package ${row.packageId}`);
    continue;
  }
  let packageDir;
  try {
    packageDir = path.dirname(require.resolve(`@fontsource/${row.packageId}/package.json`));
  } catch {
    failures.push(`${row.id}: @fontsource package is not installed`);
    continue;
  }
  if (!fs.existsSync(path.join(packageDir, row.importFile))) {
    failures.push(`${row.id}: imported CSS ${row.importFile} does not exist`);
  }
  if (!fs.existsSync(path.join(packageDir, "latin-400.css"))) {
    failures.push(`${row.id}: no Western Latin 400 face`);
  }
  if (
    !westernOnly.has(row.id) &&
    !fs.existsSync(path.join(packageDir, "latin-ext-400.css"))
  ) {
    failures.push(`${row.id}: marked for Polish/Turkish but has no latin-ext 400 face`);
  }
}

if (rows.length === 0) failures.push("No font definitions were found");

if (failures.length > 0) {
  console.error("Book font checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Book font checks passed: ${rows.length} Western Latin, ${rows.length - westernOnly.size} extended Latin.`,
  );
}
