/**
 * The gate between what the interpreter proposed and what the planner sees.
 *
 * Same rules as fact claims (`guide/claims.ts`): a skill call must quote the
 * reader's own words, clear the confidence floor, name a known and enabled
 * skill, and use only that skill's arguments. Names and titles the call writes
 * must appear in the message, so a model cannot invent "Brian" and add him.
 * Anything refused is kept with its reason for the turn log.
 */
import { GUIDE_COMMANDS } from "./registry";
import { isGuideCommandId, type GuideCommandId } from "./ids";
import { foldName } from "./resolve";
import type { CommandArgs, CommandCall } from "./types";

export interface RawCommandCall {
  id: string;
  args?: { name: string; value: string }[] | Record<string, unknown>;
  evidence?: string;
  confidence?: number;
}

export interface RefusedCommand {
  id: string;
  reason: string;
  evidence: string;
}

export interface ScreenedCommands {
  kept: CommandCall[];
  refused: RefusedCommand[];
  /** Calls past the per-message limit, in order. The guide says it did the first ones. */
  overflow: CommandCall[];
}

/** Arguments whose value is written into the book as the reader typed it. */
const GROUNDED_ARGS = new Set(["name", "newName", "title", "author", "says", "words", "from"]);
/** Arguments only the app sets (confirmation choices, generated ids). */
const APP_ARGS = new Set(["story", "id"]);
const MAX_ARG_CHARS = 600;

function squash(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”„«»"'’‘`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function argsOf(raw: RawCommandCall["args"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry.name === "string" && typeof entry.value === "string") out[entry.name] = entry.value;
    }
  } else if (raw && typeof raw === "object") {
    for (const [name, value] of Object.entries(raw)) {
      if (typeof value === "string" || typeof value === "number") out[name] = String(value);
    }
  }
  return out;
}

export function screenCommandCalls(input: {
  raw: readonly RawCommandCall[];
  message: string;
  enabled: readonly GuideCommandId[];
  floor: number;
  max: number;
}): ScreenedCommands {
  const message = squash(input.message);
  const folded = foldName(input.message);
  const kept: CommandCall[] = [];
  const refused: RefusedCommand[] = [];
  const seen = new Set<string>();
  for (const raw of input.raw) {
    const evidence = typeof raw.evidence === "string" ? raw.evidence.trim().slice(0, 400) : "";
    const refuse = (reason: string) => refused.push({ id: String(raw.id).slice(0, 40), reason, evidence });
    if (!isGuideCommandId(raw.id)) {
      refuse("unknown skill");
      continue;
    }
    if (!input.enabled.includes(raw.id)) {
      refuse("skill is turned off");
      continue;
    }
    const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
    if (confidence < input.floor) {
      refuse(`confidence ${confidence.toFixed(2)} is under the floor ${input.floor}`);
      continue;
    }
    if (!evidence || !message.includes(squash(evidence))) {
      refuse("evidence is not the reader's own words");
      continue;
    }
    const def = GUIDE_COMMANDS[raw.id];
    const allowed = new Set(def.args.map((spec) => spec.name));
    const args: CommandArgs = {};
    let problem: string | null = null;
    for (const [name, value] of Object.entries(argsOf(raw.args))) {
      if (!allowed.has(name) || APP_ARGS.has(name)) continue;
      const clean = value.trim().slice(0, MAX_ARG_CHARS);
      if (!clean) continue;
      if (GROUNDED_ARGS.has(name) && !folded.includes(foldName(clean))) {
        problem = `${name} "${clean}" is not in the message`;
        break;
      }
      args[name] = clean;
    }
    if (problem) {
      refuse(problem);
      continue;
    }
    const key = `${raw.id}:${JSON.stringify(Object.entries(args).sort())}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ id: raw.id, args, evidence, confidence, source: "model" });
  }
  return { kept: kept.slice(0, input.max), refused, overflow: kept.slice(input.max) };
}
