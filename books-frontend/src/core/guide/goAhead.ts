/**
 * A bare go-ahead: "go", "write the story", "surprise me", in the languages the
 * Chat speaks. Nothing in it says what the story is about, so it is never story
 * content. Shared by the story card's typed start and by the claim screen, so
 * "Write the story" can never be filed as the story's idea.
 */
const GO_AHEAD =
  /^(?:(?:ok(?:ay)?|yes|sure|great|perfect|fine)[,!. ]*)?(?:just |please )?(?:go(?: ahead)?|write (?:it|the story|my story|the book)|start(?: writing)?|surprise (?:me|us)|let'?s go|do it|los(?: geht'?s)?|schreib(?: sie| es)?(?: los)?|schreib (?:die|meine) geschichte|fang an|leg los)[.! ]*(?:please|bitte)?[.! ]*$/i;

/** Whether the whole text is only a go-ahead. */
export function isBareGoAhead(text: string): boolean {
  return GO_AHEAD.test(text.trim());
}
