"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { backendFetch } from "../../../platform/backend";
import { Button } from "../../components/Button";
import { Select } from "../../components/Select";

type Population = "all" | "low-confidence" | "rejected" | "unhandled" | "self-repeat";

interface GuideTurnRow {
  id: string;
  uid: string;
  projectId: string;
  message: string;
  componentId?: string | null;
  confidence: number;
  createdAt: number;
  claims?: Array<{ slot: string; op?: string; value?: unknown; confidence: number }>;
  refused?: Array<{ slot: string; refusal: string; reason: string }>;
  unhandled?: Array<{ text: string; want: string }>;
}

export function GuideTurnsAnalysis() {
  const [population, setPopulation] = useState<Population>("all");
  const [rows, setRows] = useState<GuideTurnRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await backendFetch(
        `/admin/analytics/guide-turns?population=${population}`,
      );
      if (!response.ok) throw new Error("Could not load Guide turns.");
      const payload = await response.json() as { rows: GuideTurnRow[] };
      setRows(payload.rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Guide turns.");
    } finally {
      setLoading(false);
    }
  }, [population]);

  useEffect(() => {
    void load();
  }, [load]);

  const addExample = async (row: GuideTurnRow) => {
    const claims = (row.claims ?? []).filter((claim) => claim.value !== undefined);
    if (claims.length === 0) {
      toast.error("This turn has no captured claim values to review.");
      return;
    }
    const response = await backendFetch("/admin/analytics/guide-examples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: row.message,
        componentId: row.componentId ?? null,
        expectedClaims: claims.map((claim) => ({
          slot: claim.slot,
          op: claim.op ?? "set",
          value: claim.value,
        })),
        sourceUid: row.uid,
        projectId: row.projectId,
        note: `Reviewed from turn ${row.id}`,
      }),
    });
    if (!response.ok) {
      toast.error("Could not add this reviewed example.");
      return;
    }
    toast.success("Added to the reviewed Guide evaluation corpus.");
  };

  const dryRun = async (row: GuideTurnRow) => {
    const response = await backendFetch("/admin/analytics/guide-dry-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: row.uid,
        projectId: row.projectId,
        message: row.message,
      }),
    });
    if (!response.ok) {
      toast.error("The dry run could not be completed.");
      return;
    }
    const result = await response.json() as {
      claims?: unknown[];
      refused?: unknown[];
      unhandled?: unknown[];
    };
    toast.success(
      `Dry run: ${result.claims?.length ?? 0} accepted, ${result.refused?.length ?? 0} refused, ${result.unhandled?.length ?? 0} unhandled.`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Guide turns</h2>
          <p className="text-xs text-ink-500">Review extraction failures and promote verified turns into the evaluation corpus.</p>
        </div>
        <Select
          value={population}
          onChange={(event) => setPopulation(event.target.value as Population)}
          options={[
            { value: "all", label: "All recent turns" },
            { value: "low-confidence", label: "Low confidence" },
            { value: "rejected", label: "Rejected" },
            { value: "unhandled", label: "Unhandled" },
            { value: "self-repeat", label: "Self repeats" },
          ]}
        />
      </div>
      {loading ? (
        <p className="text-sm text-ink-400">Loading Guide turns…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">No turns in this population.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <article key={row.id} className="rounded-xl border border-ink-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-ink-800">{row.message}</p>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-400">{Math.round(row.confidence * 100)}%</span>
              </div>
              {(row.refused?.length ?? 0) > 0 && (
                <p className="mt-1 text-xs text-red-600">{row.refused!.map((item) => `${item.slot}: ${item.reason}`).join(" · ")}</p>
              )}
              {(row.unhandled?.length ?? 0) > 0 && (
                <p className="mt-1 text-xs text-amber-700">{row.unhandled!.map((item) => item.text).join(" · ")}</p>
              )}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void dryRun(row)}>
                  Dry run
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void addExample(row)}>
                  Add as reviewed example
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
