/**
 * check-coupons.mjs — assert the coupon engine invariants hold.
 *
 *   yarn check:coupons
 *
 * Offline and deterministic: no Firestore, no Stripe, no credentials, no
 * network. It evaluates the SHIPPED coupon engine (`coupons.ts`) and the arrival
 * attribution it targets (`acquisition.ts`) across the restriction/cap/stacking
 * matrix, and fails on the properties that give away money quietly — a
 * restriction an unknown fact turns into a free pass, two offers stacking below
 * cost, a cap that doesn't bind at its boundary, a code alphabet a customer can
 * mistype into somebody else's discount, a public projection that ships every
 * unredeemed code to the browser.
 *
 * The checks are written in TypeScript (`coupon-invariants.ts`) and bundled with
 * esbuild here rather than reimplemented in plain JavaScript. Restating the
 * rules in the checker would let the checker pass while the code it's supposed
 * to protect was wrong, which is the one thing a check like this must not do.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "coupon-invariants.ts");

// Built inside the repo rather than in a temp directory: the bundle imports zod
// at runtime, and Node resolves that from the importing file's location.
const outDir = join(HERE, "..", "node_modules", ".cache", "childbooks-coupons");
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
  console.log("Coupon invariants\n");
  await import(pathToFileURL(outFile).href);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
