"use client";

import { useEffect, useRef } from "react";
import { backendFetch } from "../../platform/backend";
import { browserGeoHints } from "../../core/analytics/geoHints";
import { useAuthStore } from "../../state/authStore";
import { useConsentStore } from "../../state/consentStore";

/**
 * First-party session + device beacon. Mounted once inside the studio shell;
 * renders nothing.
 *
 * WHAT IT SENDS, AND WHY THAT'S THE SHORT LIST
 * -------------------------------------------
 * Only the things the server genuinely cannot see for itself: the browser locale
 * and timezone (which the backend turns into a market, exactly as the blog beacon
 * does) and — with analytics consent only — the viewport width.
 *
 * Everything about the DEVICE is deliberately absent. The form factor, OS and
 * browser are parsed on the backend from the request's own `User-Agent` and
 * low-entropy client-hint headers, which the browser attaches to this request
 * anyway. That's not an optimization, it's the design: a device dimension the
 * client asserts is a dimension the measured party can misreport, and "which
 * device do buyers actually use" is not a question worth answering from a field
 * its own subject can set.
 *
 * WHY IT NEEDS NO CONSENT (except the viewport)
 * --------------------------------------------
 * Nothing is stored on the device. No cookie, no `localStorage`, no session id —
 * sessions are derived server-side from the gap between pings (see
 * `functions/src/deviceStats.ts`), so there's nothing to read from or write to
 * the terminal equipment and ePrivacy Art 5(3) doesn't bite. The identity is the
 * Firebase uid the request is already authenticated with, so no new linkage is
 * created either. The viewport is the exception — it's read from the DOM rather
 * than volunteered by the browser — so it's gated on analytics consent and every
 * other number here works without it.
 *
 * Guests are included on purpose: they're the top of the funnel, and a device mix
 * measured only over people who already signed up would describe the outcome
 * rather than the audience.
 */

/**
 * Heartbeat interval. Comfortably inside the backend's 30-minute session gap, so
 * an open tab that's being used stays ONE session instead of fragmenting into
 * several — while the backend's own write floor keeps the cost of that at a
 * couple of document merges an hour.
 */
const HEARTBEAT_MS = 10 * 60 * 1000;

/** Client-side floor, so a burst of focus/blur events can't fan out to requests. */
const MIN_INTERVAL_MS = 60 * 1000;

export function SessionTracker() {
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const analyticsConsent = useConsentStore((s) => s.analytics);

  // Held in a ref so the effect below doesn't re-subscribe (and re-ping) every
  // time consent flips — the value is only read at send time.
  const consentRef = useRef(analyticsConsent);
  consentRef.current = analyticsConsent;

  useEffect(() => {
    if (!uid || typeof window === "undefined") return;

    let lastSent = 0;
    let cancelled = false;

    const send = () => {
      const now = Date.now();
      if (cancelled || now - lastSent < MIN_INTERVAL_MS) return;
      lastSent = now;
      void backendFetch("/session/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...browserGeoHints(),
          ...(consentRef.current ? { viewport: window.innerWidth } : {}),
        }),
        keepalive: true,
      }).catch(() => {
        // Analytics must never surface as an error to the person using the app.
      });
    };

    send();
    const timer = window.setInterval(() => {
      // A backgrounded tab isn't a session in progress; pinging one would turn
      // "left it open overnight" into engagement.
      if (document.visibilityState === "visible") send();
    }, HEARTBEAT_MS);
    // Coming back to the tab is the signal that a new session may have started
    // (the backend decides, from the gap). The client just reports being here.
    const onVisible = () => {
      if (document.visibilityState === "visible") send();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [uid]);

  return null;
}
