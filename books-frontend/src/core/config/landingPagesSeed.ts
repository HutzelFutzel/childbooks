/**
 * Starter landing pages, seeded idempotently by slug from Admin → Marketing →
 * Landing pages. They ship as **drafts**: the images are missing (the hero
 * prompt below is there to generate them) and an admin should read the copy
 * before it goes live.
 *
 * The testimonial is deliberately left blank. A made-up review on a public page
 * is a legal and trust problem, and the template simply hides the block until
 * a real quote and attribution are entered.
 */
import type { LandingPage } from "./landingPages";

export type LandingSeed = Partial<Omit<LandingPage, "translationGroupId">> & {
  slug: string;
  title: string;
};

export const LANDING_SEED_PAGES: LandingSeed[] = [
  {
    slug: "bedtime-story-book",
    title: "Personalized bedtime story book",
    locale: "en",
    status: "draft",
    tags: ["bedtime", "personalization"],
    hero: {
      eyebrow: "For the parent with ten minutes left at bedtime",
      title: "The bedtime story they'll ask for every night",
      subtitle:
        "A personalized picture book starring your child, made in minutes after the kids are asleep. You bring the love, we do the drawing.",
      ctaLabel: "Make their bedtime book",
      bullets: ["Starring your child by name", "Made in minutes", "Printed hardcover keepsake"],
      image: null,
      imagePrompt:
        "Warm hand-drawn children's-book illustration: a mother with red hair reading a picture book to her young daughter on a cosy patterned armchair, a small dog asleep at their feet, a lamp glowing on a side table. Soft coloured-pencil texture, golden evening light, cream background.",
    },
    steps: {
      heading: "How your personalized bedtime story book comes together",
      items: [
        {
          title: "Tell us about your child",
          body: "Their name, what they love and the people and pets in their life. It takes a few minutes.",
        },
        {
          title: "Shape the story together",
          body: "Pick a moment or a theme, read the pages and change anything that doesn't feel like them.",
        },
        {
          title: "Hold a real hardcover book",
          body: "We print it as a keepsake picture book they'll ask for again and again.",
        },
      ],
    },
    showcase: {
      items: [
        { image: null, caption: "A calmer bedtime, one page at a time" },
        { image: null, caption: "Their name, their pet, their world" },
        { image: null, caption: "Their own idea, turned into a book" },
      ],
    },
    benefits: {
      heading: "Why tired parents love it",
      items: [
        {
          title: "Bedtime gets easier",
          body: "Kids settle faster with a story about themselves. It becomes the part of the night they look forward to.",
        },
        {
          title: "No screens needed",
          body: "A real book in their hands, read with you. Creative screen time ends at the shopping cart.",
        },
        {
          title: "Helps with big moments",
          body: "New sibling, first day of preschool, fear of the dark. A story where they're brave makes the real thing smaller.",
        },
      ],
      quote: { text: "", attribution: "" },
    },
    faq: {
      heading: "Questions parents ask",
      items: [
        {
          question: "How long does it take to make?",
          answer:
            "Most parents finish in about ten minutes: tell us about your child, read the story together and adjust anything you like. You can preview the whole book before deciding whether to print it.",
        },
        {
          question: "What ages is it for?",
          answer:
            "Pick your child's age and the words, pacing and vocabulary are written to suit it, from simple picture-led pages for little ones to longer stories for early readers.",
        },
        {
          question: "Can I change the story?",
          answer:
            "Yes. Every sentence is editable, and you can ask for different illustrations or change details about the characters until it feels exactly right.",
        },
      ],
    },
    closing: {
      heading: "Ten minutes tonight, a favorite book for years.",
      ctaLabel: "Make their bedtime book",
    },
  },
];
