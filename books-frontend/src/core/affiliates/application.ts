/**
 * Affiliate program application — shared types for the public apply form and
 * the backend store (`affiliateApplications/{ref}`).
 *
 * Applications are reviewed manually: Firestore is the system of record, Slack
 * is the human ping, and approved partners are created in Rewardful afterwards
 * (not auto-provisioned from this form).
 */

/** Where an application is in the review workflow. */
export type AffiliateApplicationStatus = "new" | "handled";

export function isAffiliateApplicationStatus(v: unknown): v is AffiliateApplicationStatus {
  return v === "new" || v === "handled";
}

export const AFFILIATE_CHANNEL_IDS = [
  "instagram",
  "youtube",
  "tiktok",
  "blog",
  "newsletter",
  "other",
] as const;

export type AffiliateChannelId = (typeof AFFILIATE_CHANNEL_IDS)[number];

export function isAffiliateChannelId(v: unknown): v is AffiliateChannelId {
  return typeof v === "string" && (AFFILIATE_CHANNEL_IDS as readonly string[]).includes(v);
}

export const AFFILIATE_CHANNEL_LABELS: Record<AffiliateChannelId, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  blog: "Blog / website",
  newsletter: "Newsletter",
  other: "Other",
};

export const AFFILIATE_AUDIENCE_IDS = [
  "under_1k",
  "1k_10k",
  "10k_50k",
  "50k_100k",
  "100k_plus",
  "prefer_not",
] as const;

export type AffiliateAudienceId = (typeof AFFILIATE_AUDIENCE_IDS)[number];

export function isAffiliateAudienceId(v: unknown): v is AffiliateAudienceId {
  return typeof v === "string" && (AFFILIATE_AUDIENCE_IDS as readonly string[]).includes(v);
}

export const AFFILIATE_AUDIENCE_LABELS: Record<AffiliateAudienceId, string> = {
  under_1k: "Under 1,000",
  "1k_10k": "1,000 – 10,000",
  "10k_50k": "10,000 – 50,000",
  "50k_100k": "50,000 – 100,000",
  "100k_plus": "100,000+",
  prefer_not: "Prefer not to say",
};

export interface AffiliateApplication {
  /** Human-quotable reference, also the Firestore document id. */
  ref: string;
  name: string;
  email: string;
  channel: AffiliateChannelId;
  /** Primary profile / site URL. */
  channelUrl: string;
  audience: AffiliateAudienceId;
  /** Short pitch: who they are and how they'd promote. */
  pitch: string;
  uid: string | null;
  senderHash: string | null;
  userAgent: string | null;
  status: AffiliateApplicationStatus;
  createdAt: number;
  handledAt: number | null;
  handledBy: string | null;
}
