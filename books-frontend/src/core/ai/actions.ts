/**
 * The registry of LLM actions the app performs. This is the single, extensible
 * list that drives the admin model-config UI, the action→model resolver, and
 * cost attribution. Adding a new action = add one entry here (+ a default
 * binding in `createDefaultModelConfig`) and it flows everywhere.
 */
import type { Modality } from "../config/options";

export type TextActionId =
  | "storyAnalysis" // analyzeStory — extract anchors from the story
  | "anchorDescription" // generateAnchorDescription — suggest one anchor's look
  | "screenplay" // generateScreenplay — page-by-page plan + covers
  | "localize" // locateSubject(s) — vision call placing subjects on a page
  | "bindingPass" // bindDepictedSubjects — vision call binding anchors to regions in a freshly rendered page
  | "editIntent"; // resolveEditIntent — classify user edits into structured operations

export type ImageActionId =
  | "anchorImage" // renderAnchor — anchor reference sheet
  | "pageIllustration" // runIllustration — a page/spread illustration
  | "coverIllustration"; // cover illustration

export interface ActionInfo<Id extends string> {
  id: Id;
  label: string;
  modality: Modality;
  help: string;
}

export const TEXT_ACTIONS: ActionInfo<TextActionId>[] = [
  { id: "storyAnalysis", label: "Story analysis", modality: "text", help: "Extracts the characters, places and objects that must stay consistent." },
  { id: "anchorDescription", label: "Anchor description", modality: "text", help: "Suggests a single character/place/object's visual description." },
  { id: "screenplay", label: "Screenplay", modality: "text", help: "Turns the story into a page-by-page plan with covers." },
  { id: "localize", label: "Subject localization (vision)", modality: "text", help: "Finds where a subject sits inside a rendered page (used for in-place edits)." },
  { id: "bindingPass", label: "Anchor binding (vision)", modality: "text", help: "After a page is rendered, binds each anchor to its region in the image (records what's depicted where)." },
  { id: "editIntent", label: "Edit intent resolution", modality: "text", help: "Classifies a user's free-text illustration edit into structured remove/replace/refresh operations over known anchors." },
];

export const IMAGE_ACTIONS: ActionInfo<ImageActionId>[] = [
  { id: "anchorImage", label: "Anchor reference images", modality: "image", help: "Reference sheets for characters/places/objects." },
  { id: "pageIllustration", label: "Page illustrations", modality: "image", help: "The illustration for each page or spread." },
  { id: "coverIllustration", label: "Cover illustrations", modality: "image", help: "Front/back cover artwork." },
];

export const ALL_TEXT_ACTION_IDS = TEXT_ACTIONS.map((a) => a.id);
export const ALL_IMAGE_ACTION_IDS = IMAGE_ACTIONS.map((a) => a.id);
