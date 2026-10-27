/**
 * Putting the people a parent named into the book, by the same skill the parent could have asked for.
 *
 * Going through `addPerson` rather than writing the cast here means a person added this way is exactly one
 * added by hand: the same cap, the same de-duplication, the same marks for the age and look questions that
 * follow. Nothing is drawn and nothing is spent.
 */
import type { Project } from "../types";
import { GUIDE_COMMANDS } from "./agent/registry";
import type { CommandContext } from "./agent/types";
import type { MentionedPerson } from "./people";
import { statedAgeCalls } from "./statedAges";
import { foldName } from "./agent/resolve";

export interface AddedPeople {
  project: Project;
  /** The names that are in the book now because of this call. */
  names: string[];
}

/**
 * `message` is what the parent said: an age they gave in it ("her 5-year-old brother Leo") is kept with the
 * person, so nobody is asked for what was already told.
 */
export function addMentionedPeople(
  project: Project,
  people: readonly MentionedPerson[],
  ctx: CommandContext,
  message = "",
): AddedPeople {
  const add = GUIDE_COMMANDS.addPerson;
  let next = project;
  const names: string[] = [];
  for (const person of people) {
    const args: Record<string, string> = {
      name: person.name,
      ...(person.kind !== "person" ? { kind: person.kind } : {}),
      ...(person.species ? { species: person.species } : {}),
      ...(person.role === "friend" ? { role: "friend" } : {}),
    };
    const prepared = add.prepare ? add.prepare(args) : args;
    const result = add.run(next, prepared, ctx);
    if (result.kind !== "write") continue;
    next = result.project;
    names.push(person.name);
  }
  if (message.trim() && names.length > 0) {
    const setAge = GUIDE_COMMANDS.setPersonAge;
    const added = new Set(names.map(foldName));
    for (const call of statedAgeCalls(message, next, null, [])) {
      if (call.id !== "setPersonAge" || !added.has(foldName(call.args.person ?? ""))) continue;
      const result = setAge.run(next, setAge.prepare ? setAge.prepare(call.args) : call.args, ctx);
      if (result.kind === "write") next = result.project;
    }
  }
  return { project: next, names };
}
