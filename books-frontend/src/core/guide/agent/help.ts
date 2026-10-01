/**
 * What the guide knows when someone asks a question.
 *
 * Two sources and nothing else: the help sheet (shipped articles, edited or
 * extended by the admin) and facts read from this book. The answer model is
 * told to say it isn't sure rather than guess, and never to quote a price —
 * prices are shown on the buttons, exactly, and a number in a chat line would
 * be a second source that can be wrong.
 */
import type { GuideAgentConfig, GuideHelpArticleSetting } from "../../config/guideAgent";
import { isSkillEnabled } from "../../config/guideAgent";
import { getBookLanguage } from "../../config/bookLanguages";
import { castKindPhrase, isPerson } from "../../story/castKinds";
import { relationSentence, relationsOf } from "../../story/relations";
import { briefOf, wordCount } from "../../story/brief";
import type { Project } from "../../types";
import { journeyEntry } from "../journey";
import { portraitStatus } from "../portrait";
import { authoringOf } from "../projectState";
import { GUIDE_COMMAND_IDS, type GuideCommandId } from "./ids";
import { commandHelpLines } from "./registry";
import { REQUIREMENTS } from "./requirements";
import { castOf } from "./resolve";

export interface GuideHelpArticle {
  id: string;
  title: string;
  body: string;
}

export const DEFAULT_HELP_ARTICLES: readonly GuideHelpArticle[] = [
  {
    id: "how-it-works",
    title: "How making a book works",
    body:
      "You tell me who should be in the book, from your child to a pet or a favorite teddy, and what should happen, or paste a story you wrote. I write or keep the story, you pick a look, I draw everyone's portrait, and then I draw every page. You can change things along the way just by telling me.",
  },
  {
    id: "sparks",
    title: "Sparks",
    body:
      "Drawing pictures uses Sparks. Writing and changing the story doesn't. Before anything is drawn, the button shows the exact number of Sparks it costs, and nothing starts until you tap it. Anything that fails to draw is free. You can get more Sparks from the Sparks badge at the top.",
  },
  {
    id: "photos",
    title: "Photos",
    body:
      "You can add a photo so a portrait looks like your child. The photo is only used to draw the portrait and is deleted after that. You can also delete it yourself at any time. Finished portraits stay.",
  },
  {
    id: "changes",
    title: "Changing things",
    body:
      "Just tell me what to change: a name, an age, the title, the story, or how someone looks. Changes to the story show up for you to keep or drop. Changing a portrait saves the change and shows a redraw button with its price. The old version stays in the history.",
  },
  {
    id: "undo",
    title: "Undo",
    body:
      "Every change I make from the chat has an undo right under the message. You can also say 'undo that'. Deleting a photo can't be undone.",
  },
  {
    id: "own-story",
    title: "Using your own story",
    body:
      "Paste or type your story and I'll use your words as they are. I'll find the characters in it and ask about anything I need for the pictures. I never rewrite your story unless you ask.",
  },
  {
    id: "languages",
    title: "Languages",
    body:
      "You can chat with me in your language, and the story can be written in a different one. The story's language is set before it's written; after that, start a new book to change it.",
  },
  {
    id: "styles",
    title: "Art styles",
    body:
      "The look sets how every picture is drawn. You can change it before the pages start. Portraits drawn in another look will need redrawing so everything matches.",
  },
  {
    id: "printing",
    title: "Printing and ordering",
    body:
      "Once every page is drawn, you can order a printed book. Hardcovers need a minimum number of pages, so very short stories can be spread out or printed as a softcover.",
  },
  {
    id: "privacy",
    title: "Privacy",
    body:
      "Your book is private to your account. Photos are only used to draw portraits and are deleted afterward.",
  },
];

/** Shipped articles with the admin's edits applied, plus the admin's own. Disabled ones drop out. */
export function resolveHelpArticles(settings: readonly GuideHelpArticleSetting[]): GuideHelpArticle[] {
  const byId = new Map(settings.map((entry) => [entry.id, entry]));
  const out: GuideHelpArticle[] = [];
  for (const article of DEFAULT_HELP_ARTICLES) {
    const edit = byId.get(article.id);
    if (edit && !edit.enabled) continue;
    out.push({ id: article.id, title: edit?.title || article.title, body: edit?.body || article.body });
  }
  for (const entry of settings) {
    if (DEFAULT_HELP_ARTICLES.some((article) => article.id === entry.id) || !entry.enabled) continue;
    if (entry.title && entry.body) out.push({ id: entry.id, title: entry.title, body: entry.body });
  }
  return out;
}

export function helpSheetText(articles: readonly GuideHelpArticle[]): string {
  return articles.map((article) => `## ${article.title}\n${article.body}`).join("\n\n");
}

/** What this book is like right now, as facts the answer may use. No prices. */
export function bookFactsText(project: Project, guest: boolean): string {
  const cast = castOf(project);
  const state = authoringOf(project);
  const story = project.config.storyText.trim();
  const lines = [
    `Title: ${project.title || "(none yet)"}`,
    `How the story is written: ${journeyEntry(project) === "own" ? "the reader's own words" : journeyEntry(project) === "guided" ? "the guide writes it" : "not chosen yet"}`,
    `Story: ${story ? `${wordCount(story)} words, in ${getBookLanguage(project.config.contentLocale).englishName}` : "not written yet"}`,
    `Characters: ${
      cast.length
        ? cast
            .map((m) => {
              const age = !isPerson(m)
                ? castKindPhrase(m)
                : m.age !== undefined
                  ? `${m.age}`
                  : m.ageMonths !== undefined
                    ? `${m.ageMonths} months`
                    : "age unknown";
              const role = m.role?.trim() ? `, ${m.role.trim()}` : "";
              const portrait = portraitStatus(project, m.id);
              return `${m.name.trim()} (${age}${role}; portrait ${portrait === "current" ? "drawn" : portrait === "stale" ? "out of date" : "not drawn"}${m.likenessPhoto ? "; has a photo" : ""})`;
            })
            .join(", ")
        : "nobody yet"
    }`,
    ...(relationsOf(briefOf(project.config)).length > 0
      ? [`Together: ${relationsOf(briefOf(project.config)).map((r) => relationSentence(briefOf(project.config), r)).join(" ")}`]
      : []),
    `Look: ${project.config.styleReady !== false && project.config.artStyle?.presetId ? project.config.artStyle.presetId : "not chosen yet"}`,
    `Pages: ${state.lockedAt ? "being drawn or done" : "not started"}`,
    `Account: ${guest ? "not signed in" : "signed in"}`,
    `Mode: ${briefOf(project.config).mode}`,
  ];
  const unmet = (Object.keys(REQUIREMENTS) as (keyof typeof REQUIREMENTS)[])
    .filter((id) => !REQUIREMENTS[id].met(project, { guest }))
    .map((id) => REQUIREMENTS[id].label);
  if (unmet.length) lines.push(`Not done yet: ${unmet.join("; ")}`);
  return lines.join("\n");
}

export function enabledSkills(config: GuideAgentConfig): GuideCommandId[] {
  return GUIDE_COMMAND_IDS.filter((id) => isSkillEnabled(config, id));
}

export function skillsHelpText(config: GuideAgentConfig): string {
  return commandHelpLines(enabledSkills(config));
}
