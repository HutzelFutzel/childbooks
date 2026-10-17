/**
 * Who a skill is about when the call does not say.
 *
 * With a person selected on the book, "make him 2 years old" is about them. The
 * interpreter is told who is selected and names them, but a call that leaves
 * `person` empty (it cannot name "him" in every language, and sometimes does
 * not try) still means the selected person, never "ask who" and never the only
 * person in the book by luck. This is the one place that fills it in, by id from
 * the chip, so no skill has to know about the selection and no pronoun list is
 * needed in any language.
 *
 * Only an EMPTY `person` is filled. A name that does not match anyone is a
 * different person the reader meant, and is asked about as before. And only
 * skills that change one person's details are aimed this way: removing someone
 * or deleting a photo must always be said by name.
 */
import type { Project } from "../../types";
import { castOf } from "./resolve";
import type { CommandArgs, CommandContext } from "./types";
import type { GuideCommandId } from "./ids";

/** Skills about one person's details that the selected person stands in for. */
export const AIMED_AT_SELECTION: ReadonlySet<GuideCommandId> = new Set<GuideCommandId>([
  "setPersonAge",
  "setPersonKind",
  "setPersonRole",
  "describePerson",
  "editPersonLook",
  "renamePerson",
]);

export function aimAtSelection(
  id: GuideCommandId,
  args: CommandArgs,
  project: Project,
  ctx: Pick<CommandContext, "chip">,
): CommandArgs {
  if (!AIMED_AT_SELECTION.has(id) || (args.person ?? "").trim()) return args;
  const chip = ctx.chip;
  if (chip?.kind !== "person") return args;
  const member = castOf(project).find((candidate) => candidate.id === chip.castId);
  return member ? { ...args, person: member.name.trim() } : args;
}
