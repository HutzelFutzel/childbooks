/**
 * check-save.mjs — saving a book: why a save fails, when it is tried again, what is kept on the
 * device until the cloud has it, how it is put back, and how full a book is.
 *
 *   yarn check:save
 *
 * Offline and deterministic: the real project store against a fake cloud and an in-memory outbox.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-save");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "save-invariants.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod"],
    // The studio's design code imports its fonts' stylesheets; Node has no use for them.
    loader: { ".css": "empty" },
    // The app's state modules reach packages that load Node built-ins with require().
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: "warning",
  });
  console.log("Saving invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? (process.env.CHECK_STACK ? error.stack : error.message) : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
