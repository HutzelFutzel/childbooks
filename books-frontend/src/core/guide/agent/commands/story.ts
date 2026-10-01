/** Skills for the story text: write it, rework it, check it. */
import { briefOf, isBriefReady, wordCount } from "../../../story/brief";
import { journeyEntry } from "../../journey";
import { storyHandedOver } from "../../ownWords";
import type { CommandDef } from "../types";
import { arg, askFor, beat } from "./shared";
import { unreadStoryOffer, whenLongStory, whenStory, whenStoryToChange } from "./relevance";

export const STORY_COMMANDS: CommandDef[] = [
  {
    id: "draftStory",
    area: "story",
    suggest: false, // the story card and the opening flow start it
    summary:
      "Write the story from the facts and story details the guide has (guided books only). Before the first draft: the reader says to go ahead. Afterwards: only when they ask for a new or fresh story, not for changes to the current one.",
    args: [],
    examples: [
      "Just write it",
      "Go ahead",
      "Surprise me",
      "Write a new story",
      "Start the story over",
      "Try a completely different story",
    ],
    help: "Writes the story from what you've told me. If there's already a story, it gets replaced, so I'll check with you first.",
    requires: ["notLocked", "storyIdle"],
    impact: (project) =>
      project.config.storyText.trim()
        ? { level: "destructive", effects: [{ kind: "replacesStory", words: wordCount(project.config.storyText) }] }
        : { level: "none", effects: [] },
    run: (project) => {
      if (journeyEntry(project) === "own" || briefOf(project.config).mode === "own") {
        return { kind: "invalid", reason: "This book uses the reader's own words; the guide does not draft over them.", say: true };
      }
      if (!isBriefReady(briefOf(project.config))) {
        return {
          kind: "blocked",
          remedy: { requirement: "hasStory", what: "who the book is for and what should happen." },
        };
      }
      // The first draft is announced when it starts; only a replacement says so here.
      return project.config.storyText.trim()
        ? { kind: "effect", effect: { kind: "draftStory" }, beat: beat("storyRedraft") }
        : { kind: "effect", effect: { kind: "draftStory" } };
    },
  },
  {
    id: "reviseStory",
    area: "story",
    suggest: [
      { id: "shorterStory", instant: true, relevant: whenLongStory },
      { id: "simplerStory", instant: true, relevant: whenStoryToChange },
      { id: "warmerEnding", instant: true, relevant: whenStoryToChange },
      { id: "readAloudRhythm", instant: true, relevant: whenStoryToChange },
      { id: "markNicer", marked: true, instant: true, relevant: whenStoryToChange },
      { id: "markShorter", marked: true, instant: true, relevant: whenStoryToChange },
      { id: "markSimpler", marked: true, instant: true, relevant: whenStoryToChange },
      { id: "markVivid", marked: true, instant: true, relevant: whenStoryToChange },
    ],
    summary:
      "Change the existing story text: make it shorter or funnier, change what happens, remove or add a scene, change who appears in it. Never for giving a person a new name: that is renamePerson. The reader reviews each change. When the reader has marked a passage, only that passage changes.",
    args: [
      { name: "instruction", kind: "text", required: true, hint: "what to change, in the reader's words" },
      {
        name: "wholeStory",
        kind: "choice",
        required: false,
        hint: 'only when a passage is marked and the reader plainly asks about the whole story or other parts of it',
        options: ["yes"],
      },
    ],
    examples: [
      "Make the story shorter",
      "Add a scene at the beach",
      "Make the ending happier",
      "Take the dog out of the story",
    ],
    help: "Reworks the story the way you describe. Mark a passage first to change only that part. You'll see each change and can keep or drop it.",
    requires: ["notLocked", "hasStory", "storyIdle"],
    run: (project, args, ctx) => {
      const instruction = arg(args, "instruction").slice(0, 600);
      const marked = ctx.marked === true;
      // Asking "what should change?" would outlive the mark, and the answer would
      // then rework the whole story. With a mark, a request without words is not run.
      if (!instruction && marked) return { kind: "invalid", reason: "The request for the marked passage had no instruction." };
      if (!instruction) return askFor("instruction", "askWhatChange");
      if (project.config.storyText.trim().length < 20) {
        return { kind: "blocked", remedy: { requirement: "hasStory", what: "a story to change.", view: "story" } };
      }
      // A marked passage is the scope. A request about the rest of the story
      // never quietly widens it: say so, and leave the choice to the reader.
      if (marked && arg(args, "wholeStory").toLowerCase() === "yes") {
        return { kind: "noop", beat: beat("markedScope", undefined, { priority: "answer" }) };
      }
      return {
        kind: "effect",
        effect: { kind: "reviseStory", instruction, ...(marked ? { scoped: true } : {}) },
        beat: beat("storyRevising"),
      };
    },
  },
  {
    id: "finishStory",
    area: "story",
    suggest: false, // the "My story is ready" button covers it
    summary:
      "The reader's own story (one they wrote or pasted) is finished and they want to go on: 'that's the whole story', 'I'm done writing', 'my story is ready'. Not for a story the guide wrote.",
    args: [],
    examples: ["My story is ready", "That's the whole story", "I'm done writing, what's next?"],
    help: "Tells me your story is finished. I read who's in it, then we choose the look, the size and the cover. You can still edit it afterwards.",
    requires: ["notLocked", "hasStory", "storyIdle"],
    run: (project) => {
      if (storyHandedOver(project)) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "effect", effect: { kind: "storyDone" }, beat: beat("storyHandedOver") };
    },
  },
  {
    id: "checkStory",
    area: "story",
    suggest: [{ id: "checkStory", group: "check", instant: true, relevant: whenStory, offer: unreadStoryOffer }],
    summary: "Check whether the story suits the reader's age: length, words and themes. Advice only; changes nothing.",
    args: [],
    examples: ["Is the story right for a 3-year-old?", "Check my story", "Is this too long for a toddler?"],
    help: "Reads the story and tells you whether it fits the age you chose. It doesn't change anything.",
    requires: ["hasStory", "storyIdle"],
    run: () => ({ kind: "effect", effect: { kind: "checkStory" } }),
  },
];
