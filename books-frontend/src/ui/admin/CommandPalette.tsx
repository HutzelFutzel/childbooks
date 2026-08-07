"use client";

/**
 * ⌘K / Ctrl+K quick-jump for the admin dashboard. Searches the flattened
 * `NAV_INDEX` (every tab in every section) by label + section + group, so an
 * admin who remembers "there's a QR codes setting somewhere" can type "qr"
 * instead of hunting through Marketing's tab strip. See `adminNav.tsx`.
 */
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Modal } from "../components/Modal";
import { NAV_INDEX, type NavEntry } from "./adminNav";
import { useAdminAccess } from "../../state/adminAccessStore";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const canRead = useAdminAccess((s) => s.canRead);
  const isOwner = useAdminAccess((s) => s.isOwner());
  const reachable = useMemo(
    () => NAV_INDEX.filter((e) => (e.ownerOnly ? isOwner : !e.key || canRead(e.key))),
    [canRead, isOwner],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Reset search state every time the palette opens, rather than leaving the
  // previous query behind.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlighted(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reachable;
    return reachable.filter((entry) =>
      `${entry.label} ${entry.sectionLabel} ${entry.groupLabel ?? ""}`.toLowerCase().includes(q),
    );
  }, [query, reachable]);

  useEffect(() => {
    setHighlighted(0);
  }, [results.length]);

  const select = (entry: NavEntry) => {
    entry.go();
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = results[highlighted];
      if (entry) select(entry);
    }
  };

  return (
    <Modal open={open} onClose={() => onOpenChange(false)} title="Jump to…" size="max-w-lg">
      <div className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 ring-1 ring-inset ring-ink-100">
        <Search className="size-4 shrink-0 text-ink-400" />
        <input
          // The dialog's focus trap (see `useDialogFocus`) defers to any
          // element that already has focus by the time it checks, so a plain
          // `autoFocus` here is enough to land the cursor in search instead
          // of on the modal's close button.
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to a setting or report…"
          className="w-full bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-2 max-h-80 overflow-y-auto">
        {results.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-400">Nothing matches &ldquo;{query}&rdquo;.</p>
        ) : (
          results.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => select(entry)}
              onMouseEnter={() => setHighlighted(i)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                i === highlighted ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                  i === highlighted ? "bg-brand-100 text-brand-600" : "bg-ink-100 text-ink-500"
                }`}
              >
                {entry.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{entry.label}</span>
                <span className="block truncate text-[11px] text-ink-400">
                  {entry.sectionLabel}
                  {entry.groupLabel ? ` · ${entry.groupLabel}` : ""}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
