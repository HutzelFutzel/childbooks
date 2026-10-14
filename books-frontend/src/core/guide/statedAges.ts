/**
 * An age the reader states plainly in a message is never lost.
 *
 * The interpreter reads every message and proposes the skills. This is the
 * backstop for the one fact a picture cannot recover from: "Amanda is 3 years
 * old" must set Amanda's age even when the reading only heard "redraw her".
 * Only unambiguous statements count (a number of years or months right beside
 * the name, or beside "she"/"he" while that person's picture is selected), and
 * an age the reading already set, or that the book already has, is left alone.
 */
import { briefOf } from "../story/brief";
import { isPerson } from "../story/castKinds";
import type { Project } from "../types";
import { ageStatements, statementAgrees } from "./ageSync";
import type { CommandCall } from "./agent/types";
import { foldName } from "./agent/resolve";
import { currentPortrait } from "./portrait";
import { asksForRedraw } from "./redrawMode";

const PRONOUNS = ["she", "he", "sie", "er"];

/** "Amanda's 3 years old" reads as "Amanda is 3 years old". */
function expandContractions(text: string): string {
  return text.replace(/(\p{L})['’]s\s+(?=\d|(?:\p{L}+[\s-]+(?:years?|months?)\b))/gu, "$1 is ");
}

function namedIn(call: CommandCall): string {
  return foldName(call.args.person ?? call.args.name ?? "");
}

/**
 * The skill calls to add in front of the reading's own: `setPersonAge` for each
 * plainly stated age the reading missed, and, when the message also asks for
 * the picture again, a new picture of that person after it.
 */
export function statedAgeCalls(
  message: string,
  project: Project,
  selected: { castId: string; name: string } | null,
  calls: readonly CommandCall[],
): CommandCall[] {
  const people = (briefOf(project.config).cast ?? []).filter((member) => member.name.trim() && isPerson(member));
  if (people.length === 0) return [];
  const text = expandContractions(message.toLowerCase());
  const names = people.map((member) => member.name.trim().toLowerCase());
  const statements = ageStatements(text, selected ? [...names, ...PRONOUNS] : names, "adjacent");
  const added: CommandCall[] = [];
  const redrawn: string[] = [];
  for (const statement of statements) {
    const member = PRONOUNS.includes(statement.name)
      ? people.find((candidate) => candidate.id === selected?.castId)
      : people.find((candidate) => foldName(candidate.name) === foldName(statement.name));
    if (!member) continue;
    const key = foldName(member.name);
    const age = { age: member.age, ageMonths: member.ageMonths };
    if ((age.age !== undefined || age.ageMonths !== undefined) && statementAgrees(statement, age)) continue;
    const covered = calls.some(
      (call) =>
        (call.id === "setPersonAge" || call.id === "addPerson") &&
        (namedIn(call) === key || (!namedIn(call) && selected?.castId === member.id)),
    );
    if (covered || added.some((call) => namedIn(call) === key)) continue;
    added.push({
      id: "setPersonAge",
      args: { person: member.name.trim(), age: statement.unit === "months" ? `${statement.value} months` : `${statement.value}` },
      evidence: text.slice(statement.start, statement.end) || message,
      confidence: 1,
      source: "model",
    });
    redrawn.push(member.id);
  }
  if (added.length === 0 || !asksForRedraw(message)) return added;
  for (const id of redrawn) {
    const member = people.find((candidate) => candidate.id === id)!;
    const key = foldName(member.name);
    const drawsAlready = calls.some(
      (call) => (call.id === "editPersonLook" || call.id === "describePerson") && (namedIn(call) === key || !namedIn(call)),
    );
    if (drawsAlready || !currentPortrait(project, id)) continue;
    added.push({
      id: "editPersonLook",
      args: { person: member.name.trim(), change: message, mode: "new" },
      evidence: message,
      confidence: 1,
      source: "model",
    });
  }
  return added;
}
