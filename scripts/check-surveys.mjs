/**
 * check-surveys.mjs — assert the profiling survey invariants hold.
 *
 *   yarn check:surveys
 *
 * Offline and deterministic: no Firestore, no network, no credentials. It runs the
 * SHIPPED survey config engine (`surveys.ts`) over the targeting, validation and
 * reporting paths and fails on the mistakes that don't announce themselves — a
 * survey that asks the same person twice, an answer accepted for a question that
 * no longer exists, a set of percentages whose denominator isn't the population
 * they claim to describe.
 *
 * The checks are TypeScript (`survey-invariants.ts`) bundled with esbuild here
 * rather than reimplemented in plain JavaScript, so the checker can't pass while
 * the code it exists to protect is wrong.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "survey-invariants.ts");

// Built inside the repo rather than in a temp directory: the bundle imports zod at
// runtime, and Node resolves that from the importing file's location.
const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-surveys");
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
  console.log("Survey invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
