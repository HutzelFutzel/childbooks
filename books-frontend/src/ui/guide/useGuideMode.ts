/**
 * The resolved flow for the reader in front of us.
 *
 * A thin hook over {@link resolveGuideMode}: it gathers the four inputs from the
 * places they live and leaves every decision to the pure function, so the rule
 * exists once and is testable without React (see `scripts/guide-invariants.ts`).
 *
 * `bookId` is the bucket key for a percentage rollout, so a reader's existing
 * books keep the flow they were started in while a new one can join the ramp.
 */
"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { parseGuideOverride, resolveGuideMode, type GuideMode } from "../../core/guide/mode";
import {
  resolveGuidePlaylist,
  type ResolvedGuideComponent,
} from "../../core/guide/playlist";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import { hydrateGuidePreference, useGuidePreference } from "./guidePreference";

export function useGuideMode(bookId?: string | null): GuideMode {
  const rollout = useAppConfigStore((s) => s.guide.rollout);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const preference = useGuidePreference((s) => s.preference);
  const setPreference = useGuidePreference((s) => s.set);
  const params = useSearchParams();
  const override = parseGuideOverride(params?.get("guide"));

  // After mount, so the first client render matches the server's.
  useEffect(hydrateGuidePreference, []);

  // `?guide=new` records the choice rather than just applying it. The studio
  // rewrites its own path as the reader moves, so an override that lived only in
  // the URL would last exactly one navigation — which is no use for authoring a
  // whole book. Admins only: for anyone else the preference is ignored downstream,
  // so writing it would be storage that does nothing.
  useEffect(() => {
    if (isAdmin && override && override !== preference) setPreference(override);
  }, [isAdmin, override, preference, setPreference]);

  return resolveGuideMode({
    rollout,
    isAdmin,
    preference,
    override,
    bucketKey: bookId ?? null,
  });
}

/**
 * The components the guide will run for this reader, or null when they're on the
 * wizard. Null is the flag every consumer branches on, so "am I in the new flow"
 * and "what does it want next" are answered by the same value and can't disagree.
 */
export function useGuidePlaylist(bookId?: string | null): ResolvedGuideComponent[] | null {
  const mode = useGuideMode(bookId);
  const playlist = useAppConfigStore((s) => s.guide.playlist);
  return useMemo(
    () => (mode === "guide" ? resolveGuidePlaylist(playlist) : null),
    [mode, playlist],
  );
}

/**
 * Whether the reader is in the new flow, without subscribing to anything that
 * changes per route. For non-React callers, read the same inputs from the stores.
 */
export function guideModeNow(bookId?: string | null): GuideMode {
  return resolveGuideMode({
    rollout: useAppConfigStore.getState().guide.rollout,
    isAdmin: useAuthStore.getState().isAdmin,
    preference: useGuidePreference.getState().preference,
    bucketKey: bookId ?? null,
  });
}
