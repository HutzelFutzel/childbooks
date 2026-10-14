/** Quality-control work that is measured but never charged as another action. */
export const NON_BILLABLE_GENERATION_STEPS = new Set([
  "gridCheck",
  "imageRepair",
  "dedupe",
  "embedded",
  "layoutRetry",
  // A cover whose painted words came back wrong is drawn again, and the vision
  // read that found the fault is part of the same check. The reader is quoted
  // one cover; the redraws and the reading are ours.
  "letteringRetry",
  "lettering",
  "portraitCheck",
  "portraitRepair",
  // The neutral sample drawn for a saved custom style: ours to make, never the reader's to pay for.
  "styleReference",
]);

export interface BillableUsageEvent {
  modality: "text" | "image";
  step?: string;
  stepId?: number;
}

/**
 * Split provider calls into requested work and internal retries/repairs.
 * Only the first image call in one step invocation is customer-billable.
 */
export function splitBillableUsage<T extends BillableUsageEvent>(
  events: readonly T[],
): { billable: T[]; unbilled: T[] } {
  const billable: T[] = [];
  const unbilled: T[] = [];
  const imageCallsByScope = new Map<number | string, number>();

  for (const event of events) {
    const step = event.step ?? "";
    if (NON_BILLABLE_GENERATION_STEPS.has(step)) {
      unbilled.push(event);
      continue;
    }
    if (event.modality === "image") {
      const scope = event.stepId ?? `${step}:unscoped`;
      const seen = (imageCallsByScope.get(scope) ?? 0) + 1;
      imageCallsByScope.set(scope, seen);
      if (seen > 1) {
        unbilled.push(event);
        continue;
      }
    }
    billable.push(event);
  }

  return { billable, unbilled };
}
