/**
 * Retention for `print-assets/`: the hosted interior and cover PDFs.
 *
 * Every order uploads (or re-uses) two PDFs there, and nothing ever removed
 * them — the largest objects the product creates, growing without bound. They
 * do need to outlive the order: the printer fetches them minutes after payment,
 * a reprint or dispute can need the exact files months later, and a customer
 * reordering an unchanged book re-uses them.
 *
 * The rule is therefore deliberately blunt and slow:
 *
 *   - nothing younger than {@link RETENTION_DAYS} is ever touched. That is well
 *     past production + shipping + the 90-day window in which an order can still
 *     be disputed or reprinted;
 *   - anything an order that is STILL OPEN points at is kept regardless of age;
 *   - everything else is deleted. A cached render whose file went away is
 *     simply a miss: the availability check re-verifies objects, and the next
 *     order re-assembles from the retained page rasters.
 *
 * Bounded per run so a large backlog drains over days instead of timing out.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getStorage } from "firebase-admin/storage";
import { ensureAdmin, storageBucketName } from "./storage";
import { ALL_SECRETS } from "./secrets";
import { getAdminPayment } from "./payments";
import { listOpenOrders } from "./printOrders";

/** 90 days after an order is final, plus the time it takes to get there. */
export const RETENTION_DAYS = 180;
const MAX_DELETES_PER_RUN = 500;
const PREFIX = "print-assets/";

/**
 * Only PRINT files are ever removed. Ebook PDFs share the prefix but belong to
 * a purchase the customer can re-download indefinitely, so they are never
 * candidates; the allowlist (rather than an ebook denylist) means a new kind of
 * file added under this prefix is kept until someone decides otherwise.
 */
export function isPrintFile(objectPath: string): boolean {
  return /-(interior|cover)\.(pdf|png)$/.test(objectPath);
}

/** The object path inside a Firebase Storage download URL (`…/o/<encoded>?…`). */
export function objectPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/o\/([^?]+)/.exec(url);
  if (!match) return null;
  try {
    const path = decodeURIComponent(match[1]);
    return path.startsWith(PREFIX) ? path : null;
  } catch {
    return null;
  }
}

/** Paths of files that orders still in flight depend on. */
async function pathsInUse(): Promise<Set<string>> {
  const keep = new Set<string>();
  for (const order of await listOpenOrders()) {
    if (!order.paymentId) continue;
    const payment = await getAdminPayment(order.paymentId).catch(() => null);
    for (const url of [payment?.fulfillment?.sourceFileUrls?.interior, payment?.fulfillment?.sourceFileUrls?.cover]) {
      const path = objectPathFromUrl(url ?? null);
      if (path) keep.add(path);
    }
  }
  return keep;
}

export async function cleanupPrintAssets(now = Date.now()): Promise<{ scanned: number; deleted: number }> {
  ensureAdmin();
  const bucket = getStorage().bucket(storageBucketName());
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  const keep = await pathsInUse();

  let scanned = 0;
  let deleted = 0;
  let pageToken: string | undefined;
  do {
    const [files, next] = (await bucket.getFiles({
      prefix: PREFIX,
      maxResults: 500,
      autoPaginate: false,
      ...(pageToken ? { pageToken } : {}),
    })) as unknown as [Array<{ name: string; metadata: { timeCreated?: string }; delete: () => Promise<unknown> }>, { pageToken?: string } | null];
    for (const file of files) {
      scanned++;
      if (deleted >= MAX_DELETES_PER_RUN) break;
      const created = Date.parse(file.metadata.timeCreated ?? "");
      if (!Number.isFinite(created) || created > cutoff) continue;
      if (!isPrintFile(file.name) || keep.has(file.name)) continue;
      try {
        await file.delete();
        deleted++;
      } catch (err) {
        logger.warn(`[print-assets] couldn't delete ${file.name}`, err);
      }
    }
    pageToken = next?.pageToken;
  } while (pageToken && deleted < MAX_DELETES_PER_RUN);
  return { scanned, deleted };
}

export const cleanupPrintAssetsJob = onSchedule(
  { schedule: "every day 05:10", timeZone: "UTC", memory: "512MiB", timeoutSeconds: 540, secrets: ALL_SECRETS },
  async () => {
    try {
      const { scanned, deleted } = await cleanupPrintAssets();
      if (deleted > 0) logger.info(`[print-assets] removed ${deleted} of ${scanned} scanned files past retention`);
    } catch (err) {
      logger.error("[print-assets] cleanup failed", err);
    }
  },
);
