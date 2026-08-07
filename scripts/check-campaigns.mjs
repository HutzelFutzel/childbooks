/**
 * check-campaigns.mjs — assert the marketing campaign invariants hold.
 *
 *   yarn check:campaigns
 *
 * Offline and deterministic: no Firestore, no Stripe, no credentials, no
 * network. It evaluates the SHIPPED campaign engine (`campaigns.ts`) across the
 * whole trigger/condition/effect matrix and fails on the properties that
 * quietly hand out money — a refund floor that jumps its own ceiling, a
 * condition that a missing fact turns into a free pass, a hand-edited config
 * that pays Sparks before anyone has paid us, a public projection that ships
 * the daily budget to the browser.
 *
 * The checks are written in TypeScript (`campaign-invariants.ts`) and bundled
 * with esbuild here rather than reimplemented in plain JavaScript. Restating the
 * rules in the checker would let the checker pass while the code it's supposed
 * to protect was wrong, which is the one thing a check like this must not do.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "campaign-invariants.ts");

// Built inside the repo rather than in a temp directory: the bundle imports zod
// at runtime, and Node resolves that from the importing file's location.
const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-campaigns");
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
    // Zod is the only runtime dependency the config modules pull in; leaving it
    // external keeps the bundle small and resolves it from the workspace.
    external: ["zod"],
    logLevel: "warning",
  });
  console.log("Campaign invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
