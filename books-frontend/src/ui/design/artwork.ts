/**
 * Resolving a book's artwork ahead of a render pass.
 *
 * Every export used to let each page fetch its own illustration after the
 * render stage had already mounted, then start snapshotting — so the capture
 * loop raced twenty-five downloads and won, producing white pages with the
 * text still on them. Artwork is now fully in hand before anything mounts, and
 * the caller can show honest progress while it loads.
 */
import { getBlob } from "../../state/blobs";
import type { ResolvedArtwork } from "./PrintBook";

export interface LoadedArtwork {
  artwork: ResolvedArtwork;
  /** Revoke every object URL created for this pass. */
  dispose: () => void;
}

/** How many blobs to fetch at once. Enough to be quick, few enough to be kind. */
const FETCH_CONCURRENCY = 6;

/**
 * Fetch every blob and turn it into an object URL.
 *
 * A blob that can't be fetched is FATAL, not skipped. Skipping is how the blank
 * pages got out: an illustration that quietly failed to load left a page with
 * nothing on it, and every check downstream agreed the page was supposed to
 * look like that. If the artwork isn't here, the book isn't ready to sell, and
 * saying so is the only honest option.
 */
export async function loadArtwork(
  blobIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<LoadedArtwork> {
  const artwork: ResolvedArtwork = {};
  const urls: string[] = [];
  let done = 0;

  const dispose = () => {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.length = 0;
  };

  const queue = [...blobIds];
  async function worker(): Promise<void> {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      const blob = await getBlob(id);
      if (!blob) throw new Error("One of this book's illustrations is missing.");
      const url = URL.createObjectURL(blob);
      urls.push(url);
      artwork[id] = url;
      done += 1;
      onProgress?.(done, blobIds.length);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, () => worker()),
    );
  } catch (err) {
    dispose();
    throw new Error(
      err instanceof Error && err.message.includes("missing")
        ? err.message
        : "We couldn't load this book's illustrations. Please check your connection and try again.",
    );
  }

  return { artwork, dispose };
}

export interface SpineColors {
  background: string;
  text: string;
}

const DEFAULT_SPINE: SpineColors = { background: "#e8e2d6", text: "#1f2933" };

/**
 * Pick spine colours from the front cover.
 *
 * The band should look like it belongs to the book, so the fill is the average
 * of the cover's own artwork; the title then takes whichever of near-black or
 * near-white actually reads against it, rather than a fixed dark that vanishes
 * on a dark cover.
 */
export async function spineColorsFrom(url: string | undefined): Promise<SpineColors> {
  if (!url) return DEFAULT_SPINE;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("cover not decodable"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return DEFAULT_SPINE;
    ctx.drawImage(img, 0, 0, 8, 8);
    const { data } = ctx.getImageData(0, 0, 8, 8);
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    r = Math.round(r / n);
    g = Math.round(g / n);
    b = Math.round(b / n);
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return {
      background: `rgb(${r}, ${g}, ${b})`,
      text: luma > 0.55 ? "#1f2933" : "#ffffff",
    };
  } catch {
    return DEFAULT_SPINE;
  }
}
