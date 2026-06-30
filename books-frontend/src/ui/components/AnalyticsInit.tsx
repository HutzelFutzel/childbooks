"use client";
import { useEffect } from "react";
import { initAnalytics } from "../../lib/firebase";

/**
 * Initializes Google Analytics for Firebase on the client. Rendered once in the
 * root layout so it covers every route. No-ops during SSR, against the
 * emulators, or when no measurement id is configured (see `initAnalytics`).
 */
export function AnalyticsInit() {
  useEffect(() => {
    void initAnalytics();
  }, []);
  return null;
}
