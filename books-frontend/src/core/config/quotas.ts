/**
 * Usage-quota registry — the catalog of countable limits a plan can cap.
 *
 * A quota is a named counter the backend enforces (e.g. "edits per book"). Each
 * plan sets a cap via {@link PlanEntitlements.limits}; when no cap is set the
 * registry default applies, and `null` means **unlimited** (no enforcement).
 * Counters live at `users/{uid}/quotaCounters/{quotaId}__{scopeId}`.
 *
 * Adding a new quota = add an entry here, then enforce it at the relevant
 * server chokepoint with {@link ensureWithinQuota}/{@link incrementQuota}.
 */

/** How a quota's counter is scoped. */
export type QuotaScope =
  /** One counter per account (scopeId = "account"). */
  | "account"
  /** One counter per book/project (scopeId = projectId). */
  | "perBook";

export interface QuotaDef {
  id: string;
  label: string;
  help: string;
  scope: QuotaScope;
  /** Cap applied when a plan doesn't set one. `null` ⇒ unlimited. */
  defaultLimit: number | null;
}

/**
 * The quotas the product understands. Defaults are `null` (unlimited) so
 * nothing changes for existing installs until an admin sets a cap on a plan.
 */
export const QUOTAS = [
  {
    id: "editsPerBook",
    label: "AI edits per book",
    help: "Maximum AI re-roll/edit operations (e.g. regenerating an illustration with instructions) within a single book.",
    scope: "perBook",
    defaultLimit: null,
  },
] as const satisfies readonly QuotaDef[];

/** Union of known quota ids, derived from the registry. */
export type QuotaId = (typeof QUOTAS)[number]["id"];

export function quotaDef(id: string): QuotaDef | undefined {
  return QUOTAS.find((q) => q.id === id);
}
