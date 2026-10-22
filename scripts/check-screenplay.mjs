/**
 * check-screenplay.mjs — the page plan reads the story back, keeps its words,
 * and fits the age band and the printed page order.
 *
 *   yarn check:screenplay
 *
 * Offline and deterministic: the one model call a plan makes is stubbed, so
 * what runs is the shipped prompt, checks, repair and re-cut, not a copy.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-screenplay");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "screenplay-invariants.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod"],
    logLevel: "warning",
  });
  console.log("Screenplay invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
