"use client";

import { useEffect } from "react";
import { backendUrl } from "../../platform/backend";

/**
 * Cookieless, first-party analytics beacon for a single article. Mounted on the
 * article page; renders nothing.
 *
 * It stores NOTHING on the device (no cookies / localStorage), so it needs no
 * consent banner. It fires three tiny `text/plain` beacons (a CORS-simple
 * request → no preflight) to the tokenless backend `/blog-track`:
 *   - `view` once on load (with coarse locale/timezone + referrer for the
 *     backend to derive country + channel; the raw IP is never stored),
 *   - `read` once when the tab is hidden/closed, carrying the deepest scroll
 *     bucket reached (25/50/75/100 %),
 *   - `cta`  whenever a link into the studio is clicked.
 *
 * The backend turns these into anonymous per-post aggregates only.
 */
export function BlogAnalytics({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug || typeof window === "undefined") return;

    const endpoint = backendUrl("/blog-track");
    const params = new URLSearchParams(window.location.search);
    const base = {
      slug,
      locale: navigator.language || "",
      tz: (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        } catch {
          return "";
        }
      })(),
    };

    const send = (payload: Record<string, unknown>) => {
      try {
        const body = JSON.stringify(payload);
        // text/plain keeps sendBeacon a CORS-simple request (no preflight).
        const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
        if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(endpoint, blob)) {
          return;
        }
        void fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Never let analytics break the page.
      }
    };

    // View — include acquisition context.
    send({
      ...base,
      type: "view",
      referrer: document.referrer || "",
      utmMedium: params.get("utm_medium") || "",
    });

    // Read depth — track the deepest bucket, report once when leaving.
    const thresholds = [25, 50, 75, 100];
    let maxBucket = 0;
    const measure = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const pct = scrollable <= 0 ? 100 : Math.min(100, Math.round((window.scrollY / scrollable) * 100));
      for (const t of thresholds) if (pct >= t && t > maxBucket) maxBucket = t;
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });

    let readSent = false;
    const flushRead = () => {
      if (readSent || maxBucket <= 0) return;
      readSent = true;
      send({ ...base, type: "read", bucket: maxBucket });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushRead();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushRead);

    // CTA — any click on a link into the studio (nav, in-body, or the CTA band).
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      const anchor = el?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (/\/studio(\/|$|\?|#)/.test(href) || href === "/studio") {
        send({ ...base, type: "cta", target: href.slice(0, 200) });
      }
    };
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("scroll", measure);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushRead);
      document.removeEventListener("click", onClick, true);
      flushRead();
    };
  }, [slug]);

  return null;
}
