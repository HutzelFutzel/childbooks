/**
 * A stable fingerprint of everything that affects how a book renders.
 *
 * Rendering a book is the most expensive thing the app does, and it produces
 * an artifact worth keeping: the same inputs must always produce the same PDF,
 * so a second purchase of an unchanged book should reuse the first render
 * rather than re-rasterizing twenty-five pages on the buyer's laptop.
 *
 * Deliberately NOT `project.rev`, which increments on every save — renaming a
 * book or nudging one unrelated setting would throw the render away. This
 * hashes the render INPUTS: the words, the artwork each page currently points
 * at, the design overlay, and the physical format. Anything else about the
 * project can change freely without invalidating a good render.
 *
 * The hash is a cache key, never a security boundary: it's checked against
 * renders stored under the caller's own uid, so a collision could at worst
 * hand someone their own stale file.
 */
import { getCursor } from "../versioning";
import type { BookDesign, Project } from "../types";

/** Stable JSON: object keys sorted, so key order can't change the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * FNV-1a, 64-bit, over UTF-8 code units, as 16 hex characters.
 *
 * A non-cryptographic hash is the right tool: this runs synchronously during
 * render (SubtleCrypto is async and unavailable over plain HTTP), and 64 bits
 * is far more than enough to tell one user's own book versions apart.
 */
function fnv1a64(input: string): string {
  // Split into two 32-bit halves — JS bitwise ops are 32-bit, and BigInt here
  // would cost more than the hash itself.
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c & 0xff;
    h2 ^= (c >>> 8) & 0xff;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * The illustration each page would render right now: the version-tree cursor
 * plus the blob it points at. Both matter — reverting to an earlier version
 * changes the cursor, and a regenerated image changes the blob.
 */
function illustrationInputs(project: Project): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [pageId, tree] of Object.entries(project.illustrations ?? {})) {
    const node = getCursor(tree);
    out[pageId] = `${tree.cursorId}:${node.content.blobId}`;
  }
  return out;
}

/** Version tag, so a change to the renderer itself invalidates old renders. */
const RENDERER_VERSION = "2";

export function renderFingerprint(project: Project, design: BookDesign): string {
  const screenplay = project.screenplay ? getCursor(project.screenplay) : null;
  return fnv1a64(
    stableStringify({
      v: RENDERER_VERSION,
      title: project.title,
      // Only the fields that reach the page. Print tier, paper and finish are
      // chosen at checkout and change nothing about the rendered artwork.
      format: {
        sku: project.config.productSku ?? null,
        size: project.config.bookSize ?? null,
        layout: project.config.layoutId ?? null,
      },
      story: screenplay?.content ?? null,
      art: illustrationInputs(project),
      design,
    }),
  );
}
