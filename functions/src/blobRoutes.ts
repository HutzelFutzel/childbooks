/**
 * Backfilling the small display copies of pictures stored before copies existed.
 *
 * New pictures get their copies when they are written (`uploadBlob`). A book
 * drawn earlier has only the full-size master, so the studio, finding no copy,
 * shows the master and then asks here to make the copies, once. After that the
 * picture is cheap to open on every device. Nothing is migrated up front and
 * nothing waits on this: it is a favour to the next visit.
 *
 * Any signed-in identity may ask (guests draw books too), and only ever for
 * pictures in their own space — the uid comes from the session, never the body.
 */
import express, { type Express, type Response } from "express";
import { logger } from "firebase-functions/v2";
import { BLOB_ID_PATTERN } from "../../books-frontend/src/core/storage/blobVariants";
import type { AuthedRequest } from "./auth";
import { ensureAdmin, ensureBlobVariants } from "./storage";

/** A 24-page book plus its cast and a few versions fits comfortably. */
const MAX_IDS_PER_REQUEST = 48;

/** Pictures encoded at once: each is a few megabytes in memory while it runs. */
const CONCURRENCY = 4;

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(work));
  }
}

export function registerBlobRoutes(app: Express): void {
  const json = express.json({ limit: "64kb" });

  /**
   * Make the display copies of these pictures. Body: `{ ids: string[] }`.
   * Replies with the ids that now have copies; an id that is missing, or not a
   * picture, is left out rather than failing the rest.
   */
  app.post("/blobs/variants", json, async (req: AuthedRequest, res: Response) => {
    try {
      ensureAdmin();
      const uid = req.uid!;
      const raw = (req.body as { ids?: unknown } | undefined)?.ids;
      if (!Array.isArray(raw)) {
        res.status(400).json({ error: { message: "Say which pictures." } });
        return;
      }
      const ids = [
        ...new Set(raw.filter((id): id is string => typeof id === "string" && BLOB_ID_PATTERN.test(id))),
      ].slice(0, MAX_IDS_PER_REQUEST);

      const ready: string[] = [];
      await inBatches(ids, CONCURRENCY, async (id) => {
        try {
          if (await ensureBlobVariants(uid, id)) ready.push(id);
        } catch (err) {
          logger.warn("[blobs] backfill failed", { id, error: err instanceof Error ? err.message : String(err) });
        }
      });
      res.json({ ready });
    } catch (err) {
      logger.error("[blobs] backfill request failed", err);
      res.status(500).json({ error: { message: "We couldn't prepare those pictures." } });
    }
  });
}
