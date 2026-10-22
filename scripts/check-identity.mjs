/**
 * check-identity.mjs — a person, place or thing stays the same one when the
 * story's words change (translation, a fresh reading), and the page plan is
 * made again exactly when who is in the book changed.
 *
 *   yarn check:identity
 *
 * Offline and deterministic: the model calls are stubbed, so what runs is the
 * shipped prompts and checks, not a copy.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-identity");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "identity-invariants.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod"],
    loader: { ".json": "json" },
    logLevel: "warning",
  });
  console.log("Identity invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
