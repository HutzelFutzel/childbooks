/**
 * check-locales.mjs — assert the locale invariants hold.
 *
 *   yarn check:locales
 *
 * Offline and deterministic: no network, no credentials, no Firestore. It reads
 * the locale registry and the message catalogues on disk and fails on the
 * properties that break quietly — a key present in English and missing in
 * German, a translation that dropped an ICU placeholder, two locales claiming
 * the same hreflang tag, a slug pipeline that turns "Straße" into "stra-e".
 *
 * The checks are written in TypeScript (`locale-invariants.ts`) and bundled with
 * esbuild here rather than reimplemented in plain JavaScript, for the same
 * reason `check-pricing.mjs` does it: restating the registry or the slug rules
 * in the checker would let the checker pass while the shipped code was wrong.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ENTRY = join(HERE, "locale-invariants.ts");

// Built inside the repo rather than in a temp directory: the bundle imports zod
// at runtime, and Node resolves that from the importing file's location.
const outDir = join(ROOT, "node_modules", ".cache", "childbooks-locales");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

// The bundle runs from node_modules/.cache, so it can't find the repo from its
// own location and shouldn't have to trust the working directory. This wrapper
// knows both, so it passes the answer along.
process.env.CHILDBOOKS_ROOT = ROOT;

try {
  await build({
    entryPoints: [ENTRY],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    // Zod is the only runtime dependency the config modules pull in; leaving it
    // external keeps the bundle small and resolves it from the workspace.
    external: ["zod"],
    logLevel: "warning",
  });
  console.log("Locale invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
