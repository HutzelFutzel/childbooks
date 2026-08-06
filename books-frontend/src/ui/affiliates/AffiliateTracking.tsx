"use client";

import { useEffect } from "react";
import { backendFetch } from "../../platform/backend";
import { useConsentStore } from "../../state/consentStore";

/**
 * Rewardful affiliate tracking — loads the remote script and hands the referral
 * it finds to our backend, which is what makes attribution survive the weeks
 * between the click and the purchase.
 *
 * Gated three ways, all of which must hold:
 *
 *   - `NEXT_PUBLIC_REWARDFUL_API_KEY` is set. Absent (the default) means the
 *     affiliate program simply doesn't exist on the client. Deliberately an env
 *     var rather than admin config: Next inlines `NEXT_PUBLIC_*` at build time,
 *     so this is also the switch that keeps the script out of the bundle.
 *   - The visitor granted the MARKETING cookie category. Attribution needs a
 *     first-party cookie that exists to pay a commission later, which is not
 *     strictly necessary for the site to work.
 *   - We're not on a local host. The Rewardful account has no test mode (it
 *     ignores Stripe test-mode events entirely), so every visit it records is a
 *     real one — a dev machine hitting it would quietly inflate affiliates'
 *     click stats with traffic that can never convert.
 *
 * KNOWN LIMIT: a visitor who accepts cookies only after navigating away from the
 * landing page loses attribution, because `?via=` is no longer in the URL when
 * the script finally loads. The banner appears immediately by default, so the
 * common case decides on the landing page; the fallback for anyone else is the
 * affiliate's coupon code, which needs no cookie at all.
 */

/** The async queue the remote script drains once it loads. */
type RewardfulQueue = { (...args: unknown[]): void; q?: IArguments[] };

interface RewardfulAffiliate {
  id?: string;
  name?: string;
}

interface RewardfulCampaign {
  id?: string;
  name?: string;
  /** Some payload shapes nest it a second time; handled defensively below. */
  campaign?: RewardfulCampaign;
}

interface RewardfulGlobal {
  referral?: string;
  affiliate?: RewardfulAffiliate | false;
  campaign?: RewardfulCampaign | null;
}

interface RewardfulWindow extends Window {
  _rwq?: string;
  rewardful?: RewardfulQueue;
  Rewardful?: RewardfulGlobal;
}

const SCRIPT_SRC = "https://r.wdfl.co/rw.js";
const SCRIPT_ID = "rewardful-script";

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local")
  );
}

/** Install the queue shim + remote script exactly once per page. */
function loadRewardful(apiKey: string): void {
  const w = window as RewardfulWindow;
  if (!w.rewardful) {
    const shim = function (this: unknown) {
      (shim.q = shim.q ?? []).push(arguments);
    } as RewardfulQueue;
    w._rwq = "rewardful";
    w.rewardful = shim;
  }
  if (document.getElementById(SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = SCRIPT_SRC;
  script.dataset.rewardful = apiKey;
  document.head.appendChild(script);
}

function campaignOf(global: RewardfulGlobal): RewardfulCampaign | null {
  const raw = global.campaign;
  if (!raw) return null;
  return raw.campaign ?? raw;
}

/**
 * Hand the referral to the backend, which stores it on the account (guest
 * included — a guest keeps its uid when it upgrades, so the referral survives
 * signup). `sessionStorage` keeps a repeat visit within the same tab from
 * re-posting a referral the backend already has.
 */
async function reportReferral(): Promise<void> {
  const global = (window as RewardfulWindow).Rewardful;
  const referral = global?.referral;
  if (!global || !referral) return;

  const marker = `rewardful:reported:${referral}`;
  try {
    if (window.sessionStorage.getItem(marker)) return;
  } catch {
    // Private mode / storage disabled — posting again is harmless.
  }

  const affiliate = global.affiliate || null;
  const campaign = campaignOf(global);
  try {
    const res = await backendFetch("/affiliates/attribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referral,
        affiliateId: affiliate?.id ?? null,
        affiliateName: affiliate?.name ?? null,
        campaignId: campaign?.id ?? null,
        campaignName: campaign?.name ?? null,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      stored?: boolean;
      reason?: string;
    };
    // Only stop asking once the backend actually holds this referral. A refusal
    // because the program is still switched off must NOT be cached, or enabling
    // it wouldn't take effect for tabs that are already open.
    const settled = body.stored === true || body.reason === "unchanged" || body.reason === "converted";
    if (settled) {
      try {
        window.sessionStorage.setItem(marker, "1");
      } catch {
        // Non-fatal: the backend is idempotent for an unchanged referral.
      }
    }
  } catch (err) {
    // Attribution is never worth an error in front of a visitor.
    console.warn("[affiliates] could not report referral", err);
  }
}

export function AffiliateTracking() {
  const hydrated = useConsentStore((s) => s.hydrated);
  const decided = useConsentStore((s) => s.decided);
  const marketingGranted = useConsentStore((s) => s.marketing);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_REWARDFUL_API_KEY;
    if (!apiKey) return;
    if (!hydrated || !decided || !marketingGranted) return;
    if (isLocalHost(window.location.hostname)) return;

    loadRewardful(apiKey);
    // Reporting rides on `ready` because `Rewardful.referral` isn't populated
    // until the script has resolved the visit. Nothing critical hangs off this
    // callback — if the script never loads (blocked, offline) we simply have no
    // attribution, which is the same outcome as no referral.
    (window as RewardfulWindow).rewardful?.("ready", () => {
      void reportReferral();
    });
  }, [hydrated, decided, marketingGranted]);

  return null;
}
