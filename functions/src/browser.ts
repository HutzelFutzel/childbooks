/**
 * The browser the server renders books in.
 *
 * Rasterizing used to happen in the customer's browser, which made the product
 * depend on whose browser it was: the DOM had to be serialized into an SVG
 * `<foreignObject>` and drawn to a canvas, and WebKit refuses to load any
 * subresource inside an SVG image — so Safari produced books with every
 * illustration silently missing, no error anywhere. Rendering here means one
 * engine, the one we test against, painting pages the ordinary way.
 *
 * Two Chromes, same API. In the cloud it's `@sparticuz/chromium`, a build
 * packaged to run inside a serverless container (no system libraries, no
 * sandbox). Locally it's whatever Chrome the developer already has, because a
 * Linux binary won't run on their laptop and downloading a second Chrome to
 * every machine to render a test book is a poor trade.
 */
import puppeteer, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium";

/** Where a developer's Chrome usually lives, in the order we'd rather have it. */
const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** True when running under the Functions emulator rather than in the cloud. */
export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function localChromePath(): string | null {
  const configured = process.env.RENDER_CHROME_PATH;
  if (configured) return configured;
  // `require` rather than a top-level import: the cloud path never needs `fs`
  // to answer this, and the list is only meaningful on a developer machine.
  const fs = require("node:fs") as typeof import("node:fs");
  return LOCAL_CHROME_PATHS.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Start a browser for one render pass.
 *
 * Always closed by the caller — a leaked browser in a warm instance is a
 * few hundred MB that never comes back.
 */
export async function launchBrowser(): Promise<Browser> {
  const local = isEmulator() ? localChromePath() : process.env.RENDER_CHROME_PATH || null;
  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    });
  }

  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    // `chromium.args` carries what a container needs: no sandbox (there's no
    // user namespace to sandbox into), shared memory off /tmp, GPU disabled.
    args: [...chromium.args, "--font-render-hinting=none"],
    headless: true,
    defaultViewport: null,
  });
}
