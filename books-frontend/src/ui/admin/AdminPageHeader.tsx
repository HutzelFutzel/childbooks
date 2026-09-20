"use client";

import type { ReactNode } from "react";
import { Button } from "../components/Button";

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-ink-900">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function AdminSaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveLabel = "Save",
  saveDisabled,
  saveTitle,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  saveTitle?: string;
}) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-8 border-t border-ink-100 bg-canvas/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-sm text-ink-500">Unsaved changes</span>
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" onClick={onSave} loading={saving} disabled={saveDisabled} title={saveTitle}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
