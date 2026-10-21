/**
 * Short-lived cache of the admin order scan (see `loadRecords` in
 * `printOrderAdmin.ts`).
 *
 * Lives in its own module so the middleware that invalidates it on admin writes
 * can be mounted ahead of EVERY `/admin/orders/*` route — the print-prep routes
 * are registered separately from the order routes and would otherwise slip past it.
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { PrintOrderRecord } from "../../books-frontend/src/core/orders/lifecycle";
import { createTtlCache } from "./ttlCache";

/**
 * The overview report and the list both need the same scan, and the dashboard
 * fires them together — so one scan serves both, and a reload within the window
 * costs nothing. Short on purpose: webhooks and the sweep change orders outside
 * this process. Admin writes invalidate it, and `?fresh=1` (the Refresh button)
 * skips it.
 */
export const RECORDS_TTL_MS = 15_000;
export const orderRecordsCache = createTtlCache<PrintOrderRecord[]>(RECORDS_TTL_MS, 1);

export function invalidateOrderRecords(): void {
  orderRecordsCache.invalidate();
}

/** Mount before the `/admin/orders` routes: any non-GET drops the cached scan once its response is out. */
export function registerOrderRecordsInvalidation(app: Express): void {
  app.use("/admin/orders", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.on("finish", invalidateOrderRecords);
    }
    next();
  });
}
