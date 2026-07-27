/**
 * check-print-geometry.mjs — assert the print geometry + assembly invariants.
 *
 *   yarn check:print-geometry
 *
 * Offline and deterministic: no provider, no credentials, no network. It
 * evaluates the SHIPPED geometry and PDF assembly (`core/print/*`) and fails on
 * the properties that produce a valid-but-wrong book — a page declared at one
 * size and drawn at another, a spread that isn't split into leaves, an interior
 * that's short of the page count the order was priced at.
 *
 * Sibling of `check:pricing`, and for the same reason: the checks are written
 * in TypeScript and bundled with esbuild rather than reimplemented in plain
 * JavaScript, so the checker can't pass while the shipped code is wrong.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "print-invariants.ts");

// Built inside the repo so Node resolves the bundle's runtime imports from the
// workspace, same as the pricing checker.
const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-print");
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
    external: ["zod", "pdf-lib"],
    logLevel: "warning",
  });
  console.log("Print geometry invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
