/**
 * check-landing.mjs — assert the landing-page invariants hold.
 *
 *   yarn check:landing
 *
 * Offline and deterministic. Bundles the shipped `core/config/landingPages.ts` rather
 * than restating the rules, so the checker cannot pass while the code that
 * decides what the public sees is wrong.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "landing-invariants.ts");

const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-landing");
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
  console.log("Landing page invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
