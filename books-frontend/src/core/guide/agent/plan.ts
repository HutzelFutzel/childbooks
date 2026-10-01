/**
 * The planner: what one message will do, decided without touching anything.
 *
 * Calls run in order against a working copy of the book, so "add Brian and make
 * him 6" finds Brian. Each call is checked for being enabled, for its
 * requirements (a remedy instead of a failure), for what it would destroy (a
 * confirmation instead of a surprise), and for money (one paid skill per
 * message, and only ever a button). The result is a plan the adapter executes
 * and the invariants can assert, with nothing in between.
 */
import type { GuideAgentConfig } from "../../config/guideAgent";
import { isSkillEnabled } from "../../config/guideAgent";
import type { BookViewId } from "../journey";
import type { Project } from "../../types";
import { GUIDE_COMMANDS } from "./registry";
import { firstUnmet } from "./requirements";
import { canUndo } from "./restore";
import { rerouteRename } from "./reroute";
import {
  IMPACT_ORDER,
  NO_IMPACT,
  type AskOption,
  type Beat,
  type CommandCall,
  type CommandContext,
  type CommandEffect,
  type CommandResult,
  type ConfirmChoice,
  type Impact,
  type Remedy,
} from "./types";
import { beat } from "./commands/shared";

export interface PlannedStep {
  call: CommandCall;
  result: Extract<CommandResult, { kind: "write" } | { kind: "effect" }>;
}

export interface PendingConfirm {
  calls: CommandCall[];
  impact: Impact;
  choices: ConfirmChoice[] | null;
  /** What was confirmed: the calls and their impact on the book as it was. A different hash at tap time is stale. */
  hash: string;
  expiresAt: number;
}

export interface PendingAsk {
  call: CommandCall;
  arg: string;
  options: AskOption[];
}

export interface Plan {
  /** Writes and effects to execute now, in order. */
  steps: PlannedStep[];
  /** The book after every write in `steps`, for follow-up questions and receipts. */
  project: Project;
  confirm: PendingConfirm | null;
  ask: PendingAsk | null;
  blocked: { call: CommandCall; remedy: Remedy }[];
  refused: { id: string; reason: string }[];
  /** Calls held back by a limit (a second paid skill, a second confirmation, the per-message cap). */
  deferred: CommandCall[];
  beats: Beat[];
  effects: CommandEffect[];
  views: BookViewId[];
}

export interface PlanInput {
  project: Project;
  calls: readonly CommandCall[];
  ctx: CommandContext;
  config: GuideAgentConfig;
  /** Calls past the per-message limit, already cut by screening. */
  overflow?: readonly CommandCall[];
  /** The reader tapped "yes" on this confirmation: these calls run without asking again. */
  confirmed?: boolean;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Small, stable, non-cryptographic: it only has to notice that something changed. */
export function confirmHash(calls: readonly CommandCall[], impact: Impact): string {
  const text = stableJson({ calls: calls.map((c) => ({ id: c.id, args: c.args })), impact });
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function worse(a: Impact, b: Impact): Impact {
  return {
    level: IMPACT_ORDER[a.level] >= IMPACT_ORDER[b.level] ? a.level : b.level,
    effects: [...a.effects, ...b.effects],
  };
}

export function planTurn(input: PlanInput): Plan {
  const { ctx, config } = input;
  let working = input.project;
  const plan: Plan = {
    steps: [],
    project: working,
    confirm: null,
    ask: null,
    blocked: [],
    refused: [],
    deferred: [...(input.overflow ?? [])],
    beats: [],
    effects: [],
    views: [],
  };
  const noops: Beat[] = [];
  /** Why a request could not be done, in words for the reader. */
  const sayable: string[] = [];
  let paidUsed = false;
  let confirmImpact: Impact = NO_IMPACT;
  const confirmCalls: CommandCall[] = [];
  let confirmChoices: ConfirmChoice[] | null = null;

  for (const asked of input.calls) {
    // A rename filed as a story edit would leave the cast card with the old name: run it as the rename it is.
    const original = isSkillEnabled(config, "renamePerson") ? rerouteRename(working, asked) : asked;
    const def = GUIDE_COMMANDS[original.id];
    if (!def || !isSkillEnabled(config, original.id)) {
      plan.refused.push({ id: original.id, reason: "skill is turned off" });
      continue;
    }
    const remedy = firstUnmet(working, def.requires, ctx);
    if (remedy) {
      plan.blocked.push({ call: original, remedy });
      continue;
    }
    const call: CommandCall = { ...original, args: def.prepare ? def.prepare(original.args) : original.args };
    const impact = def.impact ? def.impact(working, call.args, ctx) : NO_IMPACT;
    // A destructive change that Undo takes back whole runs at once; one with a
    // question in it (rewrite the story or keep it?) still asks.
    const restorable = def.undoable === true && canUndo(working);
    const asks = Boolean(def.choices?.(working, call.args));
    const needsConfirm =
      def.alwaysConfirm ||
      IMPACT_ORDER[impact.level] >= IMPACT_ORDER.irreversible ||
      (IMPACT_ORDER[impact.level] >= IMPACT_ORDER.destructive && (!restorable || asks)) ||
      config.skills[call.id]?.confirm === true;
    if (needsConfirm && !input.confirmed) {
      // One confirmation card per message: a second destructive request waits.
      if (confirmCalls.length > 0) {
        plan.deferred.push(call);
        continue;
      }
      // An unresolvable target is asked first; confirming "remove who?" means nothing.
      const dry = def.run(working, call.args, ctx);
      if (dry.kind === "ask" || dry.kind === "invalid" || dry.kind === "blocked" || dry.kind === "noop") {
        consume(call, dry);
        continue;
      }
      confirmCalls.push(call);
      confirmImpact = worse(confirmImpact, impact);
      confirmChoices = def.choices?.(working, call.args) ?? null;
      continue;
    }
    if (def.paid) {
      if (paidUsed) {
        plan.deferred.push(call);
        continue;
      }
      paidUsed = true;
    }
    consume(call, def.run(working, call.args, ctx));
  }

  function consume(call: CommandCall, result: CommandResult): void {
    switch (result.kind) {
      case "write":
        working = result.project;
        plan.steps.push({ call, result });
        plan.beats.push(result.beat);
        if (result.then) plan.effects.push(result.then);
        if (result.view) plan.views.push(result.view);
        return;
      case "effect":
        plan.steps.push({ call, result });
        plan.effects.push(result.effect);
        if (result.beat) plan.beats.push(result.beat);
        if (result.effect.kind === "view") plan.views.push(result.effect.view);
        return;
      case "ask":
        if (plan.ask) {
          plan.deferred.push(call);
          return;
        }
        plan.ask = { call, arg: result.arg, options: result.options };
        plan.beats.push(result.beat);
        return;
      case "blocked":
        plan.blocked.push({ call, remedy: result.remedy });
        return;
      case "noop":
        noops.push(result.beat);
        return;
      case "invalid":
        plan.refused.push({ id: call.id, reason: result.reason });
        if (result.say) sayable.push(result.reason);
        return;
    }
  }

  for (const { remedy } of plan.blocked.slice(0, 1)) {
    plan.beats.push(beat("blocked", { what: remedy.what }, { priority: "blocking" }));
    if (remedy.view) plan.views.push(remedy.view);
  }
  if (confirmCalls.length > 0) {
    plan.confirm = {
      calls: confirmCalls,
      impact: confirmImpact,
      choices: confirmChoices,
      hash: confirmHash(confirmCalls, confirmImpact),
      expiresAt: ctx.now + config.turn.confirmTtlMinutes * 60_000,
    };
    const choiceAsk = confirmChoices && confirmImpact.effects.find((effect) => effect.kind === "storyMentions");
    plan.beats.push(
      choiceAsk && choiceAsk.kind === "storyMentions"
        ? beat("removeMentionsAsk", { names: choiceAsk.name }, { priority: "confirm", mustSay: [choiceAsk.name] })
        : beat("confirmAsk", undefined, { priority: "confirm" }),
    );
  }
  const acted = plan.steps.length > 0 || plan.ask || plan.confirm || plan.blocked.length > 0;
  if (!acted && noops.length > 0) plan.beats.push(noops[0]!);
  if (!acted && noops.length === 0 && plan.refused.length > 0 && input.calls.length > 0) {
    plan.beats.push(beat("cannotDoThat", undefined, { priority: "answer", ...(sayable[0] ? { text: sayable[0] } : {}) }));
  }
  if (plan.deferred.length > 0 && plan.steps.length > 0) {
    plan.beats.push(beat("tooMany", { count: plan.steps.length }, { priority: "answer" }));
  }
  plan.project = working;
  return plan;
}

/** Whether a stored confirmation still means the same thing on the book as it is now. */
export function confirmStillValid(
  pending: PendingConfirm,
  project: Project,
  ctx: CommandContext,
): boolean {
  if (ctx.now > pending.expiresAt) return false;
  let impact: Impact = NO_IMPACT;
  for (const call of pending.calls) {
    const def = GUIDE_COMMANDS[call.id];
    if (!def) return false;
    impact = worse(impact, def.impact ? def.impact(project, call.args, ctx) : NO_IMPACT);
  }
  return confirmHash(pending.calls, impact) === pending.hash;
}
