/**
 * "What's new" release notes — the code that shipped, explained in plain
 * language for the sales/marketing team.
 *
 * `.github/workflows/rollout-watch.yml` already waits for the App Hosting build
 * of a commit to go live and can see the previously-live commit (the last READY
 * build), so it collects the diff for that range and POSTs it here. This module
 * turns that diff into structured items using the admin-selected model
 * (Configuration → AI pipeline → Models → "Release notes") and the
 * admin-editable prompt (→ Prompts → "Release notes"), then posts the rendered
 * Block Kit message to #releases.
 *
 * Three deliberate properties, because nobody reviews the output before the
 * whole company reads it:
 *   - SILENCE IS A VALID RESULT. Most backend-only releases contain nothing a
 *     person could notice, and those post nothing rather than inventing a
 *     benefit. Same for items the model isn't confident about. See
 *     `renderReleaseBlocks`, which returns null for both cases.
 *   - THE MODEL NEVER FORMATS. It returns fields; core/notify/releaseNotes
 *     renders them.
 *   - NOTHING IS LOST TO A FAILURE. The range starts at the last commit we
 *     actually SUMMARIZED (`adminSettings/releaseState`), not the last one that
 *     went live — see `advanceState` for exactly when that moves. A failed
 *     rollout, a provider outage, a Slack outage or a bad token all just widen
 *     the next release's range instead of dropping a release on the floor.
 *
 * Auth: CI has no Firebase user, so these routes can't sit under `/admin` (which
 * is `requireAdmin` + fails closed on unmatched paths). They're mounted at
 * `/internal` and gated on the RELEASE_NOTES_TOKEN bearer secret instead.
 *
 * No usage/cost is recorded: `recordUsage` attributes spend to a user, and this
 * call belongs to no user. It's one text call per deploy.
 */
import express, { type Express, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getPromptsConfig } from "./appConfig";
import { apiKeyFor, resolveTextAction } from "./modelResolve";
import { notifySlack } from "./notify";
import { ensureAdmin } from "./storage";
import { getTextProvider } from "../../books-frontend/src/core/providers";
import { renderTextPrompt } from "../../books-frontend/src/core/prompts/render";
import { ProviderError } from "../../books-frontend/src/core/errors";
import {
  releaseNotesSchema,
  renderReleaseBlocks,
  type ReleaseMeta,
  type ReleaseNotes,
} from "../../books-frontend/src/core/notify/releaseNotes";

/** Longest diff we hand to the model, in characters (~60k tokens). */
const DIFF_BUDGET = 240_000;

/**
 * Where the marker lives. `adminSettings/*` is denied to every client by the
 * Firestore rules (only the Admin SDK reaches it), which is the right home for
 * internal state — unlike `appConfig/*`, which is world-readable.
 */
const STATE_DOC = "adminSettings/releaseState";

/**
 * Safety valve on the "retry a wider range next time" rule. Without it, a
 * release the model can't read (or a Slack webhook left broken) would grow the
 * range forever and every run would re-summarize more history. Past this many
 * commits we move the marker regardless, accepting the loss to stop the growth.
 */
const MAX_ACCUMULATED_COMMITS = 25;

/** What the workflow sends us about a release. */
export interface ReleasePayload extends ReleaseMeta {
  commitLog: string;
  diffStat: string;
  diff: string;
}

// ---- The "last summarized" marker -------------------------------------------

/** Why the marker last moved — for anyone reading the doc later. */
type ReleaseOutcome = "posted" | "duplicate" | "disabled" | "internal_only" | "capped";

export interface ReleaseState {
  /** The newest commit whose changes have been accounted for. "" before the first run. */
  lastSummarizedSha: string;
  lastSummarizedAt: number;
  lastOutcome: ReleaseOutcome | "";
}

const EMPTY_STATE: ReleaseState = { lastSummarizedSha: "", lastSummarizedAt: 0, lastOutcome: "" };

/**
 * The marker, or an empty one when it has never been written. Read failures
 * degrade to empty rather than throwing: the workflow then falls back to the
 * App Hosting "previously live" commit, which is a slightly narrower range but
 * far better than posting nothing.
 */
export async function readState(): Promise<ReleaseState> {
  try {
    ensureAdmin();
    const snap = await getFirestore().doc(STATE_DOC).get();
    const data = (snap.data() ?? {}) as Partial<ReleaseState>;
    return {
      lastSummarizedSha: typeof data.lastSummarizedSha === "string" ? data.lastSummarizedSha : "",
      lastSummarizedAt: typeof data.lastSummarizedAt === "number" ? data.lastSummarizedAt : 0,
      lastOutcome: (data.lastOutcome as ReleaseOutcome) ?? "",
    };
  } catch (err) {
    console.error("[releaseNotes] could not read release state", err);
    return EMPTY_STATE;
  }
}

/**
 * Move the marker to `sha`. Called ONLY when the range has genuinely been dealt
 * with — see {@link applyAdvance} for the decision. Best-effort: a write failure
 * leaves the marker where it was, so the next run re-summarizes this range,
 * which is the safe direction to fail in (a duplicate beats a hole).
 */
async function advanceState(sha: string, outcome: ReleaseOutcome): Promise<void> {
  try {
    ensureAdmin();
    await getFirestore()
      .doc(STATE_DOC)
      .set({ lastSummarizedSha: sha, lastSummarizedAt: Date.now(), lastOutcome: outcome }, { merge: true });
  } catch (err) {
    console.error("[releaseNotes] could not advance release state", err);
  }
}

/**
 * Whether a `notifySlack` verdict settles the range — i.e. these commits will
 * never need saying again.
 *
 * The split that matters is deliberate vs. transient:
 *   - `duplicate` — Slack already has this commit's message from an earlier run,
 *     and the dedupe marker never expires, so retrying would loop forever.
 *   - `disabled` — an admin turned this message off. Carrying the range forward
 *     would hand them a month-wide diff the day they turn it back on.
 *   - `error` / `not_configured` / `emulator` — the release WAS worth announcing
 *     and nobody heard it. Hold the marker; the next release says both.
 */
function settles(result: { sent: boolean; reason?: string }): ReleaseOutcome | null {
  if (result.sent) return "posted";
  if (result.reason === "duplicate") return "duplicate";
  if (result.reason === "disabled") return "disabled";
  return null;
}

/**
 * Move the marker if this release settled its range — or if the range has grown
 * past the cap, in which case we give up on it loudly. Returns whether it moved,
 * so the CI log can say.
 */
async function applyAdvance(
  payload: ReleasePayload,
  outcome: ReleaseOutcome | null,
): Promise<boolean> {
  if (!outcome && payload.commitCount > MAX_ACCUMULATED_COMMITS) {
    console.warn(
      `[releaseNotes] giving up on ${payload.commitCount} un-announced commits ` +
        `(${payload.previousSha}..${payload.sha}): past the ${MAX_ACCUMULATED_COMMITS}-commit cap.`,
    );
    outcome = "capped";
  }
  if (!outcome) return false;
  await advanceState(payload.sha, outcome);
  return true;
}

/** Clip the diff to the budget, reporting whether anything was cut. */
function clipDiff(diff: string): { diff: string; truncated: boolean } {
  const trimmed = diff.trim();
  if (trimmed.length <= DIFF_BUDGET) return { diff: trimmed, truncated: false };
  // Cut at a file boundary when there's one reasonably close to the budget, so
  // the model never sees half a hunk and mistakes it for the whole change.
  const hard = trimmed.slice(0, DIFF_BUDGET);
  const lastFile = hard.lastIndexOf("\ndiff --git ");
  return { diff: lastFile > DIFF_BUDGET / 2 ? hard.slice(0, lastFile) : hard, truncated: true };
}

/**
 * Ask the admin-selected model what changed. Throws on a provider or config
 * failure so the caller can report it; posts nothing itself.
 */
export async function summarizeRelease(payload: ReleasePayload): Promise<ReleaseNotes> {
  const [model, prompts] = await Promise.all([
    resolveTextAction("releaseNotes"),
    getPromptsConfig(),
  ]);
  const { diff, truncated } = clipDiff(payload.diff);

  const { system, user } = renderTextPrompt(prompts, "releaseNotes", {
    vars: {
      repo: payload.repo,
      sha: payload.sha.slice(0, 7),
      previousSha: payload.previousSha.slice(0, 7),
      commitCount: payload.commitCount,
      commitLog: payload.commitLog.trim(),
      diffStat: payload.diffStat.trim(),
      diff,
    },
    flags: { hasDiff: diff.length > 0, isTruncated: truncated },
  });

  return getTextProvider(model.provider).generateStructured(
    { apiKey: apiKeyFor(model.provider) },
    {
      model: model.id,
      // Low but not zero: this is prose a person reads, and 0 makes every
      // release note sound like a copy of the last one.
      temperature: 0.3,
      schema: releaseNotesSchema,
      schemaName: "ReleaseNotes",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  );
}

// ---- Routes -----------------------------------------------------------------

/** Constant-time token check (false on any length mismatch). */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Shared gate for both routes. Answers the response itself and returns false
 * when the caller may not proceed. An unset token means the feature was never
 * set up and there is nothing to authenticate against — 503 so it reads as
 * "unconfigured" rather than "wrong key".
 */
function authorized(req: Request, res: Response): boolean {
  const expected = (process.env.RELEASE_NOTES_TOKEN ?? "").trim();
  if (!expected) {
    res.status(503).json({ error: { message: "Release notes are not configured." } });
    return false;
  }
  const provided = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!tokenMatches(provided, expected)) {
    res.status(401).json({ error: { message: "Invalid token." } });
    return false;
  }
  return true;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** What CI logs when generation throws — include the provider body, not just the short message. */
function errorPayload(err: unknown): { message: string; details?: string } {
  if (err instanceof ProviderError) {
    const details = err.details?.trim();
    return {
      message: err.message,
      ...(details && details !== err.message ? { details: details.slice(0, 2000) } : {}),
    };
  }
  return { message: err instanceof Error ? err.message : "Release notes failed." };
}

/**
 * Why the happy path returns `posted: false` with a `reason` rather than an
 * error status: the caller is a CI step. A non-2xx there either fails the
 * workflow (raising a false "frontend did not deploy" alarm) or gets swallowed,
 * whereas a reason in the response body lands in the CI log where it's readable.
 */
export function registerReleaseNotesRoute(app: Express): void {
  // Diffs are large — every other route's limit is far too small for one.
  const json = express.json({ limit: "10mb" });

  // Where to start the range. The workflow prefers this over its own "previously
  // live commit" guess, because this is the last commit actually SUMMARIZED —
  // which is what makes a skipped release get picked up by the next one.
  app.get("/internal/release-notes/state", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    res.json(await readState());
  });

  app.post("/internal/release-notes", json, async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const payload: ReleasePayload = {
      repo: str(body.repo, 200),
      sha: str(body.sha, 64),
      previousSha: str(body.previousSha, 64),
      runUrl: str(body.runUrl, 500),
      commitCount: typeof body.commitCount === "number" && body.commitCount > 0 ? body.commitCount : 0,
      commitLog: str(body.commitLog, 40_000),
      diffStat: str(body.diffStat, 40_000),
      diff: typeof body.diff === "string" ? body.diff : "",
    };
    if (!payload.sha || !payload.previousSha) {
      res.status(400).json({ error: { message: "sha and previousSha are required." } });
      return;
    }
    if (!payload.commitLog.trim() && !payload.diff.trim()) {
      res.json({ posted: false, reason: "nothing_to_summarize" });
      return;
    }

    try {
      const notes = await summarizeRelease(payload);
      const message = renderReleaseBlocks(notes, payload);

      // Nothing worth posting. `internal_only` is a real answer — the release
      // held nothing anyone could notice — so the range is done with.
      // `no_confident_items` is not: the model may simply have failed to read a
      // genuine change, so we hold the marker and give it another go, with more
      // context, on the next release.
      if (!message) {
        const reason = notes.internalOnly ? "internal_only" : "no_confident_items";
        const advanced = await applyAdvance(payload, notes.internalOnly ? "internal_only" : null);
        res.json({ posted: false, reason, advanced, uncertain: notes.uncertain });
        return;
      }

      const result = await notifySlack({
        channel: "release",
        messageKey: "release_notes",
        // One post per commit, so re-running the workflow can't repeat it.
        // `force` (a manual re-run while iterating on the prompt) drops only the
        // dedupe marker — the admin on/off toggle still applies.
        ...(body.force === true ? {} : { ref: `release_${payload.sha}` }),
        text: message.text,
        blocks: message.blocks,
      });

      const advanced = await applyAdvance(payload, settles(result));
      res.json({
        posted: result.sent,
        ...(result.sent ? {} : { reason: result.reason }),
        advanced,
        items: notes.items.length,
        uncertain: notes.uncertain,
      });
    } catch (err) {
      // Deliberately NO advance: the marker stays put so the next release
      // retries this range plus whatever else lands. A provider outage costs a
      // delay, never a missing release.
      console.error("[releaseNotes] generation failed", err);
      res.status(500).json({ error: errorPayload(err) });
    }
  });
}
