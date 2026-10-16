"use client";

/**
 * ⌘K / Ctrl+K quick-jump for the admin dashboard. Searches the flattened
 * `NAV_INDEX` (every tab in every domain workspace) by label, description,
 * domain, sub-group, and keywords.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Modal } from "../components/Modal";
import { MODE_BADGE_META, NAV_INDEX, type NavEntry } from "./adminNav";
import { useAdminAccess } from "../../state/adminAccessStore";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
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
      `${entry.label} ${entry.description} ${entry.sectionLabel} ${entry.groupLabel ?? ""} ${entry.keywords ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [query, reachable]);

  useEffect(() => {
    setHighlighted(0);
  }, [results.length]);

  const select = (entry: NavEntry) => {
    router.push(entry.href);
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
    <Modal open={open} onClose={() => onOpenChange(false)} title="Jump to…" size="max-w-xl">
      <div className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2.5 ring-1 ring-inset ring-ink-100">
        <Search className="size-4 shrink-0 text-ink-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search settings, analytics, orders, studio, legal…"
          className="w-full bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-2.5 max-h-96 overflow-y-auto pr-0.5">
        {results.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-ink-400">
            Nothing matches &ldquo;{query}&rdquo;.
          </p>
        ) : (
          results.map((entry, i) => {
            const badge =
              entry.mode && entry.mode !== "overview" ? MODE_BADGE_META[entry.mode] : null;
            return (
              <Link
                key={entry.id}
                href={entry.href}
                onClick={() => onOpenChange(false)}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                  i === highlighted
                    ? "bg-brand-50 text-brand-900"
                    : "text-ink-700 hover:bg-ink-50"
                }`}
              >
                <span
                  className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${
                    i === highlighted
                      ? "bg-brand-100 text-brand-700"
                      : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {entry.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{entry.label}</span>
                    {badge && (
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          entry.mode === "config"
                            ? "bg-ink-100 text-ink-600"
                            : entry.mode === "ops"
                              ? "bg-amber-100/80 text-amber-800"
                              : "bg-sky-100/80 text-sky-800"
                        }`}
                      >
                        {badge.label}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-ink-400">
                      {entry.sectionLabel}
                      {entry.groupLabel ? ` · ${entry.groupLabel}` : ""}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-500">
                    {entry.description}
                  </span>
                </span>
              </Link>
            );
          })
        )}
      </div>
    </Modal>
  );
}
