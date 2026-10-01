/**
 * A request to rename someone, however the interpreter filed it.
 *
 * "Change Arthur's name to Shiloh" is a rename, but a model sometimes calls it
 * a story edit, and a story edit rewrites the text alone: the cast card keeps
 * the old name and the book names the person two ways. A rename is exact and
 * its words are plain, so it is recognised here rather than trusted to the
 * model, and run as the rename skill. Anything not plainly a rename of someone
 * in the book is left as it was.
 */
import { castOf, resolvePerson } from "./resolve";
import type { Project } from "../../types";
import type { CommandCall } from "./types";

const WORD = "[\\p{L}][\\p{L}'’.-]*";
const FROM = `(${WORD}(?:\\s+${WORD})?)`;
const TO = `(${WORD}(?:\\s+${WORD}){0,2})`;
const POSSESSIVE = "(?:['’]s|s)?";

/** "…, everywhere", "…in the story too": said after the new name, and not part of it. */
const TAIL = /(?:\s+(?:please|instead|everywhere|throughout(?:\s+the\s+(?:book|story))?|in\s+(?:the|my)\s+(?:whole\s+)?(?:story|book)(?:\s+too|\s+as\s+well)?|too|as\s+well|überall|auch\s+in\s+der\s+geschichte))+$/iu;

/** Each pattern's groups are the old name (first) and the new one (last). */
const PATTERNS: RegExp[] = [
  new RegExp(`^(?:please\\s+)?(?:can\\s+you\\s+)?(?:change|update|switch)\\s+(?:the\\s+name\\s+of\\s+${FROM}|${FROM}${POSSESSIVE}\\s+name)\\s+(?:to|into)\\s+${TO}$`, "iu"),
  new RegExp(`^(?:please\\s+)?(?:can\\s+you\\s+)?rename\\s+${FROM}\\s+(?:to|as|into)\\s+${TO}$`, "iu"),
  new RegExp(`^(?:benenne|nenne)\\s+${FROM}\\s+(?:in|um\\s+in)\\s+${TO}(?:\\s+um)?$`, "iu"),
  new RegExp(`^(?:ändere|aendere)\\s+(?:den\\s+)?namen\\s+(?:von\\s+${FROM}|${FROM}s)\\s+(?:in|zu)\\s+${TO}$`, "iu"),
];

function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The old and new names a message plainly asks to swap, or null. */
export function renameRequest(project: Project, text: string): { person: string; newName: string } | null {
  const said = text
    .replace(/["“”„«»]/g, "")
    .replace(/[.!\s]+$/u, "")
    .replace(TAIL, "")
    .replace(/[.!\s]+$/u, "")
    .trim();
  if (!said) return null;

  const people = castOf(project);
  const found = (from: string) => {
    for (const candidate of [from, from.replace(/['’]?s$/iu, "")]) {
      const person = resolvePerson(project, candidate);
      if (person.kind === "one") return person.value.name.trim();
    }
    return null;
  };

  for (const pattern of PATTERNS) {
    const match = pattern.exec(said);
    if (!match) continue;
    const groups = match.slice(1).filter((group): group is string => Boolean(group));
    const newName = groups[groups.length - 1];
    const person = groups.length > 1 ? found(groups[0]!) : null;
    if (person && newName) return { person, newName };
  }

  // "Call Brian Bri instead": the old name is whoever the book already has.
  for (const member of people) {
    const name = member.name.trim();
    const call = new RegExp(`^call\\s+${escaped(name)}\\s+${TO}(?:\\s+instead)?$`, "iu").exec(said);
    if (call?.[1]) return { person: name, newName: call[1] };
  }
  return null;
}

/** The call, or the rename skill's call when the call is a story edit that only says "new name". */
export function rerouteRename(project: Project, call: CommandCall): CommandCall {
  if (call.id !== "reviseStory") return call;
  // The model's instruction first, then the reader's own words it quoted.
  const request = renameRequest(project, call.args.instruction ?? "") ?? renameRequest(project, call.evidence ?? "");
  if (!request) return call;
  return { ...call, id: "renamePerson", args: { person: request.person, newName: request.newName } };
}
