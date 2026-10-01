/**
 * The one question to ask after a skill ran, read from the book.
 *
 * "Add Christopher" leaves Christopher without an age, so the guide asks for it
 * — not because the skill remembers a script, but because the book is missing
 * something portraits need. Who they are is asked once per person, never again
 * after an answer or a skip, and never when the reader already said it. How
 * they look is the character card, not a second question. What counts as
 * required is the admin's `people` policy.
 */
import type { GuidePeoplePolicy } from "../../config/guideAgent";
import type { Project } from "../../types";
import { authoringOf } from "../projectState";
import { CAST_KIND_SPECS, castKindOf, missingDetails } from "../../story/castKinds";
import { castOf } from "./resolve";
import type { Beat } from "./types";
import { beat } from "./commands/shared";

export interface FollowUp {
  beat: Beat;
  /** The per-person field this asks, marked as asked once the line is said. */
  ask?: { personId: string; fields: ("age" | "role" | "look")[] };
  /** The skill a short reply most likely answers, for the interpreter. */
  expects: string;
}

/**
 * The next per-person question for the people this turn added or touched.
 * Null when nobody needs anything, or the policy says not to ask.
 */
export function personFollowUp(project: Project, policy: GuidePeoplePolicy, personIds: readonly string[]): FollowUp | null {
  if (personIds.length === 0) return null;
  const marks = new Set(authoringOf(project).personAsks ?? []);
  const people = castOf(project).filter((member) => personIds.includes(member.id));
  if (policy.age.askWhen === "now") {
    const missing = people.filter((member) => missingDetails(member).includes("age"));
    if (missing.length > 0) {
      const names = missing.map((member) => member.name.trim());
      return {
        beat: beat(names.length > 1 ? "missingAgesMany" : "missingAges", { names }, { priority: "question", mustSay: names }),
        ask: { personId: missing[0]!.id, fields: ["age"] },
        expects: `setPersonAge for ${names.join(", ")}`,
      };
    }
    const unknownKind = people.find((member) => missingDetails(member).includes("species"));
    if (unknownKind) {
      const name = unknownKind.name.trim();
      return {
        beat: beat(
          "missingKind",
          { names: name, what: CAST_KIND_SPECS[castKindOf(unknownKind)].noun },
          { priority: "question", mustSay: [name] },
        ),
        ask: { personId: unknownKind.id, fields: ["age"] },
        expects: `setPersonKind for ${name}`,
      };
    }
  }
  for (const member of people) {
    const roleOpen =
      policy.role.askWhen === "once" && !member.role?.trim() && !marks.has(`${member.id}:role`);
    if (roleOpen) {
      const name = member.name.trim();
      return {
        beat: beat("askPersonDetail", { names: name }, { priority: "question", mustSay: [name] }),
        ask: { personId: member.id, fields: ["role"] },
        expects: `setPersonRole for ${name}, or skipField`,
      };
    }
  }
  return null;
}

/** People added by this turn's steps (new ids in the cast). */
export function addedPeople(before: Project, after: Project): string[] {
  const had = new Set(castOf(before).map((member) => member.id));
  return castOf(after)
    .filter((member) => !had.has(member.id))
    .map((member) => member.id);
}
