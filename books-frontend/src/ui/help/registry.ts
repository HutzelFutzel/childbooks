/**
 * Central copy for in-product explanations. Keeping help text in one registry
 * (instead of scattered `title=""` attributes and inline paragraphs) keeps the
 * voice consistent, makes it translatable, and lets any surface drop an
 * `<InfoHint topic="…" />` next to a concept.
 */
export interface HelpTopic {
  title: string;
  body: string;
  /** Optional extra points rendered as a short list. */
  points?: string[];
}

export const HELP: Record<string, HelpTopic> = {
  imageQuality: {
    title: "Fast vs. High-Quality",
    body: "This sets the quality for every image you generate. You can switch anytime.",
    points: [
      "Fast — a draft in under a minute. Great for laying out the book and trying ideas; characters may drift slightly.",
      "High-Quality — a few minutes per image, but characters match their references far more closely and small flaws are auto-repaired. Best for the final book.",
    ],
  },
  generationTime: {
    title: "Why does this take a while?",
    body: "Each illustration is painted from scratch and matched to your characters' reference art.",
    points: [
      "More characters or places on a page = more references to match = a little longer per image (and a few more Sparks).",
      "High-Quality takes longer than Fast.",
      "You can leave — rendering continues in the background and appears when it's done.",
    ],
  },
  sparks: {
    title: "What are Sparks?",
    body: "Sparks are the credits spent when the AI generates an image. The amount shown is an estimate — you're charged the actual cost when each image finishes, which can vary a little.",
  },
  referenceSheet: {
    title: "Reference sheets",
    body: "Before drawing pages, we create a reference image for each character and place. Every page is then matched to these references so your cast looks consistent throughout the book.",
  },
  staleness: {
    title: "Why does a page need updating?",
    body: "When you change a character or place after a page was drawn, that page still shows the old look. \u201cUpdate\u201d re-renders it to match the newest design — nothing changes until you choose to.",
  },
  containsRelates: {
    title: "Contains vs. Relates to",
    body: "These link characters and places so they stay consistent.",
    points: [
      "Contains — something physically inside this subject (e.g. a bed in a room). It's drawn here and matched to its own reference.",
      "Relates to / resembles — context only (e.g. a sibling to match traits). It's not drawn as a separate figure.",
    ],
  },
  embedLimit: {
    title: "Keep it to a few",
    body: "With more than ~3 embedded subjects, each one is matched less accurately and the image takes longer. Keep the 2–3 most important ones and describe the rest in the text.",
  },
  pageAnchors: {
    title: "Characters & places on this page",
    body: "Tap to add or remove who appears here. Adding a character sends its reference to the AI so it's drawn consistently — each extra one adds a little render time.",
  },
  anchorMode: {
    title: "Design mode",
    body: "\u201cLet AI design\u201d invents the look from your story. \u201cI'll describe it\u201d lets you spell out exactly how it should look.",
  },
  versions: {
    title: "Version history",
    body: "Every generation is saved. Click any thumbnail to revert, or refine from it to branch a new version. Switching a character's version marks the pages that used it as needing an update.",
  },
  layoutQuietZone: {
    title: "How text sits on the page",
    body: "Illustrations are generated full-bleed with a calm area on the outer edge of each page, where your words sit. On left pages the text is on the left; on right pages it's on the right.",
  },
};

export type HelpTopicId = keyof typeof HELP;
