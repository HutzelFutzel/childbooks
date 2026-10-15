"use client";

/**
 * The guide settings' saved-over versions: what they were before each save, who
 * replaced them, and which areas that save changed. Putting one back keeps the
 * settings it replaces in turn, so a restore can itself be undone.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { GuideVersionSummary } from "../../../../core/config/guide";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { Button } from "../../../components/Button";
import { Section } from "../products/parts";

/** Setting areas in the words the dashboard's panels use. */
const AREA_NAMES: Record<string, string> = {
  rollout: "Rollout",
  brief: "Story options",
  facts: "Facts",
  wording: "Wording",
  extraction: "Confidence",
  playlist: "Step flow",
  "agent.enabled": "Skills on/off",
  "agent.turn": "Per-message limits",
  "agent.skills": "Skills",
  "agent.people": "People",
  "agent.persona": "Persona",
  "agent.style": "Style",
  "agent.composer": "Composer",
  "agent.answers": "Answers",
  "agent.language": "Language",
  "agent.help": "Help articles",
  "agent.ideas": "Suggestions",
  "agent.palette": "Color names",
};

const areaName = (path: string) => AREA_NAMES[path] ?? path;

export function GuideHistoryPanel({ dirty, readOnly }: { dirty: boolean; readOnly: boolean }) {
  const load = useAppConfigStore((s) => s.loadGuideVersions);
  const restore = useAppConfigStore((s) => s.restoreGuideVersion);
  const [versions, setVersions] = useState<GuideVersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setVersions(await load());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the saved versions.");
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onRestore = async (version: GuideVersionSummary) => {
    if (!window.confirm("Put these settings back? What is live now is kept in this list, so you can undo it.")) return;
    setBusy(version.id);
    try {
      await restore(version.id);
      toast.success("Settings restored.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore that version.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Saved versions"
      hint="Each save keeps what it replaced. Restoring a version puts those settings live at once; what is live now is kept in turn."
    >
      {dirty && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          You have unsaved edits. Save or discard them before restoring a version, so nothing is lost.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!versions && !error && <p className="text-sm text-ink-500">Loading…</p>}
      {versions && versions.length === 0 && <p className="text-sm text-ink-500">Nothing has been replaced yet.</p>}
      {versions && versions.length > 0 && (
        <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl bg-white ring-1 ring-ink-100">
          {versions.map((version) => (
            <li key={version.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-ink-800">
                  Replaced {new Date(version.replacedAt).toLocaleString()}
                  {version.replacedBy ? ` by ${version.replacedBy}` : ""}
                </p>
                <p className="text-xs text-ink-500">
                  {version.changed.length > 0 ? `That save changed: ${[...new Set(version.changed.map(areaName))].join(", ")}` : "No areas recorded."}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === version.id}
                disabled={readOnly || dirty || busy !== null}
                onClick={() => void onRestore(version)}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
