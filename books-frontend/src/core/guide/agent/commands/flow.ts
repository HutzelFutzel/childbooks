/** Skills for the look, the paid book run, the account and the conversation itself. */
import { BOOK_VIEWS, bookViewOf } from "../../journey";
import { noteStyleChange, portraitStatus } from "../../portrait";
import { castOf, resolveOption } from "../resolve";
import type { CommandDef } from "../types";
import { arg, askFor, beat } from "./shared";
import { whenLookChosen, whenNoLook, whenStory } from "./relevance";

export const FLOW_COMMANDS: CommandDef[] = [
  {
    id: "setStyle",
    area: "style",
    suggest: [
      { id: "chooseLook", lead: true, relevant: whenNoLook },
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
      return drawn.length > 0
        ? { level: "reversible", effects: [{ kind: "outdatesPortraits", names: drawn }] }
        : { level: "none", effects: [] };
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
        project: noteStyleChange(project, {
          ...project,
          config: { ...project.config, artStyle: { presetId: found.value.id, origin: "preset" }, styleReady: true },
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
      "Show a part of the book on the right: style (the look), story (with the title and author), cast (the characters) or pages (the finished book, front cover first).",
    args: [{ name: "view", kind: "view", required: true, hint: "which part", options: BOOK_VIEWS }],
    examples: ["Show me the cover", "Open the story", "Let me see the portraits"],
    help: "Opens that part of the book next to the chat.",
    requires: [],
    run: (_project, args) => {
      const view = bookViewOf(arg(args, "view"));
      if (!view) return { kind: "invalid", reason: `Unknown view ${arg(args, "view")}.` };
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
