import { build, context } from "esbuild";

// Bundle the backend into a single self-contained CommonJS file.
//
// We keep the heavy/native runtime dependencies (those declared in
// functions/package.json) external so they resolve from functions/node_modules
// at runtime, while everything else — relative imports from
// ../books-frontend/src/core AND pure-JS npm packages those modules pull in
// (e.g. the ESM-only `p-retry`) — gets bundled and transpiled to CJS. This
// avoids `ERR_REQUIRE_ESM` at runtime, which previously crashed the `api`
// function on load because a CJS bundle cannot `require()` an ESM-only package.
//
// NOTE: do not use `packages: "external"` here — it externalises ALL bare
// imports (including ESM-only ones), reintroducing the require-of-ESM crash.
//
// Pass `--watch` to rebuild on change; the Functions emulator reloads the new
// `lib/index.js` automatically, giving the backend live reload in dev.
const watch = process.argv.includes("--watch");

// Real runtime deps that must stay external (native modules + Firebase SDKs).
// These resolve from functions/node_modules at runtime.
const external = [
  "firebase-admin",
  "firebase-functions",
  "express",
  "sharp",
  "zod",
  "stripe",
  // The renderer's browser: `puppeteer-core` shells out to a Chrome binary and
  // `@sparticuz/chromium` IS one (a ~50MB payload it unpacks at runtime), so
  // both have to resolve from node_modules rather than be inlined here.
  "puppeteer-core",
  "@sparticuz/chromium",
  // The QR code styling renderer's DOM stand-in: jsdom ships a
  // `xhr-sync-worker.js` file its synchronous XMLHttpRequest path locates via
  // `require.resolve` at runtime relative to its own location in
  // node_modules — bundling it breaks that lookup (esbuild warns about this
  // exact pattern). Keeping it external also skips inlining its considerable
  // dependency tree (cssstyle, parse5, whatwg-url, …) into every cold start.
  "jsdom",
  // Pulls in `qrcode-generator` as its own dependency — external so that
  // stays out of the bundle too rather than needing to be listed here itself.
  "qr-code-styling",
];

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "lib/index.js",
  external,
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("esbuild: watching functions for changes…");
} else {
  await build(options);
}
