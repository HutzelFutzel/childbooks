/**
 * What the reader is doing on the Story tab.
 *
 * It never hides a card: a card the chat offers stays in view while the
 * reader writes or reviews, and a new one comes in under the last without
 * taking the cursor (`cardDeck.ts`). It only says whether the story can be
 * handed over right now.
 */
export type StoryFocus = "editing" | "reviewing";
