"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  initClientLogger,
  recordBreadcrumb,
} from "../../platform/clientLogger";

/**
 * Mounts once at the root layout to attach global browser error/rejection
 * listeners and record route-change breadcrumbs into the in-memory ring buffer.
 * Renders nothing.
 */
export function ClientLogInit() {
  const pathname = usePathname();

  useEffect(() => {
    initClientLogger();
  }, []);

  useEffect(() => {
    if (pathname) {
      recordBreadcrumb("route", "navigate", pathname);
    }
  }, [pathname]);

  return null;
}
