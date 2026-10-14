/** Skills for the look, the paid book run, the account and the conversation itself. */
import { availableViews, BOOK_VIEWS, bookVisible, bookViewOf, type BookViewId } from "../../journey";
import type { Project } from "../../../types";
import { portraitStatus, withPresetStyle } from "../../portrait";
import { artworkNames, styleIsFromArtwork } from "../../artworkStyle";
import { castOf, resolveOption } from "../resolve";
import type { CommandDef, ImpactEffect } from "../types";
import { arg, askFor, beat } from "./shared";
import { whenLookChosen, whenLookToChoose, whenNoLook, whenStory } from "./relevance";

/** Why a part of the book is not there to show yet, in words for the reader. */
function viewNotYet(project: Project, view: BookViewId): string {
  if (!bookVisible(project)) return "There's nothing on the right yet. The book appears once we know who is in it.";
  switch (view) {
    case "style":
      return "There's no look to show yet. It comes after the story and the people are settled.";
    case "story":
      return "There's no story to show yet.";
    case "cast":
      return "Nobody has a look settled yet. The people appear here once they do.";
    case "pages":
      return "The pages appear once the book is being drawn.";
  }
}

export const FLOW_COMMANDS: CommandDef[] = [
  {
    id: "setStyle",
    area: "style",
    suggest: [
      { id: "chooseLook", lead: true, relevant: whenLookToChoose },
      { id: "changeLook", relevant: whenLookChosen },
    ],
    summary: "Choose or change the art style (the look) of the book, by the style's name.",
    args: [{ name: "style", kind: "style", required: true, hint: "the style's name or a word from it, like 'watercolor'" }],
    examples: ["Use watercolor", "Change the look to something more cartoony", "Make it look like a comic"],
    help: "Sets the art style for the whole book. Portraits drawn in another style will need redrawing to match.",
    requires: ["notLocked"],
    impact: (project, args, ctx) => {
      const found = resolveOption(arg(args, "style"), ctx.styles);
      if (found.kind !== "one" || found.value.id === project.config.artStyle?.presetId) return { level: "none", effects: [] };
      const drawn = castOf(project).filter((m) => portraitStatus(project, m.id) === "current").map((m) => m.name.trim());
      const effects: ImpactEffect[] = [];
      // The look is a drawing's: a preset takes the drawing off the book, so the reader is asked first.
      const retires = styleIsFromArtwork(project);
      if (retires) effects.push({ kind: "retiresArtwork", names: artworkNames(project), preset: found.value.label });
      if (drawn.length > 0) effects.push({ kind: "outdatesPortraits", names: drawn });
      return { level: retires ? "destructive" : drawn.length > 0 ? "reversible" : "none", effects };
    },
    run: (project, args, ctx) => {
      const wanted = arg(args, "style");
      const found = wanted ? resolveOption(wanted, ctx.styles) : ({ kind: "none" } as const);
      if (found.kind !== "one") {
        const options = (found.kind === "many" ? found.values : ctx.styles).slice(0, 6);
        return askFor("style", "askWhichStyle", options.map((o) => ({ id: o.id, label: o.label })));
      }
      const current = project.config.styleReady !== false ? project.config.artStyle?.presetId : null;
      if (current === found.value.id) return { kind: "noop", beat: beat("alreadyThat") };
      return {
        kind: "write",
        project: withPresetStyle(project, {
          presetId: found.value.id,
          origin: "preset",
          ...(found.value.generationReference ? { generationReference: found.value.generationReference } : {}),
        }),
        beat: beat("styleChanged", { what: found.value.label }, { receipt: `Look: ${found.value.label}` }),
        view: "style",
      };
    },
  },
  {
    id: "drawBook",
    area: "generation",
    suggest: [{ id: "drawBook", views: ["pages"], lead: true }],
    summary: "Start drawing the pages of the book. Shows the paid button once everything before it is done.",
    args: [],
    examples: ["Draw the book", "Let's make the pages", "Create the illustrated book"],
    help: "Draws every page. It needs a story, a look, portraits of everyone, the book's size and layout, and the words on the cover. You see the price before it starts.",
    requires: ["notLocked", "hasStory", "storyAccepted", "styleChosen", "portraitsDrawn", "bookSetup", "coverWords", "signedIn"],
    paid: true,
    run: () => ({ kind: "effect", effect: { kind: "drawBook" }, beat: beat("quoteReady") }),
  },
  {
    id: "offerSparks",
    area: "account",
    suggest: false, // the Sparks badge covers it
    summary: "The reader wants to buy or top up Sparks (credits).",
    args: [],
    examples: ["Buy Sparks", "I need more credits", "How do I get more Sparks?"],
    help: "Opens the Sparks packs so you can top up.",
    requires: [],
    run: () => ({ kind: "effect", effect: { kind: "sparks" }, beat: beat("sparksOffer") }),
  },
  {
    id: "signIn",
    area: "account",
    suggest: false, // the account card covers it
    summary: "The reader wants to create an account or sign in.",
    args: [],
    examples: ["Create an account", "Sign me in", "Save my book to an account"],
    help: "Opens sign-in, so the book is saved to your account.",
    requires: [],
    run: (_project, _args, ctx) =>
      ctx.guest ? { kind: "effect", effect: { kind: "signIn" } } : { kind: "noop", beat: beat("alreadyThat") },
  },
  {
    id: "openView",
    area: "conversation",
    suggest: [{ id: "showCover", views: [], duringDrawing: true, relevant: whenStory }],
    summary:
      "Show a part of the book on the right: style (the look), story (with the title and author), cast (the characters) or pages (the finished book, front cover first). Only for looking at something that already exists. Never for choosing or changing the look (that is setStyle) or for asking what is next.",
    args: [{ name: "view", kind: "view", required: true, hint: "which part", options: BOOK_VIEWS }],
    examples: ["Show me the cover", "Open the story", "Let me see the portraits"],
    help: "Opens that part of the book next to the chat.",
    requires: [],
    run: (project, args, ctx) => {
      const view = bookViewOf(arg(args, "view"));
      if (!view) return { kind: "invalid", reason: `Unknown view ${arg(args, "view")}.` };
      // Said only when it is true: a tab that does not exist yet is not "open on the right".
      if (!availableViews(project, { portraitsRunning: ctx.portraitsRunning }).includes(view)) {
        return { kind: "invalid", reason: viewNotYet(project, view), say: true };
      }
      return { kind: "effect", effect: { kind: "view", view }, beat: beat("openedView") };
    },
  },
  {
    id: "undo",
    area: "conversation",
    suggest: false, // every change has its own undo
    summary: "Undo the guide's last change to the book.",
    args: [],
    examples: ["Undo that", "Go back", "Change it back"],
    help: "Takes back the last change I made from the chat.",
    requires: [],
    run: () => ({ kind: "effect", effect: { kind: "undo" } }),
  },
  {
    id: "skipField",
    area: "conversation",
    suggest: false, // it answers a question; it is never a first move
    summary: "The reader doesn't want to answer the optional question the guide just asked.",
    args: [],
    examples: ["Skip", "Not now", "I'd rather not say"],
    help: "Skips an optional question. I won't ask it again.",
    requires: [],
    run: () => ({ kind: "effect", effect: { kind: "skip" }, beat: beat("skipped") }),
  },
];
