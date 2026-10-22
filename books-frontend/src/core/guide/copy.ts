/**
 * The Chat's configured wording.
 *
 * Two kinds of text live here and are treated differently:
 *
 *   - **Lines** are what the guide says. The configured sentence is the meaning;
 *     in a chat language other than the configured one the model phrases it
 *     (`guideSpeak`), keeping names exactly as typed.
 *   - **Labels** are trusted controls. They never depend on model output; an
 *     admin override applies to the configured language and every other
 *     language reads the application's localization catalog.
 *
 * `{names}`, `{n}`, `{sparks}`, `{price}`, `{count}`, `{shape}`, `{min}`,
 * `{language}` and `{what}` are the only placeholders, filled by
 * {@link fillGuideCopy}.
 */
import { z } from "zod";

export const GUIDE_LINE_KEYS = [
  "sparksNotice",
  "opening",
  "broadQuestion",
  "drawThem",
  "storyStarting",
  "storyReady",
  "storyFailed",
  "firstPortrait",
  "portraitsReady",
  "portraitsAllReady",
  "portraitsFailed",
  "lookReady",
  "languageNote",
  "readingAgeNote",
  "missingNames",
  "missingAges",
  "missingAgesMany",
  "missingKind",
  "kindSet",
  "relationSet",
  "askLookAlike",
  "hardcoverSpread",
  "hardcoverShort",
  "ownWordsOpen",
  "askStoryDone",
  "storyHandedOver",
  "pagesStarted",
  "pagesDone",
  "welcomeBack",
  "whichName",
  "castFix",
  "pageAttention",
  "coverAttention",
  "pageKeepFailed",
  "pageFileMissing",
  "printReady",
  "accountFirst",
  "topUp",
  "awayStory",
  "awayPortraits",
  "awayPages",
  "redrawReady",
  "redrawStarting",
  "redrawNeedSparks",
  "pictureBack",
  "noEarlierPicture",
  "reply",
  "keptStory",
  "manuscriptAsk",
  "askPersonDetail",
  "personAdded",
  "personRemoved",
  "personRenamed",
  "done",
  "confirmAsk",
  "confirmCancelled",
  "confirmExpired",
  "blocked",
  "lockedBlocked",
  "quoteReady",
  "sparksOffer",
  "notUnderstood",
  "tooMany",
  "answerFallback",
  "storyRevising",
  "revisionReady",
  "revisionKept",
  "revisionDiscarded",
  "revisionFailed",
  "revisionOutside",
  "markedScope",
  "markStale",
  "storyRedraft",
  "styleChanged",
  "undone",
  "nothingToUndo",
  "redone",
  "nothingToRedo",
  "undoConflict",
  "redoBlocked",
  "noSuchPage",
  "pageColorContrast",
  "pagesSkipped",
  "askWhichPage",
  "personNotInBook",
  "personNotOnPage",
  "leftAsIs",
  "openedView",
  "removeMentionsAsk",
  "cannotDoThat",
  "photoDeleted",
  "skipped",
  "askWhichStyle",
  "storyFit",
  "askName",
  "askNewName",
  "askWhatChange",
  "askText",
  "alreadyThat",
  "ageSet",
  "ageSetStory",
  "lookNoted",
  "placeExcluded",
  "castConfirmed",
  "languageTranslating",
  "languageTranslated",
  "languageRestored",
  "languageTranslateFailed",
  "askWhich",
  "briefOffer",
  "briefAsk",
  "briefMore",
  "ideaNotKept",
  "briefRewriteOffer",
  "askLook",
  "askFormat",
  "askLayout",
  "askCoverWords",
  "askPictureNotes",
  "pictureNotesSaved",
  "askCoverWordsOwn",
  "askCoverWordsFound",
  "coverWordsSet",
  "askDrawBook",
  "askDrawingOwner",
  "readFailed",
  "askBookUpdate",
  "askBookFinish",
  "bookUnfinished",
  "askBookPrepFix",
  "askPrintFix",
  "askPersonLook",
  "lookChoose",
  "lookPhotoAdded",
  "lookDrawingAdded",
  "lookDrawingStyle",
  "lookFromStory",
  "looksFromStory",
  "lookOnPlate",
  "portraitsStarting",
  "portraitsNeedSparks",
  "portraitsPriceChanged",
  "portraitsNotStarted",
  "portraitsRestyle",
  "portraitsStale",
  "oldLookKept",
  "readingAgeAsk",
  "readingAgeAskMonths",
  "readingAgeKept",
  "readingAgeChanged",
  "readingAgeAskOwn",
  "readingAgeAskOwnEarly",
  "readingAgeAskOwnFromAge",
  "readingAgeAskOwnDiffer",
  "readingAgeSkipOwn",
  "readingAgeKeptOwn",
  "readingAgeSetOwn",
  "castAgesAsk",
  "castAgesAskMany",
  "agesSet",
] as const;

export const GUIDE_LABEL_KEYS = [
  "guideMe",
  "ownWords",
  "foundCast",
  "foundPlaces",
  "editPeople",
  "drawPortraits",
  "drawBook",
  "createIllustratedBook",
  "tryStoryAgain",
  "redrawPage",
  "redrawTarget",
  "orderBook",
  "createAccount",
  "buyPack",
  "seeAll",
  "skip",
  "spreadIt",
  "keepShort",
  "tryAgain",
  "deletePhoto",
  "useMyStory",
  "useAsIdea",
  "reviewPeople",
  "confirmYes",
  "cancel",
  "undoBoth",
  "undoOnlyThis",
  "rewriteWithout",
  "keepStoryAsIs",
  "showMe",
  "tryThis",
  "writeStory",
  "lookAlikeYes",
  "lookAlikeNo",
  "coverLooksGood",
  "storyIsReady",
  "keepPictureNotes",
] as const;

export type GuideLineKey = (typeof GUIDE_LINE_KEYS)[number];
export type GuideLabelKey = (typeof GUIDE_LABEL_KEYS)[number];
export type GuideCopyKey = GuideLineKey | GuideLabelKey;

export const DEFAULT_GUIDE_COPY: Record<GuideCopyKey, string> = {
  sparksNotice: "Image generation uses Sparks. You'll see the exact price before anything is drawn.",
  opening: "Hi! Let's make a storybook together. Should I help you write the story, or did you already write one?",
  broadQuestion: "Who should be in the story, and what should happen?",
  drawThem: "Next, I'll draw {names} in this look. Tap the button when you're ready.",
  storyStarting: "That's everything I need—I'm drafting the story now.",
  storyReady: "Your story is ready. Have a read.",
  storyFailed: "The draft didn't come through. The page is as it was.",
  firstPortrait: "{names}'s portrait is ready.",
  portraitsReady: "The portraits of {names} are ready.",
  portraitsAllReady: "Everyone's portraits are ready.",
  portraitsFailed: "{names} didn't come out this time.",
  lookReady: "This drawing now sets the look of the whole book.",
  languageNote: "I'll write the story in {language}.",
  readingAgeNote: "{names} is {n}, so I'll pitch the words at that age.",
  missingNames: "Who should be in the story?",
  missingAges: "How old is {names}?",
  missingAgesMany: "How old are {names}?",
  missingKind: "What kind of {what} is {names}?",
  kindSet: "Got it—{names} is {what}.",
  relationSet: "Got it—{what}",
  askLookAlike: "Do {names} look alike?",
  hardcoverSpread: "I'll spread it over {count} pages, so a hardcover is possible.",
  hardcoverShort:
    "The story fills {count} pages, and a hardcover needs at least {min}. Should I spread it over {min} pages for a hardcover, or keep {count} pages as a softcover?",
  ownWordsOpen: "Write or paste your story on the page. Take your time, and tap My story is ready when it's done.",
  askStoryDone: "Tap My story is ready when it's done, and I'll take it from there.",
  storyHandedOver: "Thanks! I'm reading it now.",
  pagesStarted: "I'm drawing your book now. It usually takes {what}. I'll email you when it's done.",
  pagesDone: "Every page is drawn.",
  welcomeBack: "Welcome back.",
  whichName: "Which one should change?",
  castFix: "A couple of names need a quick look before I draw anyone.",
  pageAttention: "Page {n} needs another go.",
  coverAttention: "The cover needs another go.",
  pageKeepFailed:
    "I couldn't change just that on page {n} without touching the rest, so I left the page as it was. I can draw it again from scratch instead.",
  pageFileMissing:
    "The saved picture for page {n} is missing, so I couldn't change it. I can draw the page again from scratch instead.",
  printReady: "It's ready to print.",
  accountFirst: "Create an account first so this book is saved to you. You'll come straight back here.",
  topUp: "That needs a few more Sparks than you have.",
  awayStory: "Your story is ready.",
  awayPortraits: "While you were away, I finished drawing {names}.",
  awayPages: "{count} pages need attention.",
  redrawReady: "Got it. Tap redraw when you're ready.",
  redrawStarting: "Redrawing {names} now. The earlier picture stays, so you can go back to it.",
  redrawNeedSparks: "Redrawing {names} needs more Sparks than you have right now. Get more, then tap the button below.",
  pictureBack: "Okay, {names} is back to the earlier picture.",
  noEarlierPicture: "There's no earlier picture to go back to.",
  reply: "Okay.",
  keptStory: "I'll use this as your story.",
  manuscriptAsk: "Is this the finished story, or the idea for one?",
  askPersonDetail: "Anything I should know about {names}—who they are in the story? You can skip this.",
  personAdded: "{names} is in the book now.",
  personRemoved: "{names} is out of the book.",
  personRenamed: "Done—it's {names} now.",
  done: "Done.",
  confirmAsk: "Before I do that, here's what changes. Should I go ahead?",
  confirmCancelled: "Okay, I left everything as it is.",
  confirmExpired: "That's changed since you asked, so I didn't do it. Ask again if you still want it.",
  blocked: "That needs something first: {what}",
  lockedBlocked:
    "The pages are already drawn, so the people, the story and the look are fixed now. To change a picture, select its page (or name it) and tell me what should look different.",
  quoteReady: "Ready when you are—tap the button to start.",
  sparksOffer: "Here's where you can get more Sparks.",
  notUnderstood: "I didn't quite catch that. Could you say it another way?",
  tooMany: "I took care of the first {count}. Send me the rest one at a time.",
  answerFallback: "I'm not sure about that one. Could you ask it another way?",
  storyRevising: "I'm reworking the story. You'll get to keep or drop each change.",
  revisionReady: "The changes are marked in the story. Keep the ones you like and drop the rest.",
  revisionKept: "Done. The story has the changes you kept.",
  revisionDiscarded: "Okay, the story stays as it was.",
  revisionFailed: "I couldn't prepare those changes, and the story is untouched. Try asking a different way, or say what to add and where.",
  revisionOutside: "That needs text outside the part you marked, so I left the story as it is. Clear the mark, or ask for something inside it.",
  markedScope: "You've marked part of the story, so I only change that part. Clear the mark to change the rest.",
  markStale: "The part you marked has changed since, so I left the story alone. Mark it again and tell me once more.",
  storyRedraft: "Writing a fresh draft now.",
  styleChanged: "The book now uses the {what} look.",
  undone: "Undone.",
  nothingToUndo: "There's nothing to undo right now.",
  redone: "Back in place.",
  nothingToRedo: "There's nothing to redo right now.",
  pageColorContrast: "Done, but the words may be hard to read on that color. You can ask me to change the text color too.",
  noSuchPage: "The book doesn't have {what}. It has {count} pages.",
  pagesSkipped: "The book doesn't have {what}, so I left it out.",
  askWhichPage: "Which page should I change?",
  personNotInBook: "I don't see {names} in your book, so I can't copy how they look. Should I draw them anyway, as a new face?",
  personNotOnPage: "{names} isn't drawn on page {n} yet. Should I add them there first?",
  leftAsIs: "Okay, I left it as it is.",
  redoBlocked: "That can't be put back on its own: {what} changed again since. You can ask for it again.",
  undoConflict: "{what} changed again after that, so undoing it could take newer changes back too. How should I handle it?",
  openedView: "It's open on the right.",
  removeMentionsAsk: "{names} is part of the story. Should I rewrite the story without them, or keep the story as it is?",
  cannotDoThat: "I can't do that one yet.",
  photoDeleted: "The photo is deleted.",
  skipped: "No problem, we'll skip that.",
  askWhichStyle: "Which look should the book have?",
  storyFit: "{what}",
  askName: "What's their name?",
  askNewName: "What should the new name be?",
  askWhatChange: "What should change?",
  askText: "What should it say?",
  alreadyThat: "It's already that way.",
  ageSet: "Got it—{names} is {n}.",
  ageSetStory: "Got it—{names} is {n}. The story said something different, so I'm updating it to match. You'll see each change before it lands.",
  lookNoted: "Got it—I'll draw {names} that way.",
  placeExcluded: "{names} won't be drawn.",
  castConfirmed: "Great, that's everyone.",
  languageTranslating: "I'm translating the story into {language}. Everyone and everything in it stays the same.",
  languageTranslated: "The story is now in {language}. The people, the plot and the tone are the same.",
  languageRestored: "The story is back in {language}, the way it was written. Nothing needed translating.",
  languageTranslateFailed: "The translation didn't come through, and the story is as it was. Try again in a moment.",
  askWhich: "Which one do you mean?",
  briefOffer:
    "Anything else I should know first, like a nickname or something funny from home? Tell me, pick something below, or just say go and I'll start writing.",
  briefAsk: "{what}",
  briefMore: "Anything else, or should I start writing?",
  ideaNotKept: "I couldn't quite keep that idea for the story. Could you say it again in a few words?",
  briefRewriteOffer: "Noted. Want me to rewrite the story with that? It replaces the current draft.",
  askLook: "How should the book look? Pick the style you like best.",
  askFormat: "What shape and size should the book be?",
  askLayout: "How should the words and pictures share each page?",
  askPictureNotes:
    "Anything the pictures should know that the story doesn't say? The season, a place, a favorite toy. You can skip this.",
  agesSet: "Got it—I'll draw {names} at those ages.",
  castAgesAsk: "How old is {names}? I need that before I draw them.",
  castAgesAskMany: "How old are {names}? I need that before I draw them.",
  pictureNotesSaved: "Thanks, I'll keep that in mind for the pictures. It won't be printed.",
  askCoverWords: "Here's what the cover will say. Want a subtitle or an author's name on it too?",
  askCoverWordsOwn: "Here's what the cover will say. It's your story: want your name on it, or a subtitle?",
  askCoverWordsFound: "I took the cover's words from the top of your story. Is that how it should read?",
  coverWordsSet: "Lovely, that's what the cover will say.",
  askDrawBook: "Everything's ready. Here's what goes into the book. Tap the button to draw it.",
  askDrawingOwner: "Who is shown in this drawing?",
  readFailed: "I couldn't finish reading the story. Your words are safe. Want me to try again?",
  askBookUpdate: "Some pictures no longer match the book. Want me to update them?",
  askBookFinish: "A few pictures still need drawing. Want me to finish them?",
  bookUnfinished: "I couldn't finish every picture. Nothing was charged for the ones that didn't come out.",
  askBookPrepFix: "Something went wrong while getting the book ready. Want me to try again?",
  askPrintFix: "One thing needs fixing before the book can print.",
  askPersonLook: "How should {names} look in the book?",
  lookChoose: "Sure. Choose it below, and I'll draw {names} from it.",
  lookPhotoAdded: "Thanks. I'll draw {names} from the photo, then delete it.",
  lookDrawingAdded: "Lovely. I'll draw {names} like the drawing.",
  lookDrawingStyle:
    "Lovely. I'll draw {names} like the drawing, and the whole book in the same style. That style is {names}'s drawing now. Choosing another style on the Style tab takes the drawing off the book.",
  lookFromStory: "Okay, I'll imagine {names} from the story.",
  looksFromStory: "Okay, I'll imagine everyone from the story.",
  lookOnPlate: "Select {names} in the cast. The choices open in the chat.",
  portraitsStarting: "I'm drawing {names} now. It takes a minute or two.",
  portraitsNeedSparks: "Drawing {names} needs more Sparks than you have right now. Get more, then tap the button below.",
  portraitsPriceChanged: "The price for {names} came out different from what I showed, so I didn't start. The button below has the exact price.",
  portraitsNotStarted: "I couldn't start {names} just now. Tap the button below to try again.",
  portraitsRestyle:
    "The look changed, so {names} no longer match it. Redraw them in the new look, or keep the old one.",
  portraitsStale: "{names} no longer match the book. Redraw them to bring the pictures up to date.",
  oldLookKept: "Okay, the old look is back. {names} stay as they are.",
  readingAgeAsk:
    "{names} is {n}, so I'll write the story for children aged {what}. Is that right, or should it be for another age?",
  readingAgeAskMonths:
    "{names} is {n} months old, so I'll write the story for children aged {what}. Is that right, or should it be for another age?",
  readingAgeKept: "Great, I'll write it for children aged {what}.",
  readingAgeChanged: "Got it, I'll write it for children aged {what}.",
  readingAgeAskOwn:
    "Who's the book for? I'd set the pages for children aged {what}: how many words go on each page, and how big. Is that right, or is it for another age?",
  readingAgeAskOwnEarly:
    "Who's this book for? I'll set the pages for children aged {what}: how many words go on each page, and how big. Pick another age, or skip. You can change it on the story.",
  readingAgeAskOwnFromAge:
    "{names} is {n}, so I'll set the pages for children aged {what}. Is that right, or is it for another age?",
  readingAgeAskOwnDiffer:
    "{names} is {n}, so I'd set the pages for children aged {what} instead. Should I?",
  readingAgeSkipOwn: "Okay, I'll set the pages for children aged {what}. You can change that on the story.",
  readingAgeKeptOwn: "I'll keep the pages for children aged {what}.",
  readingAgeSetOwn:
    "Got it, I'll set the pages for children aged {what}. Your words stay exactly as you wrote them. If you'd like a second opinion on how it reads at that age, there's a check on the Story tab.",

  guideMe: "Guide me",
  ownWords: "I'll use my own words",
  foundCast: "Found {names}",
  foundPlaces: "Places: {names}",
  editPeople: "Edit characters",
  drawPortraits: "Draw {names} in this look",
  drawBook: "Draw the book",
  createIllustratedBook: "Create illustrated book",
  tryStoryAgain: "Try the story again",
  redrawPage: "Redraw this page",
  redrawTarget: "Redraw {names}",
  orderBook: "Order the book",
  createAccount: "Create an account",
  buyPack: "Get Sparks",
  seeAll: "See all",
  skip: "Skip",
  spreadIt: "Spread it",
  keepShort: "Keep it short",
  tryAgain: "Try again",
  deletePhoto: "Delete now",
  useMyStory: "Use my story",
  useAsIdea: "Use it as the idea",
  reviewPeople: "Review",
  confirmYes: "Yes, do it",
  cancel: "Cancel",
  undoBoth: "Undo both",
  undoOnlyThis: "Undo only that one",
  rewriteWithout: "Rewrite the story without them",
  keepStoryAsIs: "Keep the story as it is",
  showMe: "Show me",
  tryThis: "Try this",
  writeStory: "Write the story",
  lookAlikeYes: "They look alike",
  lookAlikeNo: "They look different",
  coverLooksGood: "Looks good",
  storyIsReady: "My story is ready",
  keepPictureNotes: "Keep for the pictures",
};

/** Keys whose text the admin may override, with a short description for the editor. */
export const GUIDE_COPY_HELP: Partial<Record<GuideCopyKey, string>> = {
  sparksNotice: "Shown once, before the opening line of a new book. Information, not approval.",
  opening: "The opening invitation before the parent chooses between guided and their own words.",
  broadQuestion: "The first question after the parent chooses Guide me.",
  drawThem:
    "Said right before the portrait button, which only appears when portraits couldn't start on their own (a new price, too few Sparks, a failed portrait, or a style chosen by typing). {names} are the people it draws.",
  storyStarting: "Said when the last fact lands and the draft is queued.",
  storyReady: "Said when the draft is on the page.",
  guideMe: "Opening choice.",
  ownWords: "Opening choice.",
  foundCast: "Receipt after own-words extraction.",
  ownWordsOpen:
    "Said when the parent chooses to use their own words. Nothing is read or asked until they tap My story is ready, so keep it about writing at their own pace.",
  askStoryDone: "Said right before the My story is ready button, when the conversation moved on while the parent was still writing.",
  storyHandedOver: "Said after the parent taps My story is ready, while the guide reads who is in it.",
  storyIsReady: "The button that hands an own-words story over. It waits in the conversation until the parent stops writing.",
  keepPictureNotes: "The button under the optional note for the pictures, after the guide read a story the reader wrote.",
  drawBook: "The Continue button after the story.",
  askPersonDetail:
    "Optional follow-up after a person is added, asking who they are. How they look is the character card, not this question.",
  confirmAsk: "Said above a confirmation card. The card itself lists exactly what changes, in trusted text.",
  blocked: "Said when a request needs something first. {what} is the missing step, written by the app.",
  lockedBlocked: "Said when the reader asks for a change to the people, the story or the look after the pages are drawn.",
  notUnderstood: "Said when nothing in a message could be read safely.",
  answerFallback: "Said when a question can't be answered from the help articles or the book.",
  removeMentionsAsk: "Asked when a removed person still appears in the story text.",
  confirmYes: "Button on a confirmation card.",
  redone: "Said after a change that was undone is put back.",
  nothingToRedo: "Said when the parent asks to redo but nothing was undone.",
  pageColorContrast: "Said after a page color change that leaves the printed words with weak contrast.",
  noSuchPage: "Said when the parent names a page the book does not have (and no other page). {what} is the page, {count} is how many pages the book has.",
  pagesSkipped: "Added after a change when some of the pages the parent named do not exist. {what} names them.",
  askWhichPage: "Said right before the page buttons when a picture change was meant for the pages in view but not for one of them in particular.",
  personNotInBook: "Said right before the button that draws a picture anyway when the parent asked to add somebody the book does not have. {names} is who.",
  personNotOnPage:
    "Said right before three buttons (add them, they're already there, leave it) when a change speaks of somebody's hand, hair or the like and that person is not on the page. {names} is who, {n} the page. Keep it a question.",
  leftAsIs: "Said when the parent chose to leave a picture as it is instead of changing it.",
  redoBlocked: "Said when a change that was undone can't be put back because the same place changed since. {what} names the pages.",
  undoConflict: "Said above the card that appears when an older change is undone but something newer touched the same page. {what} names the pages.",
  undoBoth: "Button on the undo-conflict card: take back the newer change too.",
  undoOnlyThis: "Button on the undo-conflict card: take back only the older change.",
  cancel: "Button on a confirmation card.",
  tryThis: "Accessible label for suggestion chips.",
  storyFit: "Said after a story check, above its card. {what} is the check's own headline, written by the story checker.",
  revisionReady: "Said when the changes the guide prepared for the story are ready to review in the story.",
  revisionKept: "Said after the parent keeps some or all of the prepared changes.",
  revisionDiscarded: "Said after the parent discards all of the prepared changes.",
  revisionFailed: "Said when preparing a change to the story failed, so the parent is not left waiting. The story is untouched.",
  revisionOutside: "Said when a request about a marked passage needed text outside it. Nothing changed.",
  markedScope: "Said when the parent has a passage marked but asks about the whole story. Nothing changes; the mark stays until they clear it.",
  markStale: "Said when the marked passage was edited between marking and sending, so the request was not run. Never widened to the whole story.",
  ageSet: "Said after an age is set in chat. {names} is the person, {n} the age.",
  ageSetStory: "Said after an age is set in chat when the story stated another age for that person, so the story is being revised to match. {names} is the person, {n} the age.",
  missingKind: "Asked when an animal, toy or creature has no kind yet. {what} is animal, toy or creature; {names} the character.",
  kindSet: "Said after the parent says what a character is. {what} is what they are, like \"a golden retriever\".",
  relationSet: "Said after the parent says how characters belong together. {what} is the sentence the app wrote, like \"Myla and Shilo are twins.\"",
  askLookAlike: "Asked with two buttons (alike, different) when twins are in the book. {names} are the twins.",
  lookNoted: "Said when a look change is saved before any portrait exists.",
  languageTranslating: "Said when the story is being translated into another language after it was written. The people, plot and tone do not change.",
  languageTranslated: "Said when the translated story is in place. The reader can take it back with Undo.",
  languageRestored: "Said when the story is put back into a language it was already written in, with no translation needed. The reader can take it back with Undo.",
  languageTranslateFailed: "Said when translating the story failed. The story is untouched.",
  tooMany: "Said when a message asked for more than the per-message limit. {count} is how many were done.",
  personAdded: "Said after a person is added in chat.",
  styleChanged: "Said after the look changes in chat. {what} is the style's name.",
  briefOffer:
    "Said once when the story card appears, before anything is written. Only used when Story options is set to wait for the parent.",
  briefAsk: "A story question set to Ask in Story options. {what} is that detail's question, written by the app.",
  briefMore: "Said after the parent adds a story detail while the story card is open.",
  ideaNotKept: "Said when the parent told the guide what the story is about but it could not be saved. Nothing is written until they answer.",
  briefRewriteOffer: "Said with a confirmation card when the parent adds a story detail after the story is written.",
  writeStory: "The button on the story card that starts the draft.",
  askLook: "Said right before the style picker, once the story is written and everyone's look is settled.",
  askPersonLook:
    "Said right before the card that asks where one person's look comes from (photo, drawing, description or the story). {names} is that person.",
  lookChoose: "Said when the parent asks in words to use a photo or drawing: the card below opens that option. {names} is the person.",
  lookPhotoAdded: "Said after a photo is added from the chat. {names} is the person.",
  lookDrawingAdded: "Said after a drawing is added from the chat while the book already has a style. {names} is the person.",
  lookDrawingStyle: "Said after a person's drawing also set the whole book's style, so the style picker is skipped. {names} is the person; the Style tab names them as the style's source.",
  lookFromStory: "Said after the parent lets the story decide how one person looks. {names} is the person.",
  looksFromStory: "Said after the parent lets the story decide for everyone.",
  lookOnPlate: "Said when someone's look is already settled and the parent wants a different source. {names} is the person. The choices open in the chat when that person is selected.",
  portraitsStarting:
    "Said when choosing a style or someone's look started their portraits at the price shown on that choice. {names} are the people drawn.",
  askFormat: "Said right before the book shape and size choice.",
  askLayout: "Said right before the page layout choice.",
  askPictureNotes:
    "Said once after the guide read a story the reader wrote, right before an optional note for the pictures (with Skip). Season, place and toys — not how someone looks; that is the character card.",
  agesSet: "Said after the reader confirms ages the story never stated. {names} are those people.",
  castAgesAsk: "Asked before any portrait when nobody has given or estimated one person's age. {names} is that person.",
  castAgesAskMany: "The same question for several people. {names} are those people.",
  pictureNotesSaved: "Said after the reader gave notes for the pictures. The notes steer the page plan and are never printed.",
  askCoverWords:
    "Said right before the cover card, after the book's size and layout: the story's title with subtitle and author ideas. Both are optional; the card has Looks good.",
  askCoverWordsOwn:
    "Said right before the cover card when the reader wrote the story themselves: their own name is the first author idea.",
  askCoverWordsFound:
    "Said right before the cover card when the title (and maybe subtitle and author) were read from the top of the reader's own story.",
  coverWordsSet: "Said when the reader settles the cover's words by typing instead of tapping Looks good.",
  accountFirst: "Said right before the sign-in card, when a paid step needs an account.",
  castFix: "Said right before the card for fixing names the guide couldn't sort out.",
  manuscriptAsk: "Said right before the buttons that ask whether pasted text is the story or an idea.",
  whichName: "Said right before the buttons for picking which person a change is about.",
  redrawReady: "Said right before the redraw button, after the parent described a change to a picture.",
  redrawStarting:
    "Said when a picture change the parent typed started drawing on its own. {names} is the person, page or cover. Never state a price.",
  redrawNeedSparks:
    "Said right before the redraw button when the parent's picture change couldn't start because the balance is too low. {names} is the person, page or cover. Never state a price.",
  pictureBack:
    "Said after the parent went back to an earlier picture of {names} (a person, page or cover) from the history.",
  noEarlierPicture:
    "Said when the parent asked to go back to an earlier picture but there is none (only one version exists, or this is already the earliest).",
  sparksOffer: "Said right before the card for getting more Sparks.",
  pagesStarted:
    "Said when drawing the book starts. {what} is how long it usually takes. The email goes out on its own.",
  askDrawBook: "Said right before the summary and the Create illustrated book button.",
  askDrawingOwner: "Said right before the buttons that assign an uploaded drawing to a person.",
  readFailed: "Said right before the retry button when reading a pasted story failed.",
  askBookUpdate: "Said right before the button that redraws pictures that no longer match the book.",
  askBookFinish: "Said right before the button that draws the pictures a run left undrawn.",
  bookUnfinished:
    "Said when the book job has finished and some pictures still could not be drawn. There is no button: the server already retried, and nothing was charged for them.",
  askBookPrepFix: "Said right before the retry button when preparing people or places failed.",
  askPrintFix: "Said right before the button that opens a page with a print problem.",
  pageAttention: "Said right before the retry button for a page that failed. {n} is the page.",
  coverAttention: "Said right before the retry button when a redraw of a cover failed.",
  pageKeepFailed:
    "Said instead of the line above when a small change could not be made in place and the page was left as it was. {n} is the page. The button then draws the page again from scratch.",
  pageFileMissing:
    "Said instead of the line above when the page's saved picture file is gone, so no change could be made to it. {n} is the page. The button then draws the page again from scratch.",
  printReady: "Said right before the order button, after every page is drawn.",
  hardcoverShort:
    "Said right before the hardcover-or-softcover choice when a story is too short for a hardcover. {count} is the story's pages, {min} the hardcover minimum. Keep it a question: the two buttons sit directly under it.",
  portraitsNeedSparks:
    "Said with the portrait button when choosing a style or look didn't start the portraits because the balance is too low. {names} are the people. Never state a price.",
  portraitsPriceChanged:
    "Said with the portrait button when the real price came out above the one shown on the choice, so nothing started. {names} are the people.",
  portraitsNotStarted:
    "Said with the portrait button when the portraits couldn't be started from a choice (no price, or the start failed). {names} are the people.",
  portraitsRestyle:
    "Said with the redraw card right after the book's look changed while portraits were already drawn. The card has Redraw and Keep the old look. {names} are the people whose portraits are out of date. Never state a price.",
  portraitsStale:
    "Said with the redraw card when portraits are out of date for a reason other than the look (an age or a description changed). {names} are the people. Never state a price.",
  oldLookKept:
    "Said after the reader chose to keep the old look: the portraits are current again at no cost. {names} are the people whose portraits stay.",
  readingAgeAsk:
    "Asked before the story is written, with a Yes button and the other age groups. {names} is the first child, {n} their age, {what} the age group the story is written for.",
  readingAgeAskMonths: "The same question for a child under two, with {n} in months.",
  readingAgeKept: "Said when the parent confirms the suggested age group. {what} is the age group.",
  readingAgeChanged: "Said when the parent picks or types another age group. {what} is the age group.",
  readingAgeAskOwn:
    "Own words fallback when no child and no age group can be named. {what} is the book's current group.",
  readingAgeAskOwnEarly:
    "Own words, before the story is finished, or when it states no age. Optional: Skip keeps the current group. {what} is that group. The story toolbar can change it later.",
  readingAgeAskOwnFromAge:
    "Own words, once a child's age was stated and the reader has not picked a group yet. {names} is the child, {n} their age, {what} the group that age falls in.",
  readingAgeAskOwnDiffer:
    "Own words, once, when a stated age falls in a different group from the one already chosen. {names} is the child, {n} their age, {what} the group the story points at.",
  readingAgeSkipOwn: "Said when the reader skips the optional age-group question. {what} is the group kept.",
  readingAgeKeptOwn: "Said when the reader keeps their chosen group instead of switching to the story's age. {what} is the group kept.",
  readingAgeSetOwn:
    "Own words: said once, when the parent picks the age group. {what} is the age group. Also points to the optional reading check on the Story tab, the only time it is mentioned.",
  storyFailed: "Said right before the retry button when the draft failed.",
};

export type GuideCopyOverrides = Partial<Record<GuideCopyKey, string>>;

export const guideCopySchema = z
  .record(z.string(), z.string().max(400))
  .transform((value) => normalizeGuideCopy(value));

const LEGACY_OPENING_WORDING =
  "Tell me who should be in this book and what you have in mind—or paste a story you've already written.";

export function normalizeGuideCopy(input: unknown): GuideCopyOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: GuideCopyOverrides = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(key in DEFAULT_GUIDE_COPY) || typeof value !== "string") continue;
    const text = value.trim().slice(0, 400);
    if (key === "opening" && text === LEGACY_OPENING_WORDING) continue;
    if (text && text !== DEFAULT_GUIDE_COPY[key as GuideCopyKey]) out[key as GuideCopyKey] = text;
  }
  return out;
}

export interface GuideCopyVars {
  names?: readonly string[] | string;
  n?: number | string;
  sparks?: string;
  price?: string;
  count?: number;
  shape?: string;
  min?: number;
  language?: string;
  what?: string;
}

/** "Maya", "Maya and Leo", "Maya, Leo and Sam". */
export function joinGuideNames(names: readonly string[], and = "and"): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

export function fillGuideCopy(text: string, vars: GuideCopyVars = {}): string {
  const names = Array.isArray(vars.names) ? joinGuideNames(vars.names) : (vars.names as string | undefined);
  return text.replace(/\{(names|n|sparks|price|count|shape|min|language|what)\}/g, (match, key: string) => {
    const value =
      key === "names" ? names : (vars as Record<string, unknown>)[key];
    return value === undefined || value === null || value === "" ? match : String(value);
  });
}

/** The configured meaning of one key, filled. */
export function guideCopy(
  overrides: GuideCopyOverrides | undefined,
  key: GuideCopyKey,
  vars?: GuideCopyVars,
): string {
  return fillGuideCopy(overrides?.[key] ?? DEFAULT_GUIDE_COPY[key], vars);
}

export function isGuideLineKey(key: string): key is GuideLineKey {
  return (GUIDE_LINE_KEYS as readonly string[]).includes(key);
}
