/**
 * Getting a laid-out page ready to be photographed.
 *
 * All that's left of the browser's half of rendering. Pages used to be
 * rasterized here too — serialized into an SVG image and drawn to a canvas by
 * `html-to-image` — which quietly depended on how each browser treats images
 * inside an SVG: WebKit refuses to load them, so Safari produced books with
 * every illustration missing and nothing to indicate it. Rendering moved to
 * headless Chrome on the server (`functions/src/renderJobs.ts`), which
 * photographs the DOM directly, and this file kept only the one thing that
 * still belongs in the page: knowing when it's finished loading.
 */

/**
 * Wait until web fonts are ready and every expected <img> inside `root` has
 * decoded.
 *
 * `expectedImages` is not optional padding — it's the entire point. The check
 * used to be "is every <img> in the tree loaded", which is trivially true when
 * the tree contains no images yet, and that is exactly the state the stage is
 * in for the first moments after it mounts. Every export therefore raced its
 * own artwork and cheerfully rasterized blank pages with the text on top.
 * Callers now resolve the artwork BEFORE mounting the stage and tell us how
 * many images must be present, so "not there yet" is distinguishable from
 * "there is nothing to wait for".
 *
 * Throws on timeout rather than proceeding: a page short of its illustration is
 * a book someone paid for and can't use, which is worse than a failed export.
 */
export async function waitForStageReady(
  root: HTMLElement,
  opts: { expectedImages: number; timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const start = Date.now();

  // Give lazily-imported @fontsource CSS a tick to register, then await fonts.
  await new Promise((r) => setTimeout(r, 250));
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* fonts API unavailable — best effort */
  }

  const decoded = () => {
    const imgs = Array.from(root.querySelectorAll("img"));
    const ready = imgs.filter((img) => img.complete && img.naturalWidth > 0);
    return { total: imgs.length, ready: ready.length };
  };

  for (;;) {
    const { total, ready } = decoded();
    if (total >= opts.expectedImages && ready === total) break;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `The book's artwork didn't finish loading (${ready} of ${opts.expectedImages} images ready). Please check your connection and try again.`,
      );
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  // Two animation frames so the final layout/paint is settled before snapshot.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
}
