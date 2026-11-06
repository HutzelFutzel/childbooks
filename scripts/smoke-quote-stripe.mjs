/**
 * smoke-quote-stripe.mjs — ask Stripe's sandbox to price the session shapes `/checkout` sends, and fail
 * if its totals are not the quote's. Manual (needs a test key and the network); see smoke-quote-stripe.ts.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-quote-smoke");
const outFile = join(outDir, "smoke.mjs");
mkdirSync(outDir, { recursive: true });

try {
  await build({
    entryPoints: [join(here, "smoke-quote-stripe.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["stripe"],
    define: { "import.meta.url": JSON.stringify(pathToFileURL(join(here, "smoke-quote-stripe.ts")).href) },
    logLevel: "warning",
  });
  await import(pathToFileURL(outFile).href);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
