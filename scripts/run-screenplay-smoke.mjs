/**
 * run-screenplay-smoke.mjs — bundles scripts/screenplay-smoke.ts and runs it.
 *
 *   yarn smoke:screenplay [--case <name>] [--no-review] [--dry] [--model <id>]
 *
 * Live: it calls the real model with the key from OPENAI_API_KEY or
 * functions/.env.local. Not part of the checks that run in CI.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "node_modules", ".cache", "childbooks-screenplay-smoke");
const outFile = join(outDir, "smoke.mjs");
mkdirSync(outDir, { recursive: true });

let code = 1;
try {
  await build({
    entryPoints: [join(here, "screenplay-smoke.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["zod"],
    logLevel: "warning",
  });
  code = spawnSync(process.execPath, [outFile, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
process.exitCode = code;
