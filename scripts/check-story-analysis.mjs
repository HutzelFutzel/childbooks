/**
 * Offline checks for story-analysis identity merge and prompt scope.
 *
 *   yarn check:story-analysis
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-story-analysis");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "story-analysis-invariants.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod"],
    logLevel: "warning",
  });
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
