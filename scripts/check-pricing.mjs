/**
 * check-pricing.mjs — assert the pricing invariants hold.
 *
 *   yarn check:pricing
 *
 * Offline and deterministic: no provider, no credentials, no network. It
 * evaluates the SHIPPED pricing math (`productMath.ts`, `variants.ts`) at
 * several page counts and variants, and fails on the properties that quietly
 * cost money — a variant that loses margin as the book gets longer, a shipping
 * fallback that doesn't scale with copies, a seeded product whose only shipping
 * tier isn't sold to our biggest markets.
 *
 * The checks are written in TypeScript (`pricing-invariants.ts`) and bundled
 * with esbuild here rather than reimplemented in plain JavaScript. Restating
 * the math in the checker would let the checker pass while the code it's
 * supposed to protect was wrong, which is the one thing a check like this must
 * not do.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "pricing-invariants.ts");

// Built inside the repo rather than in a temp directory: the bundle imports
// zod at runtime, and Node resolves that from the importing file's location.
const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-pricing");
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
  console.log("Pricing invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
