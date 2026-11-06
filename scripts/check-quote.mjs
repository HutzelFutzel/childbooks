/**
 * check-quote.mjs — the print-order quote: the integer arithmetic behind what a customer is shown and
 * what Stripe is asked to charge, and the identity of what a quote was made for.
 *
 *   yarn check:quote
 *
 * Offline and deterministic: pure functions, no Stripe, no Firestore, no network.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-quote");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "quote-invariants.ts")],
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
  console.log("Quote invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? (process.env.CHECK_STACK ? error.stack : error.message) : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
