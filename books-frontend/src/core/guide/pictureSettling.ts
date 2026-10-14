/**
 * Which pictures a typed message makes necessary, so the chat can draw them
 * without asking for a tap that only repeats the message.
 *
 * "Change Mia's age to 4" for a girl who was drawn at two leaves a portrait of
 * somebody else. Nothing about that is a decision: the portrait has to be
 * drawn again, and the reader already said why. This module finds those
 * people. Whether drawing is allowed (the price, the balance, a picture that
 * is already drawing) is `state/typedPictures`, the same gate every other
 * typed picture change goes through.
 *
 * Only a change of who somebody is counts: an age that looks different
 * (`visualAge`) or another kind of being (`identityChanged`). A role or a
 * description leaves a picture out of date too, but those say how somebody
 * looks and are asked for in their own words.
 */
import type { GuideCommandId } from "./agent/ids";
import type { Project, StoryCastMember } from "../types";
import { currentPortrait, likenessPhotosOf, portraitStatus, portraitSubjects } from "./portrait";
import { authoringOf } from "./projectState";
import { identityChanged } from "./redrawMode";

/**
 * Skills that choose how the pictures of the book or of a person are made: the
 * look of the book, where a person's look comes from, how they look. A choice
 * like these is what lets portraits be drawn, so it starts the portraits it
 * makes possible, as tapping the same choice in the chat does.
 */
export const PICTURE_CHOICE_COMMANDS: ReadonlySet<GuideCommandId> = new Set<GuideCommandId>([
  "setStyle",
  "describePerson",
  "choosePersonLook",
  "editPersonLook",
]);

/** The portrait was drawn from a photo that is gone, so a new one could not look like them. */
export function photoLikenessLost(project: Project, member: StoryCastMember): boolean {
  const image = currentPortrait(project, member.id);
  if (!image) return false;
  return image.inputs.sourceKey.startsWith('["photo"') && likenessPhotosOf(member).length === 0;
}

/**
 * People whose current portrait this turn made out of date by changing who they
 * are, and who can be drawn again as themselves. A person drawn from a photo
 * that has been used up is left to the reader: a portrait drawn anew from the
 * description alone would not look like the child in the photo.
 */
export function agedPortraits(before: Project, after: Project): { castId: string; name: string }[] {
  if (authoringOf(after).lockedAt) return [];
  return portraitSubjects(after)
    .filter(
      (member) =>
        portraitStatus(before, member.id) === "current" &&
        portraitStatus(after, member.id) === "stale" &&
        identityChanged(after, member.id) &&
        !photoLikenessLost(after, member),
    )
    .map((member) => ({ castId: member.id, name: member.name.trim() }));
}
