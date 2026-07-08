/**
 * Structured edit-intent resolution for page illustrations.
 *
 * User free-text edits ("replace the brown-haired boy with Alex") are classified
 * into a closed set of operations over known anchor ids — the LLM picks *what*
 * to do, deterministic templates decide the words. Runs against the binding
 * layer (`depicted`) so targets are resolved by id, not fuzzy description match.
 */
import { z } from "zod";
import type { ProviderId } from "../config/options";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { Anchor, DepictedSubject } from "../types";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import { withRetry } from "./retry";

/** Thrown when the resolver cannot pick a unique target; UI should disambiguate. */
export class IntentAmbiguousError extends Error {
  readonly name = "IntentAmbiguousError";

  constructor(
    message: string,
    public readonly candidates: { anchorId: string; name: string; brief?: string }[],
  ) {
    super(message);
  }
}

export type EditOpKind = "remove" | "replace" | "refresh" | "modify" | "freeform";

export interface ResolvedEditOp {
  op: EditOpKind;
  /** Anchor to remove, replace in-place, refresh, or modify. */
  targetAnchorId?: string;
  /** Anchor whose reference design replaces the target (replace only). */
  sourceAnchorId?: string;
  /**
   * The change to apply. For `modify` this is the normalized instruction with
   * the anchor's canonical name spelled out ("make Arthur's hair blue"); for
   * freeform it's the raw pass-through text.
   */
  instruction?: string;
  confidence: number;
}

export interface ResolveEditIntentInput {
  userEdit: string;
  anchors: Anchor[];
  depicted: DepictedSubject[];
  /**
   * Fallback candidate targets when the previous version carries no binding
   * data (`depicted` empty): the anchors currently active on the page. Lets the
   * resolver still identify WHO an edit refers to (reference selection, prompt
   * normalization) even when surgical execution isn't possible.
   */
  pageAnchors?: Anchor[];
  /** When the user picked a target after an ambiguous resolution. */
  disambiguateTargetId?: string;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

const intentSchema = z.object({
  ops: z.array(
    z.object({
      op: z.enum(["remove", "replace", "refresh", "modify", "freeform"]),
      targetAnchorId: z.string().nullable().optional(),
      sourceAnchorId: z.string().nullable().optional(),
      instruction: z.string().optional(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  ambiguous: z.boolean().optional(),
  ambiguousReason: z.string().optional(),
});

const CONFIDENCE_AUTO = 0.65;

function formatCandidateList(
  anchors: Anchor[],
  candidates: { anchorId: string; brief?: string }[],
): string {
  const byId = new Map(anchors.map((a) => [a.id, a]));
  return candidates
    .map((c) => {
      const a = byId.get(c.anchorId);
      const name = a?.name ?? c.anchorId;
      const desc = c.brief ?? a?.description ?? "";
      return `- id "${c.anchorId}": anchor "${name}"${desc ? ` — ${desc}` : ""}`;
    })
    .join("\n");
}

function formatAnchorList(anchors: Anchor[]): string {
  return anchors.map((a) => `- id "${a.id}": "${a.name}" (${a.type}) — ${a.description}`).join("\n");
}

/**
 * Classify a user edit into structured operations over known anchor ids.
 * Returns freeform fallback when confidence is low or the cast list is empty.
 */
export async function resolveEditIntent(
  input: ResolveEditIntentInput,
): Promise<ResolvedEditOp[]> {
  const edit = input.userEdit.trim();
  if (!edit) return [{ op: "freeform", instruction: edit, confidence: 1 }];

  // Candidate targets: the previous version's bound subjects when available,
  // otherwise (no binding data) the anchors active on the page. Without either,
  // there is nothing to resolve against.
  const depictedAnchors = input.depicted.filter((d) => d.anchorId);
  const candidates: { anchorId: string; brief?: string }[] =
    depictedAnchors.length > 0
      ? depictedAnchors.map((d) => ({ anchorId: d.anchorId!, brief: d.brief }))
      : (input.pageAnchors ?? []).map((a) => ({ anchorId: a.id, brief: a.description }));
  if (candidates.length === 0) {
    return [{ op: "freeform", instruction: edit, confidence: 1 }];
  }

  const provider = getTextProvider(input.providerId);
  const disambiguation = input.disambiguateTargetId
    ? `\nThe user already chose target id "${input.disambiguateTargetId}" for an ambiguous reference. Use it.`
    : "";
  const { system, user } = renderTextPrompt(
    resolvePromptsConfig(input.prompts),
    "editIntent/resolve",
    {
      vars: {
        edit,
        candidates: formatCandidateList(input.anchors, candidates),
        anchors: formatAnchorList(input.anchors),
        disambiguation,
      },
    },
  );

  let res: z.infer<typeof intentSchema>;
  try {
    res = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          schema: intentSchema,
          temperature: 0,
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
  } catch {
    return [{ op: "freeform", instruction: edit, confidence: 0 }];
  }

  if (res.ambiguous && !input.disambiguateTargetId) {
    const byId = new Map(input.anchors.map((a) => [a.id, a]));
    const choices = candidates.map((c) => {
      const a = byId.get(c.anchorId);
      return { anchorId: c.anchorId, name: a?.name ?? c.anchorId, brief: c.brief };
    });
    throw new IntentAmbiguousError(
      res.ambiguousReason ?? "Which subject did you mean?",
      choices,
    );
  }

  const anchorIds = new Set(input.anchors.map((a) => a.id));
  const ops: ResolvedEditOp[] = [];
  for (const raw of res.ops) {
    const target =
      raw.targetAnchorId && anchorIds.has(raw.targetAnchorId) ? raw.targetAnchorId : undefined;
    const source =
      raw.sourceAnchorId && anchorIds.has(raw.sourceAnchorId) ? raw.sourceAnchorId : undefined;
    if (raw.op === "freeform" || raw.confidence < CONFIDENCE_AUTO) {
      ops.push({ op: "freeform", instruction: edit, confidence: raw.confidence });
      continue;
    }
    if (raw.op === "remove" && target) {
      ops.push({ op: "remove", targetAnchorId: target, confidence: raw.confidence });
    } else if (raw.op === "replace" && target && source) {
      ops.push({ op: "replace", targetAnchorId: target, sourceAnchorId: source, confidence: raw.confidence });
    } else if (raw.op === "refresh" && target) {
      ops.push({ op: "refresh", targetAnchorId: target, confidence: raw.confidence });
    } else if (raw.op === "modify" && target) {
      ops.push({
        op: "modify",
        targetAnchorId: target,
        instruction: raw.instruction?.trim() || edit,
        confidence: raw.confidence,
      });
    } else {
      ops.push({ op: "freeform", instruction: edit, confidence: raw.confidence });
    }
  }
  return ops.length > 0 ? ops : [{ op: "freeform", instruction: edit, confidence: 0 }];
}

/** True when every op can run surgically (no freeform fallback needed). */
export function isFullyStructured(ops: ResolvedEditOp[]): boolean {
  return ops.length > 0 && ops.every((o) => o.op !== "freeform");
}

/** Every anchor id the resolved ops refer to (targets + replace sources). */
export function mentionedAnchorIds(ops: ResolvedEditOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.targetAnchorId) ids.add(op.targetAnchorId);
    if (op.sourceAnchorId) ids.add(op.sourceAnchorId);
  }
  return ids;
}

/**
 * Deterministic English rendering of the resolved ops, with every subject
 * referred to by its CANONICAL anchor name — used as the edit text for
 * whole-page regenerations so typos/pronouns in the user's input can't leak
 * into the image prompt. Returns null when any op is freeform (the original
 * text must then be preserved verbatim).
 */
export function canonicalEditText(
  ops: ResolvedEditOp[],
  anchors: Anchor[],
): string | null {
  if (!isFullyStructured(ops)) return null;
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const parts: string[] = [];
  for (const op of ops) {
    const target = op.targetAnchorId ? byId.get(op.targetAnchorId) : undefined;
    if (!target) return null;
    if (op.op === "remove") {
      parts.push(`remove ${target.name} from the scene entirely`);
    } else if (op.op === "refresh") {
      parts.push(`redraw ${target.name} to exactly match its reference image`);
    } else if (op.op === "replace") {
      const source = op.sourceAnchorId ? byId.get(op.sourceAnchorId) : undefined;
      if (!source) return null;
      parts.push(
        `replace ${target.name} with ${source.name} (matching ${source.name}'s reference image)`,
      );
    } else if (op.op === "modify") {
      if (!op.instruction?.trim()) return null;
      parts.push(op.instruction.trim());
    }
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

// ---- Mention detection (anchor edits & general cross-referencing) ----------

const mentionsSchema = z.object({
  mentionedAnchorIds: z.array(z.string()),
});

export interface ResolveMentionsInput {
  /** The free-text instruction to scan for anchor references. */
  text: string;
  /** Candidate anchors (closed world — the model may only pick from these). */
  candidates: Anchor[];
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

/**
 * Detect which anchors a free-text instruction refers to (names, nicknames,
 * pronouns and misspellings resolved against a closed candidate list). Powers
 * cross-referencing in anchor edits ("make him the same age as Amanda") without
 * requiring the user to pre-tag relations. Best-effort: returns [] on any
 * failure so callers never block a render on it.
 */
export async function resolveMentionedAnchors(
  input: ResolveMentionsInput,
): Promise<string[]> {
  const text = input.text.trim();
  if (!text || input.candidates.length === 0) return [];
  const provider = getTextProvider(input.providerId);
  const { system, user } = renderTextPrompt(
    resolvePromptsConfig(input.prompts),
    "editIntent/mentions",
    {
      vars: {
        text,
        anchors: formatAnchorList(input.candidates),
      },
    },
  );
  try {
    const res = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          schema: mentionsSchema,
          temperature: 0,
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
    const valid = new Set(input.candidates.map((a) => a.id));
    return [...new Set(res.mentionedAnchorIds)].filter((id) => valid.has(id));
  } catch {
    return [];
  }
}
