/**
 * check-pages.mjs — editing a page after drawing starts: the words, the scene,
 * who is on it and whether it has a picture, with the book's look kept out of
 * reach of every page.
 *
 *   yarn check:pages
 *
 * Offline and deterministic: pure functions and prompt rendering only.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-pages");
const outFile = join(outDir, "invariants.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "page-invariants.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod"],
    // The page editor's design code imports its fonts' stylesheets; Node has no use for them.
    loader: { ".css": "empty" },
    // The app's state modules reach packages that load Node built-ins with require().
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: "warning",
  });
  console.log("Page editing invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
