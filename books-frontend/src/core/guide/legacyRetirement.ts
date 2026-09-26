/** @legacy guide-v2 L0 — unreachable today; nothing renders it. See docs/LEGACY-GUIDE.md. */
export interface LegacyRetirementEvidence {
  parityComplete: boolean;
  cohortMetricsMet: boolean;
  unresolvedHardStops: number;
  rollbackAvailableThroughWindow: boolean;
  observationWindowEnded: boolean;
  usageCount: number;
  importCount: number;
  manifestCriterionMet: boolean;
}

export interface LegacyRetirementDecision {
  eligible: boolean;
  blockers: string[];
}

/** A deletion gate, not a recommendation: every item must have positive evidence. */
export function legacyRetirementDecision(
  evidence: LegacyRetirementEvidence,
): LegacyRetirementDecision {
  const blockers: string[] = [];
  if (!evidence.parityComplete) blockers.push("Guide parity is incomplete.");
  if (!evidence.cohortMetricsMet) blockers.push("Assigned cohorts have not met the agreed metrics.");
  if (evidence.unresolvedHardStops > 0) blockers.push("Hard-stop defects remain unresolved.");
  if (!evidence.rollbackAvailableThroughWindow) {
    blockers.push("Rollback was not available throughout the observation window.");
  }
  if (!evidence.observationWindowEnded) blockers.push("The observation window is still open.");
  if (evidence.usageCount > 0) blockers.push("The legacy item still has recorded usage.");
  if (evidence.importCount > 0) blockers.push("The legacy item is still imported.");
  if (!evidence.manifestCriterionMet) blockers.push("The manifest retirement criterion is unmet.");
  return { eligible: blockers.length === 0, blockers };
}
