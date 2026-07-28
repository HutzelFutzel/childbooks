/**
 * Client half of rendering: ask for a book, learn what's already made.
 *
 * A book is rendered once, on the server, and every document made from it —
 * the print interior, the wraparound cover, the digital edition — is assembled
 * from that one pass and kept. So buying an unchanged book a second time (a
 * gift, a reorder, a download after switching plans) costs a lookup rather
 * than another render, and every edition of that book is byte-identical.
 *
 * The cache is addressed by content fingerprint, so it invalidates itself: any
 * edit that changes what the pages look like changes the key.
 */
import { backendFetch } from "./backend";

export interface RenderAvailability {
  ebook: boolean;
  interior: boolean;
  /** Document keys of cached covers — a cover varies by SKU and page count. */
  covers: string[];
  hasCoverPanels: boolean;
  interiorPageCount: number | null;
}

const MISSING: RenderAvailability = {
  ebook: false,
  interior: false,
  covers: [],
  hasCoverPanels: false,
  interiorPageCount: null,
};

/** Cache key for a cover, which depends on the binding and the page count. */
export function coverDocumentKey(sku: string, pages: number): string {
  return `cover:${sku}:${pages}`;
}

/**
 * What's already rendered for this fingerprint.
 *
 * Never throws: a cache that can't be reached is a cache miss, and a miss just
 * means rendering locally the way we always did.
 */
export async function fetchRenderAvailability(fingerprint: string): Promise<RenderAvailability> {
  try {
    const res = await backendFetch(`/account/renders/${encodeURIComponent(fingerprint)}`);
    if (!res.ok) return MISSING;
    return (await res.json()) as RenderAvailability;
  } catch {
    return MISSING;
  }
}

/** How often to ask a running render how it's getting on. */
const POLL_MS = 1500;

/** Longer than any real book takes; past this something is wrong, not slow. */
const RENDER_WAIT_MS = 10 * 60_000;

/**
 * Have the server render this book, and follow it until it's finished.
 *
 * The rendering itself used to happen right here, in the buyer's browser, and
 * that made the book depend on which browser it was — Safari, unable to draw
 * images inside the SVG the rasterizer built, produced books with no
 * illustrations at all and no error to say so. Now one browser we control
 * renders every book, and the client's whole job is to ask and wait.
 */
export async function renderBook(input: {
  fingerprint: string;
  projectId: string;
  documents: AssembleRequest[];
  onProgress?: (step: string) => void;
}): Promise<void> {
  const start = await backendFetch(
    `/account/renders/${encodeURIComponent(input.fingerprint)}/render`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: input.projectId, documents: input.documents }),
    },
  );
  if (!start.ok) throw new Error(await errorMessage(start, "We couldn't start rendering your book."));
  const { jobId } = (await start.json()) as { jobId: string };

  const deadline = Date.now() + RENDER_WAIT_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (Date.now() > deadline) throw new Error("Rendering your book is taking too long.");

    const res = await backendFetch(`/account/render-jobs/${encodeURIComponent(jobId)}`);
    // A dropped poll is not a failed render: keep watching until the deadline.
    if (!res.ok) continue;
    const job = (await res.json()) as {
      status: "pending" | "running" | "done" | "error";
      step: string;
      error: string | null;
    };
    if (job.step) input.onProgress?.(job.step);
    if (job.status === "done") return;
    if (job.status === "error") throw new Error(job.error ?? "We couldn't render your book.");
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  return (
    (await res
      .json()
      .then((body: { error?: { message?: string } }) => body?.error?.message)
      .catch(() => undefined)) ?? fallback
  );
}

export interface AssembleRequest {
  kind: "ebook" | "interior" | "cover";
  /** Interior + cover: the page count the order is priced and bound at. */
  padToPages?: number;
  sku?: string;
  cover?: { widthIn: number; heightIn: number; panelWidthIn: number };
}
