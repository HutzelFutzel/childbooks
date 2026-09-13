/**
 * check-audience.mjs — assert the age band invariants hold.
 *
 *   yarn check:audience
 *   yarn check:audience --emit config/staging
 *
 * Offline and deterministic. Bundles the shipped audience catalog, story craft
 * catalog and overlay compiler rather than restating their rules, so the checker
 * cannot pass while the configuration that writes every book is contradictory.
 *
 * With `--emit <dir>` it also writes the shipped defaults out as the two
 * Firestore documents, so a staging environment is seeded from exactly what the
 * code ships rather than a hand-maintained copy.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "audience-invariants.ts");

const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-audience");
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
  console.log("Audience invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
