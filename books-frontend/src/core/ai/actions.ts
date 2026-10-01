/**
 * The registry of LLM actions the app performs. This is the single, extensible
 * list that drives the admin model-config UI, the action→model resolver, and
 * cost attribution. Adding a new action = add one entry here (+ a default
 * binding in `createDefaultModelConfig`) and it flows everywhere.
 */
import type { Modality } from "../config/options";

export type TextActionId =
  | "storyDraft" // generateStoryDraft — write the story (guided / co-write modes)
  | "storyEdit" // reviseStory — surgical author-requested manuscript changes
  | "storyCheck" // checkStoryFit — advisory age-fit read of the author's own text
  | "storyAnalysis" // analyzeStory — extract anchors from the story
  | "anchorDescription" // generateAnchorDescription — suggest one anchor's look
  | "screenplay" // generateScreenplay — page-by-page plan + covers
  | "localize" // locateSubject(s) — vision call placing subjects on a page
  | "bindingPass" // bindDepictedSubjects — vision call binding anchors to regions in a freshly rendered page
  | "editIntent" // resolveEditIntent — classify user edits into structured operations
  | "guideInterpret" // interpretGuideTurn — turn a reader's message into a slot patch
  | "guideSpeak" // speakGuideLine — write a configured guide line in the chat language
  | "guideCompose" // composeGuideMessage — one chat message in the persona, from the turn's beats
  | "guideAnswer" // answerGuideQuestion — answer a how-to question from the help articles and the book
  | "guideExtractCast" // extractManuscriptCast — names and ages from a pasted manuscript, no rewrite
  | "extractArtStyle" // extractArtStyleFromImages — vision call: style-only prompt from character artwork
  | "extractArtLook" // extractArtLookFromImages — vision call: who is in the uploaded character artwork
  | "releaseNotes"; // summarizeRelease — turn a deploy's code diff into plain-language release notes

export type ImageActionId =
  | "anchorImage" // renderAnchor — anchor reference sheet
  | "pageIllustration" // runIllustration — a page/spread illustration
  | "coverIllustration" // cover illustration
  | "portrait"; // renderPortrait — one Chat studio portrait of a cast member in the saved style

export interface ActionInfo<Id extends string> {
  id: Id;
  label: string;
  modality: Modality;
  help: string;
}

export const TEXT_ACTIONS: ActionInfo<TextActionId>[] = [
  { id: "storyDraft", label: "Story draft", modality: "text", help: "Writes the story — either from a name + theme (guided) or from the real cast, occasion and place (co-write)." },
  { id: "storyEdit", label: "Story refinement", modality: "text", help: "Makes a precise requested change while preserving the rest of the manuscript and its voice." },
  { id: "storyCheck", label: "Story age-fit check", modality: "text", help: "Advisory read of a story the author wrote themselves: does it suit the age band they picked?" },
  { id: "storyAnalysis", label: "Story analysis", modality: "text", help: "Extracts only the characters, places and objects that must stay visually consistent." },
  { id: "anchorDescription", label: "Anchor description", modality: "text", help: "Suggests a single character/place/object's visual description." },
  { id: "screenplay", label: "Screenplay", modality: "text", help: "Turns the story into a page-by-page plan with covers." },
  { id: "localize", label: "Subject localization (vision)", modality: "text", help: "Finds where a subject sits inside a rendered page (used for in-place edits)." },
  { id: "bindingPass", label: "Anchor binding (vision)", modality: "text", help: "After a page is rendered, binds each anchor to its region in the image (records what's depicted where)." },
  { id: "editIntent", label: "Edit intent resolution", modality: "text", help: "Classifies a user's free-text illustration edit into structured remove/replace/refresh operations over known anchors." },
  { id: "guideInterpret", label: "Guide turn interpretation", modality: "text", help: "Reads what the reader typed in the Chat studio and turns it into facts about the book (names, ages, theme, reading age…), the skills to run (rename, redraw, add a person…) and the message's language. Runs on every message and decides what changes, so accuracy matters: keep it on a strong fast model with low reasoning." },
  { id: "guideSpeak", label: "Guide speech (legacy)", modality: "text", help: "Writes a configured guide line in the chat language, and the next question after a turn. Used only when the persona composer is turned off." },
  { id: "guideCompose", label: "Guide persona composer", modality: "text", help: "Writes each chat message in the guide's persona and the reader's language, from what the app decided to say. Code checks every message (names, numbers, length, casual address) and falls back to the configured wording, so a lite model with no reasoning is right here. Latency is felt on every turn." },
  { id: "guideAnswer", label: "Guide help answers", modality: "text", help: "Answers how-to questions (\"What are Sparks?\", \"Why can't I draw the pages yet?\") from the help articles and the book's current state, in the language of the question. Never states prices; those come from the app." },
  { id: "guideExtractCast", label: "Own-words cast extraction", modality: "text", help: "Reads a manuscript the reader typed or pasted and returns the named people and their stated ages, without rewriting the story." },
  { id: "extractArtStyle", label: "Art-style extraction (vision)", modality: "text", help: "Reads uploaded character artwork and writes a style-only prompt (no characters, clothes or scenes) for the rest of the book." },
  { id: "extractArtLook", label: "Character-look extraction (vision)", modality: "text", help: "Reads uploaded character artwork and writes who is in the drawing (species, body, clothes actually shown) so later steps do not invent a different character." },
  { id: "releaseNotes", label: "Release notes (CI/CD)", modality: "text", help: "Reads the code diff between the last shipped commit and the new one, and writes what changed in plain language for the sales/marketing team. Runs once per deploy, not per user — pick a model with a large context window." },
];

export const IMAGE_ACTIONS: ActionInfo<ImageActionId>[] = [
  { id: "anchorImage", label: "Anchor reference images", modality: "image", help: "Reference sheets for characters/places/objects." },
  { id: "pageIllustration", label: "Page illustrations", modality: "image", help: "The illustration for each page or spread." },
  { id: "coverIllustration", label: "Cover illustrations", modality: "image", help: "Front/back cover artwork." },
  { id: "portrait", label: "Portraits (Chat studio)", modality: "image", help: "One picture of a person in the saved style, from a photo, a drawing, a description or the name alone. Quoted and charged only in the scoped portrait batch that names that person." },
];

export const ALL_TEXT_ACTION_IDS = TEXT_ACTIONS.map((a) => a.id);
export const ALL_IMAGE_ACTION_IDS = IMAGE_ACTIONS.map((a) => a.id);

export function isImageAction(action: string): action is ImageActionId {
  return (ALL_IMAGE_ACTION_IDS as string[]).includes(action);
}
