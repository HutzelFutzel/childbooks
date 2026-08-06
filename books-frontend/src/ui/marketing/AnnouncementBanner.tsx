"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { X, Clock } from "lucide-react";
import { useAuthStore } from "../../state/authStore";
import { useConsentStore } from "../../state/consentStore";
import {
  eligibleAnnouncements,
  formatCountdown,
  isAnnouncementActionLink,
  remainingMs,
  type Announcement,
  type AnnouncementsConfig,
  type AnnouncementTone,
} from "../../core/config/announcements";

function dismissedKey(id: string): string {
  return `childbooks:announcement:dismissed:${id}`;
}

/** `frequency: "always"` never checks/writes storage — always re-shown. */
function isDismissedInStorage(a: Announcement): boolean {
  if (typeof window === "undefined" || a.frequency === "always") return false;
  try {
    const store = a.frequency === "once" ? window.localStorage : window.sessionStorage;
    return store.getItem(dismissedKey(a.id)) === "1";
  } catch {
    return false;
  }
}

function markDismissedInStorage(a: Announcement): void {
  if (typeof window === "undefined" || a.frequency === "always") return;
  try {
    const store = a.frequency === "once" ? window.localStorage : window.sessionStorage;
    store.setItem(dismissedKey(a.id), "1");
  } catch {
    // Storage full/unavailable (private browsing) — it just won't be remembered.
  }
}

/** Solid-background treatment per tone — every placement renders on a solid
 *  colored surface, so text/CTA contrast stays consistent across all three. */
const TONE_STYLES: Record<AnnouncementTone, { solid: string; ctaSolid: string }> = {
  brand: {
    solid: "bg-brand-600 text-white",
    ctaSolid: "bg-white text-brand-700 hover:bg-brand-50",
  },
  amber: {
    solid: "bg-amber-500 text-white",
    ctaSolid: "bg-white text-amber-700 hover:bg-amber-50",
  },
  rose: {
    solid: "bg-rose-600 text-white",
    ctaSolid: "bg-white text-rose-700 hover:bg-rose-50",
  },
  magic: {
    solid: "bg-gradient-to-r from-magic-500 to-magic-700 text-white",
    ctaSolid: "bg-white text-magic-700 hover:bg-magic-50",
  },
  ink: {
    solid: "bg-ink-900 text-white",
    ctaSolid: "bg-white text-ink-900 hover:bg-ink-100",
  },
};

/** Runs the client-side dialog an `action:*` link maps to (see
 *  `ANNOUNCEMENT_LINK_PRESETS` in `core/config/announcements.ts`). These
 *  aren't real routes — this app is guest-first (no `/signup` page) and
 *  cookie preferences are a dialog, not a page — so the button dispatches a
 *  store action instead of navigating. */
function runAnnouncementAction(url: string): void {
  switch (url) {
    case "action:signup":
      useAuthStore.getState().openAuthDialog();
      return;
    case "action:cookie-prefs":
      useConsentStore.getState().openPreferences();
      return;
    default:
      // Unknown action id (e.g. a stale preset from an older app version) —
      // no-op rather than navigating to a broken "action:..." URL.
      return;
  }
}

/** Renders a CTA/secondary link as a real `<a>`, or — when `url` is an
 *  `action:` link — as a `<button>` that runs {@link runAnnouncementAction}
 *  instead. Keeps that branching in one place for both buttons. */
function AnnouncementLink({ url, className, children }: { url: string; className: string; children: ReactNode }) {
  if (isAnnouncementActionLink(url)) {
    return (
      <button type="button" onClick={() => runAnnouncementAction(url)} className={className}>
        {children}
      </button>
    );
  }
  return (
    <a href={url || "#"} className={className}>
      {children}
    </a>
  );
}

/**
 * The banner's actual visual content (copy, CTA, countdown, dismiss), with NO
 * positioning of its own — a plain block for "bar" (fill whatever container
 * it's given), a natural-width rounded card/pill otherwise. Deliberately
 * position-agnostic so it can be reused two ways from the exact same markup:
 * wrapped in a `fixed` shell for the real site banner ({@link AnnouncementBanner}
 * below), or dropped into a static preview frame in the admin editor
 * (`ui/admin/tabs/marketing/AnnouncementsTab.tsx`) — what the admin sees while
 * editing is pixel-for-pixel what visitors get, not an approximation.
 */
export function AnnouncementCard({
  announcement: a,
  now,
  onDismiss,
}: {
  announcement: Announcement;
  now: number;
  onDismiss?: () => void;
}) {
  const tone = TONE_STYLES[a.tone];
  const ms = a.showCountdown ? remainingMs(a, now) : null;

  const cta = a.ctaLabel.trim() ? (
    <AnnouncementLink
      url={a.ctaUrl}
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm transition ${tone.ctaSolid}`}
    >
      {a.ctaLabel}
    </AnnouncementLink>
  ) : null;

  const secondary = a.secondaryLabel.trim() ? (
    <AnnouncementLink
      url={a.secondaryUrl}
      className="shrink-0 text-xs font-medium underline-offset-2 opacity-80 hover:underline"
    >
      {a.secondaryLabel}
    </AnnouncementLink>
  ) : null;

  const countdown =
    ms != null ? (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
        <Clock className="size-3" />
        {formatCountdown(ms)}
      </span>
    ) : null;

  const closeBtn = a.dismissible ? (
    <button
      type="button"
      onClick={onDismiss}
      title="Dismiss"
      className="shrink-0 rounded-full p-1 opacity-70 transition hover:bg-black/10 hover:opacity-100"
    >
      <X className="size-3.5" />
    </button>
  ) : null;

  if (a.placement === "floating") {
    return (
      <div className={`w-80 max-w-full space-y-2 rounded-2xl p-4 shadow-xl ${tone.solid}`}>
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">
            {a.emoji && <span className="mr-1.5">{a.emoji}</span>}
            {a.message || "Your announcement message"}
          </p>
          {closeBtn}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cta}
          {countdown}
          {secondary}
        </div>
      </div>
    );
  }

  if (a.placement === "pill") {
    return (
      <div className={`inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-2 shadow-lg ${tone.solid}`}>
        {a.emoji && <span className="shrink-0 text-sm">{a.emoji}</span>}
        <span className="truncate text-xs font-semibold">{a.message || "Your announcement message"}</span>
        {countdown}
        {cta}
        {closeBtn}
      </div>
    );
  }

  // "bar" — full-width strip.
  return (
    <div className={`w-full ${tone.solid}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-center sm:px-6">
        <span className="text-sm font-semibold leading-snug">
          {a.emoji && <span className="mr-1.5">{a.emoji}</span>}
          {a.message || "Your announcement message"}
        </span>
        {countdown}
        {cta}
        {secondary}
        {closeBtn && <span className="ml-1">{closeBtn}</span>}
      </div>
    </div>
  );
}

/** Fixed-position shell per placement — where {@link AnnouncementCard} actually
 *  sits on the real site. Kept separate from the card so the admin preview
 *  can render the same card without escaping its own layout via `fixed`. */
function PositionedCard({ announcement: a, now, onDismiss }: { announcement: Announcement; now: number; onDismiss: () => void }) {
  if (a.placement === "floating") {
    return (
      <div className="fixed inset-x-3 bottom-3 z-40 flex justify-end sm:inset-x-auto sm:right-5 sm:bottom-5">
        <AnnouncementCard announcement={a} now={now} onDismiss={onDismiss} />
      </div>
    );
  }
  if (a.placement === "pill") {
    return (
      <div className="fixed inset-x-3 bottom-4 z-40 flex justify-center sm:inset-x-auto sm:left-4 sm:justify-start">
        <AnnouncementCard announcement={a} now={now} onDismiss={onDismiss} />
      </div>
    );
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-40">
      <AnnouncementCard announcement={a} now={now} onDismiss={onDismiss} />
    </div>
  );
}

/**
 * Renders the single highest-priority announcement banner currently live and
 * eligible for this visitor (see `core/config/announcements.ts` for the
 * schedule/audience rules). Mounted once near the root so it's available on
 * every marketing page.
 *
 * `config` is fetched once server-side (see `server/announcements.ts`,
 * mirroring the SEO/cookie config readers) — an admin edit takes effect on the
 * visitor's next page load, not live mid-session (same tradeoff as SEO/legal).
 * Dismissal is remembered per banner id in session/local storage depending on
 * `frequency`; a dismissed top banner falls through to the next-highest-
 * priority eligible one instead of just disappearing entirely.
 */
export function AnnouncementBanner({ config }: { config: AnnouncementsConfig }) {
  // Mounted once in the root layout so every marketing route gets it for
  // free, but the Studio/Admin/internal-render shells are full-screen app
  // tools, not marketing pages — a "Summer sale" strip has no business
  // covering an admin's own dashboard or a book-render worker page.
  const pathname = usePathname();
  const isAppShell =
    pathname?.startsWith("/studio") || pathname?.startsWith("/admin") || pathname?.startsWith("/internal");
  const hasAny = config.banners.length > 0 && !isAppShell;
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const authResolved = accessLevel !== "loading";
  const isSignedIn = accessLevel === "full" || accessLevel === "unverified";

  // Ticks once a second — drives both re-evaluating the schedule window (so a
  // banner appears/disappears without a reload if the tab is left open across
  // its start/end time) and the optional live countdown text.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasAny) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasAny]);

  const candidates = useMemo(() => {
    if (!hasAny) return [];
    const all = eligibleAnnouncements(config, { now, isSignedIn });
    // Don't flash an audience-restricted banner before we actually know
    // whether this visitor is signed in — "everyone" banners are safe either way.
    return authResolved ? all : all.filter((a) => a.audience === "everyone");
  }, [config, now, isSignedIn, authResolved, hasAny]);

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  // Seed from storage the first time each candidate is seen (cheap — at most a
  // handful of banners) rather than re-reading storage on every tick.
  const seededRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let changed = false;
    const next = new Set(dismissedIds);
    for (const a of candidates) {
      if (seededRef.current.has(a.id)) continue;
      seededRef.current.add(a.id);
      if (isDismissedInStorage(a)) {
        next.add(a.id);
        changed = true;
      }
    }
    if (changed) setDismissedIds(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const active = candidates.find((a) => !dismissedIds.has(a.id)) ?? null;

  const dismiss = (a: Announcement) => {
    markDismissedInStorage(a);
    setDismissedIds((prev) => new Set(prev).add(a.id));
  };

  if (!active) return null;
  return <PositionedCard key={active.id} announcement={active} now={now} onDismiss={() => dismiss(active)} />;
}
