/**
 * Client half of arrival attribution.
 *
 * Same two-part shape the referral flow already uses, and for the same reason:
 * someone lands from a QR poster, and the account they'll be attributed to may
 * not exist for another two sessions. So the arrival is parked in localStorage
 * and offered to the backend on every identity change until the backend confirms
 * it recorded — clearing it on the first attempt would quietly lose attribution
 * for everyone who signs up on a second visit.
 *
 * The one difference from referrals: an arrival is worth REPLAYING even after
 * it's been recorded once, because a coupon whose audience was edited to include
 * a QR id should reach the people who already scanned it. So the token is kept
 * (not deleted) and re-offered at most once per session — the server's
 * `create`-based grant is what makes that idempotent.
 */
import { backendFetch } from "./backend";
import type { ArrivalKind, ArrivalProposal } from "../core/profile/acquisition";

const PENDING_KEY = "pendingArrival";
const REPLAYED_KEY = "arrivalReplayed";

/**
 * Read an arrival out of a landing URL.
 *
 * `?qr=` is what `/q/{id}` appends after resolving a scan. The UTM triple is
 * recognized too, so an ordinary campaign link is attributable without anyone
 * having to mint a QR code for it — which is what stops the coupon audience
 * from being QR-only in practice.
 *
 * Returns null for a plain visit. `?ref=` and `?via=` are deliberately NOT read
 * here: those already have their own programs, and recording them twice would
 * double-count the acquisition.
 */
export function arrivalFromUrl(search: string, pathname = "/"): ArrivalProposal | null {
  const params = new URLSearchParams(search);
  const qr = params.get("qr");
  const utmSource = params.get("utm_source");
  const utmCampaign = params.get("utm_campaign");

  let kind: ArrivalKind | null = null;
  let id = "";
  if (qr) {
    kind = "qr";
    id = qr;
  } else if (params.get("lt")) {
    // A generic tracked link, for anything that isn't a QR code and isn't a UTM.
    kind = "link";
    id = params.get("lt") ?? "";
  } else if (utmSource || utmCampaign) {
    kind = "utm";
    // The id is derived server-side from source/campaign when it's absent, so a
    // bare `?utm_source=newsletter` still attributes.
    id = "";
  }
  if (!kind) return null;

  return {
    kind,
    id,
    source: utmSource ?? undefined,
    medium: params.get("utm_medium") ?? undefined,
    campaign: utmCampaign ?? undefined,
    landingPath: pathname,
    referrer: typeof document !== "undefined" ? document.referrer || undefined : undefined,
    at: Date.now(),
  };
}

/** Park an arrival until there's an identity to attach it to. */
export function rememberArrival(proposal: ArrivalProposal): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(proposal));
    // A fresh arrival is always worth replaying, even if an older one already
    // was: this is a new scan, not a repeat of the parked one.
    sessionStorage.removeItem(REPLAYED_KEY);
  } catch {
    /* storage unavailable — the scan just isn't attributed */
  }
}

export function pendingArrival(): ArrivalProposal | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ArrivalProposal;
    return parsed && typeof parsed.kind === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Capture an arrival from the current URL, if there is one.
 *
 * Returns true when something was parked, so the caller can strip the parameter
 * from the address bar — a tracking parameter that survives into a shared link
 * would attribute the recipient to the sharer's poster.
 */
export function captureArrival(): boolean {
  if (typeof window === "undefined") return false;
  const proposal = arrivalFromUrl(window.location.search, window.location.pathname);
  if (!proposal) return false;
  rememberArrival(proposal);
  return true;
}

/**
 * Offer the parked arrival to the backend for the current identity.
 *
 * Returns the coupons it earned them, if any, so the caller can say so out loud.
 * At most once per session: the grant is idempotent server-side, but there's no
 * value in a write per page view.
 */
export async function claimPendingArrival(): Promise<{ couponId: string; summary: string }[]> {
  const proposal = pendingArrival();
  if (!proposal) return [];
  try {
    if (sessionStorage.getItem(REPLAYED_KEY) === "1") return [];
  } catch {
    /* no session storage — fall through and just send it */
  }
  try {
    const res = await backendFetch("/account/arrival", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proposal),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      recorded?: boolean;
      granted?: { couponId: string; summary: string }[];
    };
    // Marked replayed only on a real answer. A network blip leaves it parked for
    // the next identity change, which is the whole point of parking it.
    try {
      sessionStorage.setItem(REPLAYED_KEY, "1");
    } catch {
      /* ignore */
    }
    return json.granted ?? [];
  } catch {
    return [];
  }
}
