/** Skills for the book as an object: how it is written, its cover words, language and binding. */
import { getBookLanguage, isBookLanguageId } from "../../../config/bookLanguages";
import type { HardcoverDecision, Project } from "../../../types";
import { coverCardLines, coverWordsSettled } from "../../coverWords";
import { journeyEntry } from "../../journey";
import { authoringOf, withAuthoring } from "../../projectState";
import { resolveOption } from "../resolve";
import type { CommandDef } from "../types";
import { arg, askFor, beat } from "./shared";
import { whenNoStory, whenStory } from "./relevance";

function cover(project: Project) {
  return authoringOf(project).cover ?? {};
}

const unquote = (text: string) => text.replace(/^["'“„«]+|["'”“»]+$/g, "").trim();

export const BOOK_COMMANDS: CommandDef[] = [
  {
    id: "chooseEntry",
    area: "path",
    suggest: false, // the opening choice covers it
    summary:
      "The reader chooses how the story gets written: 'guided' (the guide asks and writes it) or 'own' (they write or paste it). Only before a story exists.",
    args: [{ name: "entry", kind: "entry", required: true, hint: "guided or own", options: ["guided", "own"] }],
    examples: ["Guide me", "I want to write it myself", "Can you help me write it?"],
    help: "Chooses whether the guide writes the story with you, or you use your own words. You can switch before a story exists.",
    requires: ["notLocked"],
    run: (project, args) => {
      const entry = arg(args, "entry");
      if (entry !== "guided" && entry !== "own") return { kind: "invalid", reason: "entry must be guided or own" };
      if (project.config.storyText.trim()) return { kind: "noop", beat: beat("alreadyThat") };
      if (journeyEntry(project) === entry) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "effect", effect: { kind: "entry", entry } };
    },
  },
  {
    id: "setTitle",
    area: "book",
    suggest: [{ id: "changeTitle", group: "book", views: ["story", "pages"], relevant: whenStory }],
    summary: "Change the book's title.",
    args: [{ name: "title", kind: "text", required: true, hint: "the new title, exactly as the reader wrote it" }],
    examples: ["Change the title to Moonlight Adventures", "Call the book 'Maya and the Moon'"],
    help: "Sets the title on the cover. You can change it any time before the pages are drawn.",
    requires: ["notLocked"],
    run: (project, args) => {
      const title = arg(args, "title").replace(/^["'“„«]+|["'”“»]+$/g, "").slice(0, 120);
      if (!title) return askFor("title", "askText");
      if (project.title.trim() === title) return { kind: "noop", beat: beat("alreadyThat") };
      return {
        kind: "effect",
        effect: { kind: "title", title },
        beat: beat("done", undefined, { mustSay: [title], receipt: `Title: ${title}` }),
      };
    },
  },
  {
    id: "setSubtitle",
    area: "book",
    suggest: [{ id: "changeSubtitle", relevant: whenStory }],
    summary:
      "Change or clear the subtitle on the cover. Also when the guide asked about the cover and the reader picks or writes a subtitle, or says they want none.",
    args: [{ name: "subtitle", kind: "text", required: true, hint: "the new subtitle; empty text clears it" }],
    examples: ["Add the subtitle 'A bedtime story'", "Remove the subtitle", "No subtitle, thanks"],
    help: "Sets the small line under the title on the cover.",
    requires: ["notLocked"],
    run: (project, args) => {
      const subtitle = unquote(arg(args, "subtitle")).slice(0, 160);
      if (cover(project).subtitle !== undefined && coverCardLines(project).subtitle === subtitle) {
        return { kind: "noop", beat: beat("alreadyThat") };
      }
      return {
        kind: "effect",
        effect: { kind: "subtitle", subtitle },
        beat: beat("done", undefined, subtitle ? { mustSay: [subtitle], receipt: `Subtitle: ${subtitle}` } : {}),
      };
    },
  },
  {
    id: "setAuthor",
    area: "book",
    suggest: [{ id: "changeAuthor", relevant: whenStory }],
    summary:
      "Set or clear the author name printed on the cover. Also when the guide asked about the cover and the reader names who the book is from, or says they want no author.",
    args: [
      {
        name: "author",
        kind: "text",
        required: true,
        hint: "the name(s) to print as author, exactly as the reader wrote them; empty text clears it",
      },
    ],
    examples: ["Put 'Mom and Dad' as the author", "The author is Grandma Lou", "It's from Uncle David"],
    help: "Sets who the book is 'by' on the cover.",
    requires: ["notLocked"],
    run: (project, args) => {
      const author = unquote(arg(args, "author")).slice(0, 120);
      if (cover(project).author !== undefined && coverCardLines(project).author === author) {
        return { kind: "noop", beat: beat("alreadyThat") };
      }
      return {
        kind: "effect",
        effect: { kind: "author", author },
        beat: beat("done", undefined, author ? { mustSay: [author], receipt: `Author: ${author}` } : {}),
      };
    },
  },
  {
    id: "confirmCoverWords",
    area: "book",
    suggest: false, // the cover words card has the button
    summary:
      "The reader is happy with the words on the cover as the cover card shows them (title, subtitle, author) — 'looks good', 'perfect', 'keep it like that' after the guide asked about the cover.",
    args: [],
    examples: ["Looks good", "That's perfect for the cover", "Keep it like that"],
    help: "Keeps the cover's title, subtitle and author as they are, and moves on to drawing the book.",
    requires: ["notLocked", "hasStory", "storyAccepted"],
    run: (project) => {
      if (coverWordsSettled(project)) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "effect", effect: { kind: "coverWords" }, beat: beat("coverWordsSet") };
    },
  },
  {
    id: "changeCoverWords",
    area: "book",
    suggest: [{ id: "changeCoverWords", relevant: whenStory }],
    summary:
      "The reader wants to look at the cover's words again after settling them: the guide shows the cover card with its subtitle and author ideas once more.",
    args: [],
    examples: ["Can we change what the cover says?", "I'd like to add an author after all"],
    help: "Shows the cover's title, subtitle and author again, with ideas, until the pages are drawn.",
    requires: ["notLocked"],
    run: (project) => {
      if (!coverWordsSettled(project)) return { kind: "noop", beat: beat("reply") };
      return {
        kind: "write",
        project: withAuthoring(project, { cover: { ...cover(project), confirmedAt: undefined } }),
        beat: beat("done"),
      };
    },
  },
  {
    id: "setBookLanguage",
    area: "book",
    suggest: [{ id: "changeLanguage", views: ["story"], relevant: whenNoStory }],
    summary:
      "Change the language the STORY is written in (not the chat). Only when the reader explicitly asks for the book or story in another language.",
    args: [{ name: "language", kind: "language", required: true, hint: "language name or code, like 'German' or 'de-DE'" }],
    examples: ["Write the book in Spanish", "The story should be in German"],
    help: "Sets the language the story is written in. It can only change before the story exists.",
    requires: ["notLocked"],
    run: (project, args, ctx) => {
      const wanted = arg(args, "language");
      const direct = isBookLanguageId(wanted) ? wanted : null;
      const match = direct ? { kind: "one" as const, value: { id: direct, label: wanted } } : resolveOption(wanted, ctx.languages);
      if (match.kind === "none") return { kind: "invalid", reason: `"${wanted}" is not a book language.`, say: true };
      if (match.kind === "many") {
        return askFor("language", "askWhich", match.values.map((value) => ({ id: value.id, label: value.label })));
      }
      const id = match.value.id;
      if (!isBookLanguageId(id)) return { kind: "invalid", reason: `"${wanted}" is not a book language.`, say: true };
      const name = getBookLanguage(id).endonym;
      if (project.config.storyText.trim()) {
        if (project.config.contentLocale === id) return { kind: "noop", beat: beat("alreadyThat") };
        return { kind: "noop", beat: beat("languageLocked", { language: getBookLanguage(project.config.contentLocale).endonym }) };
      }
      if (project.config.contentLocale === id) return { kind: "noop", beat: beat("alreadyThat") };
      return {
        kind: "write",
        project: withAuthoring({ ...project, config: { ...project.config, contentLocale: id } }, { languageSaid: true }),
        beat: beat("languageNote", { language: name }, { mustSay: [], receipt: `Language: ${name}` }),
      };
    },
  },
  {
    id: "decideHardcover",
    area: "book",
    suggest: false, // the hardcover card asks it when it matters
    summary:
      "Answer the hardcover question for a short story: 'spread' it over more pages, 'keep' it short (softcover), or accept 'thin' pages.",
    args: [
      { name: "decision", kind: "choice", required: true, hint: "spread, keep or thin", options: ["spread", "keep", "thin"] },
    ],
    examples: ["Spread it out so we can get a hardcover", "Keep it short, softcover is fine"],
    help: "Short stories can't fill a hardcover. You can spread the story over more pages, or keep it short as a softcover.",
    requires: ["notLocked", "hasStory"],
    run: (project, args) => {
      const decision = arg(args, "decision") as HardcoverDecision;
      if (!["spread", "keep", "thin"].includes(decision)) {
        return { kind: "invalid", reason: "decision must be spread, keep or thin" };
      }
      if (authoringOf(project).hardcover === decision) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "write", project: withAuthoring(project, { hardcover: decision }), beat: beat("done") };
    },
  },
  {
    id: "changeBookSetup",
    area: "book",
    suggest: [{ id: "changeSize" }],
    summary:
      "The reader wants a different book shape and size ('format'), a different way the words and pictures share each page ('layout'), or both, after they were chosen. The guide asks the question again with its choices.",
    args: [
      {
        name: "part",
        kind: "choice",
        required: false,
        hint: "format (shape and size), layout (words and pictures) or both; empty means both",
        options: ["format", "layout", "both"],
      },
    ],
    examples: ["I'd like a different book size", "Can we change the page layout?", "Make it landscape instead"],
    help: "Asks again about the book's shape and size, or how the words and pictures share each page. You can change them until the pages are drawn.",
    requires: ["notLocked"],
    run: (project, args) => {
      const part = arg(args, "part") || "both";
      if (!["format", "layout", "both"].includes(part)) {
        return { kind: "invalid", reason: "part must be format, layout or both" };
      }
      const setup = authoringOf(project).bookSetup ?? {};
      const format = part !== "layout" && Boolean(setup.formatConfirmedAt);
      const layout = part !== "format" && Boolean(setup.layoutConfirmedAt);
      // Not chosen yet: the chat asks about it anyway.
      if (!format && !layout) return { kind: "noop", beat: beat("reply") };
      return {
        kind: "write",
        project: withAuthoring(project, {
          bookSetup: {
            ...setup,
            formatConfirmedAt: format ? undefined : setup.formatConfirmedAt,
            layoutConfirmedAt: layout ? undefined : setup.layoutConfirmedAt,
          },
        }),
        beat: beat("done"),
      };
    },
  },
];
