"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useProjectsStore } from "@/state/projectsStore";
import { Button } from "@/ui/components/Button";

/**
 * Shown when the open book's local copy is stale — a save was rejected because
 * another tab or device advanced the stored version. Rather than silently
 * clobbering (or trying to merge) the newer state, we freeze auto-save for this
 * project and ask the user to reload the latest. Reloading discards this tab's
 * unsaved edits, which is the safe, predictable choice for a single-user tool.
 */
export function ProjectConflictBanner() {
  const staleId = useProjectsStore((s) => s.staleProjectId);
  const reloadProject = useProjectsStore((s) => s.reloadProject);
  const [reloading, setReloading] = useState(false);

  if (!staleId) return null;

  const onReload = async () => {
    setReloading(true);
    try {
      await reloadProject(staleId);
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        This book was changed in another tab or on another device. Reload to continue —
        unsaved changes made here will be discarded.
      </span>
      <Button size="sm" loading={reloading} onClick={() => void onReload()}>
        Reload
      </Button>
    </div>
  );
}
