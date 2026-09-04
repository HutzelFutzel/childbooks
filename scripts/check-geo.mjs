/**
 * check-geo.mjs — assert the country-inference invariants hold.
 *
 *   yarn check:geo
 *
 * Offline and deterministic. Bundles the shipped `functions/src/geo.ts` rather
 * than restating the rules, so the checker cannot pass while the code that
 * stamps markets on signups is wrong.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "geo-invariants.ts");

const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-geo");
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
    // express is only pulled in because geo.ts also registers the HTTP route.
    external: ["express", "zod"],
    logLevel: "warning",
  });
  console.log("Geo invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
