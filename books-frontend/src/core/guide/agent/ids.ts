/**
 * Every skill the Chat can run, by id.
 *
 * A closed list on purpose: the interpreter may only name these, the admin
 * toggles these, the turn log counts these, and `guide-agent-invariants.ts`
 * fails when one of them has no definition, no example or no help line.
 * Adding a skill is one id here and one definition in `commands/`.
 */
export const GUIDE_COMMAND_IDS = [
  // How the story starts
  "chooseEntry",
  // Book details
  "setTitle",
  "setSubtitle",
  "setAuthor",
  "confirmCoverWords",
  "changeCoverWords",
  "setBookLanguage",
  "decideHardcover",
  "changeBookSetup",
  // Story
  "draftStory",
  "reviseStory",
  "checkStory",
  "finishStory",
  // People
  "addPerson",
  "removePerson",
  "renamePerson",
  "setPersonAge",
  "setPersonKind",
  "setPersonRole",
  "setRelation",
  "describePerson",
  "choosePersonLook",
  "editPersonLook",
  "drawPortraits",
  "restorePicture",
  "confirmCast",
  "deletePhoto",
  // Places and things
  "describeAnchor",
  "excludeAnchor",
  // Look
  "setStyle",
  // Making the book
  "drawBook",
  // Account and Sparks
  "offerSparks",
  "signIn",
  // Conversation
  "openView",
  "undo",
  "skipField",
] as const;

export type GuideCommandId = (typeof GUIDE_COMMAND_IDS)[number];

export function isGuideCommandId(value: unknown): value is GuideCommandId {
  return typeof value === "string" && (GUIDE_COMMAND_IDS as readonly string[]).includes(value);
}
