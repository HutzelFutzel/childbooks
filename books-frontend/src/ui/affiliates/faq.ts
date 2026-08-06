/**
 * The affiliate program FAQ — single source of truth for both the always-visible
 * on-page content and the FAQPage structured data (`AffiliateJsonLd`).
 *
 * Deliberately static (not admin-managed like `seo.faq`): these are facts about
 * how the program works, not marketing copy, and several answers depend on
 * program mechanics an admin editor shouldn't be able to accidentally misstate.
 * Keep answers honest — no rate/window numbers here, since those are confirmed
 * per-affiliate in Rewardful at approval time (see `core/config/affiliates.ts`).
 */
export interface AffiliateFaqItem {
  question: string;
  answer: string;
}

export const AFFILIATE_FAQ: AffiliateFaqItem[] = [
  {
    question: "How much can I earn?",
    answer:
      "Commission is a percentage of qualifying purchases made through your link. The exact rate and attribution window are confirmed when you're approved, since they can vary by campaign.",
  },
  {
    question: "Do I need a large audience?",
    answer:
      "No minimum. We care more about fit — a genuine connection to parenting, kids, gifts, or storytelling — than follower count.",
  },
  {
    question: "How long does review take?",
    answer:
      "We review every application by hand, usually within a few business days. You'll hear from us by email either way.",
  },
  {
    question: "Is there a cost to join?",
    answer: "No. Applying and joining the program is free.",
  },
  {
    question: "How and when do I get paid?",
    answer:
      "Payout schedule and minimum payout are confirmed when you join, and you can see them anytime in your affiliate dashboard.",
  },
  {
    question: "Can I run paid ads or list on coupon sites?",
    answer:
      "Not without asking us first. We want the program associated with genuine recommendations, not coupon-farming or misleading ads.",
  },
];
