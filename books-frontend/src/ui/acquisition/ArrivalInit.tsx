"use client";

/**
 * Site-wide arrival capture + coupon claim.
 *
 * Studio used to be the only place that parked `?qr=` / `?lt=` / UTMs and
 * offered them to the backend. A tracked QR's destination is any page, so a
 * poster that lands on `/` or `/pricing` never granted its coupon. Mounted
 * next to `AuthInit` in the root layout.
 *
 * Capture also still runs in `StudioApp`, on purpose: that effect strips the
 * query string, and child effects fire before this one. Parking there first
 * is what stops a `/studio?qr=` landing from losing the token.
 */
import { useEffect } from "react";
import {
  captureArrival,
  claimPendingArrival,
  stripArrivalSearchParams,
} from "../../platform/acquisition";
import { useAuthStore } from "../../state/authStore";
import { notify } from "../lib/notify";

export function ArrivalInit() {
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const accessLevel = useAuthStore((s) => s.accessLevel);

  useEffect(() => {
    if (window.location.pathname.startsWith("/internal/")) return;
    if (!captureArrival()) return;
    const url = new URL(window.location.href);
    if (!stripArrivalSearchParams(url.searchParams)) return;
    const qs = url.searchParams.toString();
    window.history.replaceState(null, "", url.pathname + (qs ? `?${qs}` : "") + url.hash);
  }, []);

  useEffect(() => {
    if (window.location.pathname.startsWith("/internal/")) return;
    if (!uid || accessLevel !== "full") return;
    void claimPendingArrival().then((granted) => {
      const first = granted[0];
      if (!first) return;
      notify.success("A discount was added to your account", first.summary);
    });
  }, [uid, accessLevel]);

  return null;
}
