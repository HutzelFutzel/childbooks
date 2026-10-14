/**
 * The skill catalog: every definition by id, plus the text the interpreter and
 * the help answers read about them. Both texts are generated from the
 * definitions, so the prompt cannot describe a skill the code does not have.
 */
import { BOOK_COMMANDS } from "./commands/book";
import { DESIGN_COMMANDS } from "./commands/design";
import { FLOW_COMMANDS } from "./commands/flow";
import { PEOPLE_COMMANDS } from "./commands/people";
import { STORY_COMMANDS } from "./commands/story";
import { GUIDE_COMMAND_IDS, type GuideCommandId } from "./ids";
import { REQUIREMENTS } from "./requirements";
import type { CommandDef } from "./types";

const ALL: CommandDef[] = [
  ...BOOK_COMMANDS,
  ...STORY_COMMANDS,
  ...PEOPLE_COMMANDS,
  ...DESIGN_COMMANDS,
  ...FLOW_COMMANDS,
];

export const GUIDE_COMMANDS: Record<GuideCommandId, CommandDef> = Object.fromEntries(
  ALL.map((def) => [def.id, def]),
) as Record<GuideCommandId, CommandDef>;

/** Ids without a definition, or defined twice. Empty in a healthy build; the invariants assert it. */
export function commandCoverageProblems(): string[] {
  const problems: string[] = [];
  for (const id of GUIDE_COMMAND_IDS) {
    const count = ALL.filter((def) => def.id === id).length;
    if (count === 0) problems.push(`${id}: no definition`);
    if (count > 1) problems.push(`${id}: defined ${count} times`);
  }
  return problems;
}

/** One block per enabled skill, for the interpreter's `{{skills}}`. */
export function commandPromptLines(enabled: readonly GuideCommandId[]): string {
  return enabled
    .map((id) => GUIDE_COMMANDS[id])
    .filter(Boolean)
    .map((def) => {
      const args = def.args
        .filter((spec) => !spec.hint.startsWith("never set"))
        .map((spec) => `${spec.name}${spec.required ? "" : "?"}: ${spec.hint}${spec.options ? ` (${spec.options.join(" | ")})` : ""}`)
        .join("; ");
      return `- ${def.id}: ${def.summary}${args ? `\n    args: ${args}` : ""}\n    e.g. ${def.examples.slice(0, 2).map((e) => `"${e}"`).join(", ")}`;
    })
    .join("\n");
}

/** What the guide can do, for help answers. */
export function commandHelpLines(enabled: readonly GuideCommandId[]): string {
  return enabled
    .map((id) => GUIDE_COMMANDS[id])
    .filter(Boolean)
    .map((def) => {
      const needs = def.requires.filter((r) => r !== "notLocked").map((r) => REQUIREMENTS[r].label.toLowerCase());
      return `- ${def.help}${needs.length ? ` Needs: ${needs.join(", ")}.` : ""} Try: "${def.examples[0]}"`;
    })
    .join("\n");
}
