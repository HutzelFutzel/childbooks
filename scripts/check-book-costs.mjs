/**
 * check-book-costs.mjs — assert the "cost per book" arithmetic holds.
 *
 *   yarn check:book-costs
 *
 * Offline and deterministic. It runs the SHIPPED report builder
 * (`functions/src/bookCostReport.ts`) over hand-made books and fails on the
 * properties that would make the headline number quietly wrong: components that
 * don't add up to the total, a per-page figure that is a mean of ratios, a
 * print-prep cost that is dropped or counted twice, a slim snapshot that wipes a
 * book's page count. Bundled with esbuild so the check runs the real code, not a
 * restatement of it.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "book-cost-invariants.ts");
const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-book-costs");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [ENTRY],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod"],
    logLevel: "warning",
  });
  console.log("Book cost invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
