/**
 * Offline checks for the book-wide fit of story text: one size across the book,
 * nothing clipped, the reader's own size left alone. Bundles the shipped modules
 * so it exercises the same code the studio runs.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-body-fit");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "body-fit-invariants.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod"],
    // The font module lazy-loads stylesheets; measuring needs none of them.
    loader: { ".css": "empty", ".woff": "empty", ".woff2": "empty" },
    logLevel: "warning",
  });
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
