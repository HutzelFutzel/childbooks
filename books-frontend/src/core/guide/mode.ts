/**
 * Which flow one reader gets, decided in one pure function.
 *
 * This is the only place the question is answered. Every surface that has to
 * branch — the studio shell, the nav toggle, a server route that must not run
 * guide work for a customer who isn't in the rollout — calls
 * {@link resolveGuideMode} with what it knows rather than re-deriving the rule
 * from the rollout mode, because a second copy of this logic is how a customer
 * ends up half-migrated: new chat, old persistence.
 *
 * Being pure and total is the point. It takes no store, no window and no clock,
 * so the rollout can be reasoned about exhaustively (see
 * `scripts/guide-invariants.ts`, which proves that no combination of inputs puts
 * a customer on the new flow unless the rollout says so).
 */
import type { GuideRollout } from "../config/guide";

export type GuideMode = "legacy" | "guide";

/** An explicit request for one flow, from `?guide=` or a saved admin choice. */
export type GuideModeOverride = GuideMode | null;

export interface GuideModeInput {
  /** The live rollout (`appConfig/guide`), already normalized. */
  rollout: GuideRollout;
  /** Whether this reader is an admin (`admins/{uid}` exists). */
  isAdmin: boolean;
  /**
   * The admin's own saved choice from the nav toggle. Only consulted for
   * admins, and only when the rollout still allows the new flow at all.
   */
  preference?: GuideModeOverride;
  /** A one-off request from the URL — see {@link parseGuideOverride}. */
  override?: GuideModeOverride;
  /**
   * The stable id the `percentage` bucket is drawn from. A project id (not a
   * uid) so a reader's existing books keep the flow they were started in while a
   * new book can join the ramp. Absent ⇒ not bucketable ⇒ the wizard.
   */
  bucketKey?: string | null;
}

/**
 * Resolve the flow for one reader.
 *
 * The order of the checks is the whole safety argument:
 *   1. Anyone may ask for the wizard. An escape hatch that needs permission is
 *      not an escape hatch.
 *   2. `off` wins over every opt-in, admin preferences included, so reverting
 *      the rollout is one write and takes effect on the next resolve.
 *   3. Only then may an admin's explicit choice apply.
 *   4. Everyone else gets what the rollout says, and nothing a client sends can
 *      widen that — a customer passing `?guide=new` is not an admin, so their
 *      request never reaches step 3.
 */
export function resolveGuideMode(input: GuideModeInput): GuideMode {
  if (input.override === "legacy") return "legacy";
  if (input.rollout.mode === "off") return "legacy";

  if (input.isAdmin) {
    if (input.override === "guide") return "guide";
    if (input.preference) return input.preference;
    // No stated preference: fall through, so an admin sees exactly what a
    // customer in this rollout sees rather than a mode only admins get.
  }

  return audienceMode(input.rollout, input.bucketKey ?? null);
}

/** What the rollout alone grants a reader, ignoring admin status entirely. */
function audienceMode(rollout: GuideRollout, bucketKey: string | null): GuideMode {
  if (rollout.mode === "on") return "guide";
  if (rollout.mode === "percentage") {
    if (!bucketKey || rollout.percent <= 0) return "legacy";
    return bucketOf(bucketKey) < rollout.percent ? "guide" : "legacy";
  }
  return "legacy";
}

/**
 * Whether to show this reader the flow toggle. Distinct from the resolved mode:
 * an admin on `adminOnly` who hasn't chosen is on the wizard and still needs the
 * control, while `off` hides it because choosing would do nothing.
 */
export function guideToggleAvailable(rollout: GuideRollout, isAdmin: boolean): boolean {
  return isAdmin && rollout.mode !== "off";
}

/**
 * Read the `?guide=` search param. `new`/`old` rather than the internal mode
 * names because it is typed by hand, and unknown values are ignored (not
 * treated as a request for either flow).
 */
export function parseGuideOverride(value: string | null | undefined): GuideModeOverride {
  if (value === "new") return "guide";
  if (value === "old") return "legacy";
  return null;
}

/**
 * Deterministic 0–99 bucket for a key (FNV-1a, 32-bit).
 *
 * Deliberately not random and not stored: the same project resolves to the same
 * bucket on every device and after any reload, which is what makes a partial
 * rollout stable rather than a coin flip per page load. Ramping the percentage
 * only ever adds readers, since a bucket below the old threshold is below the
 * new one too.
 */
function bucketOf(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

export { bucketOf as guideBucketOf };
