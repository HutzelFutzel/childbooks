/**
 * Offline checks for the order pipeline: the lifecycle rules (what needs a person,
 * and when), replacement keys, and the print-provider recovery lookup. Bundles
 * the shipped modules so it runs the same code the backend does.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-fulfillment");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "fulfillment-invariants.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod", "sharp", "firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*"],
    logLevel: "warning",
  });
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
