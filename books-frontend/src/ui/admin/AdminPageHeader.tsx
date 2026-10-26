"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3, ChevronRight, LayoutDashboard, Settings2 } from "lucide-react";
import { Button } from "../components/Button";
import { cn } from "../lib/cn";
import { CATALOG_SEGMENT_META, catalogHref, type PairedView } from "./adminNav";
import { CATALOG_SEGMENTS, adminHref, type CatalogSegment } from "./adminTabStore";
import type { PermissionKey } from "../../core/config/permissions";

export function AdminPageHeader({
  title,
  description,
  domainLabel,
  groupLabel,
  canonicalPath,
  catalogSegment,
  pair,
  canRead,
  actions,
}: {
  title: string;
  description?: string;
  domainLabel?: string;
  groupLabel?: string;
  canonicalPath?: string;
  catalogSegment?: CatalogSegment;
  pair?: PairedView;
  canRead?: (key: PermissionKey) => boolean;
  actions?: ReactNode;
}) {
  const isOverview = canonicalPath === adminHref("configuration", "overview");
  const isCatalog = canonicalPath === adminHref("configuration", "catalog");

  const showPairSwitcher =
    pair &&
    (!canRead || (canRead(pair.configKey) && canRead(pair.analyticsKey)));

  return (
    <header className="mb-6 space-y-3 border-b border-ink-100 pb-4">
      {/* Breadcrumb orientation bar */}
      {!isOverview && domainLabel && (
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1.5 text-xs text-ink-400"
        >
          <Link
            href={adminHref("configuration", "overview")}
            className="inline-flex items-center gap-1 font-medium text-ink-500 transition hover:text-ink-900"
          >
            <LayoutDashboard className="size-3.5" />
            <span>Control Center</span>
          </Link>
          <ChevronRight className="size-3 text-ink-300" />
          <span className="font-medium text-ink-600">{domainLabel}</span>
          {groupLabel && (
            <>
              <ChevronRight className="size-3 text-ink-300" />
              <span className="text-ink-500">{groupLabel}</span>
            </>
          )}
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {description ? (
            <p className="mt-0.5 max-w-3xl text-sm text-ink-500">{description}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Segmented Configure <-> Analytics switcher for paired domain pages */}
          {showPairSwitcher && pair && (
            <div
              className="inline-flex items-center rounded-xl bg-ink-100/80 p-1 ring-1 ring-inset ring-ink-200/60"
              role="group"
              aria-label="Switch between configuration and analytics"
            >
              <Link
                href={pair.configHref}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  canonicalPath === pair.configHref
                    ? "bg-white text-ink-900 shadow-2xs"
                    : "text-ink-600 hover:text-ink-900",
                )}
              >
                <Settings2 className="size-3.5" />
                <span>{pair.configLabel}</span>
              </Link>
              <Link
                href={pair.analyticsHref}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  canonicalPath === pair.analyticsHref
                    ? "bg-white text-ink-900 shadow-2xs"
                    : "text-ink-600 hover:text-ink-900",
                )}
              >
                <BarChart3 className="size-3.5" />
                <span>{pair.analyticsLabel}</span>
              </Link>
            </div>
          )}

          {actions}
        </div>
      </div>

      {/* Inline Catalog product switcher when on any Catalog segment */}
      {isCatalog && catalogSegment && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {CATALOG_SEGMENTS.map((seg) => {
            const meta = CATALOG_SEGMENT_META[seg];
            const active = catalogSegment === seg;
            return (
              <Link
                key={seg}
                href={catalogHref(seg)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-ink-900 text-white"
                    : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50 hover:text-ink-900",
                )}
              >
                {meta.icon}
                <span>{meta.label}</span>
              </Link>
            );
          })}
        </div>
      )}
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
        <Button
          size="sm"
          onClick={onSave}
          loading={saving}
          disabled={saveDisabled}
          title={saveTitle}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
