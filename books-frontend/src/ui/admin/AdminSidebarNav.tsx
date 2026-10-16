"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { cn } from "../lib/cn";
import {
  filterNavTree,
  hrefIsActive,
  navLeaves,
  treeContainsActive,
  type NavGroup,
  type NavLeaf,
  type NavNode,
} from "./adminNav";
import type { CatalogSegment } from "./adminTabStore";

const STORAGE_KEY = "admin.sidebar.openDomains.v2";

function filterTreeByQuery(nodes: NavNode[], query: string, parentMatched = false): NavNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const out: NavNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      const hay = `${node.label} ${node.description}`.toLowerCase();
      if (parentMatched || hay.includes(q)) {
        out.push(node);
      }
      continue;
    }
    const groupMatches = `${node.label} ${node.description ?? ""}`.toLowerCase().includes(q);
    const children = filterTreeByQuery(node.children, q, parentMatched || groupMatches);
    if (children.length > 0) {
      out.push({ ...node, children });
    }
  }
  return out;
}

export function AdminSidebarNav({
  tree,
  pathname,
  catalogSegment,
  canReach,
  onOpenPalette,
  onNavigate,
}: {
  tree: NavNode[];
  pathname: string;
  catalogSegment: CatalogSegment;
  canReach: (leaf: NavLeaf) => boolean;
  onOpenPalette?: () => void;
  onNavigate?: () => void;
}) {
  const reachable = useMemo(() => filterNavTree(tree, canReach), [tree, canReach]);
  const [filterQuery, setFilterQuery] = useState("");

  const topGroupIds = useMemo(
    () =>
      reachable
        .filter((node): node is NavGroup => node.kind === "group")
        .map((node) => node.id),
    [reachable],
  );

  // Default to having all domains open so the user never loses their overview,
  // while persisting any manual collapse/expand choices in localStorage.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    for (const id of topGroupIds) defaults[id] = true;
    if (typeof window === "undefined") return defaults;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  });

  // Always ensure the domain containing the active route is expanded.
  useEffect(() => {
    for (const node of reachable) {
      if (node.kind === "group" && treeContainsActive(node, pathname, catalogSegment)) {
        setOpenMap((prev) => (prev[node.id] ? prev : { ...prev, [node.id]: true }));
      }
    }
  }, [reachable, pathname, catalogSegment]);

  const updateOpen = (id: string, nextOpen: boolean) => {
    setOpenMap((prev) => {
      const next = { ...prev, [id]: nextOpen };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore storage quota */
      }
      return next;
    });
  };

  const allExpanded = topGroupIds.every((id) => openMap[id] !== false);
  const toggleAll = () => {
    const nextState = !allExpanded;
    const next: Record<string, boolean> = {};
    for (const id of topGroupIds) next[id] = nextState;
    setOpenMap(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const visible = useMemo(
    () => filterTreeByQuery(reachable, filterQuery),
    [reachable, filterQuery],
  );

  const isFiltering = filterQuery.trim().length > 0;
  const topLeaves = visible.filter((n): n is NavLeaf => n.kind === "leaf");
  const domainGroups = visible.filter((n): n is NavGroup => n.kind === "group");

  return (
    <div className="space-y-4">
      {/* Search & Command Palette Bar */}
      <div className="space-y-1.5">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2.5 size-3.5 text-ink-400" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter menu…"
            aria-label="Filter navigation"
            className="h-8 w-full rounded-lg bg-ink-50/80 pl-8 pr-14 text-xs text-ink-900 ring-1 ring-inset ring-ink-200/70 transition placeholder:text-ink-400 focus:bg-white focus:outline-none focus:ring-brand-400"
          />
          {filterQuery ? (
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              aria-label="Clear filter"
              className="absolute right-2 rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <X className="size-3.5" />
            </button>
          ) : onOpenPalette ? (
            <button
              type="button"
              onClick={onOpenPalette}
              title="Open quick jump palette (⌘K)"
              className="absolute right-1.5 rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-500 shadow-2xs transition hover:border-ink-300 hover:text-ink-800"
            >
              ⌘K
            </button>
          ) : null}
        </div>
      </div>

      {/* Pinned top-level Control Center */}
      {topLeaves.length > 0 && (
        <div className="space-y-1">
          {topLeaves.map((leaf) => (
            <SidebarLeaf
              key={leaf.id}
              leaf={leaf}
              pathname={pathname}
              catalogSegment={catalogSegment}
              onNavigate={onNavigate}
              prominent
            />
          ))}
        </div>
      )}

      {/* Domain Workspaces Header + Expand/Collapse All */}
      {domainGroups.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              Workspaces
            </span>
            {!isFiltering && (
              <button
                type="button"
                onClick={toggleAll}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
                title={allExpanded ? "Collapse all workspaces" : "Expand all workspaces"}
              >
                {allExpanded ? (
                  <>
                    <ChevronsDownUp className="size-3" />
                    <span>Fold</span>
                  </>
                ) : (
                  <>
                    <ChevronsUpDown className="size-3" />
                    <span>Expand</span>
                  </>
                )}
              </button>
            )}
          </div>

          <nav className="space-y-2" aria-label="Admin workspaces">
            {domainGroups.map((group) => (
              <DomainGroup
                key={group.id}
                group={group}
                open={isFiltering ? true : openMap[group.id] !== false}
                onToggle={() => updateOpen(group.id, !(openMap[group.id] !== false))}
                pathname={pathname}
                catalogSegment={catalogSegment}
                onNavigate={onNavigate}
              />
            ))}
          </nav>
        </div>
      )}

      {visible.length === 0 && (
        <div className="rounded-xl bg-ink-50/60 px-3 py-6 text-center">
          <p className="text-xs text-ink-500">No sections match &ldquo;{filterQuery}&rdquo;.</p>
          {onOpenPalette && (
            <button
              type="button"
              onClick={onOpenPalette}
              className="mt-2 text-xs font-medium text-brand-600 hover:underline"
            >
              Search all keywords (⌘K)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DomainGroup({
  group,
  open,
  onToggle,
  pathname,
  catalogSegment,
  onNavigate,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  pathname: string;
  catalogSegment: CatalogSegment;
  onNavigate?: () => void;
}) {
  const containsActive = treeContainsActive(group, pathname, catalogSegment);
  const leafCount = useMemo(() => navLeaves(group.children).length, [group.children]);

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        containsActive
          ? "border-ink-200/90 bg-ink-50/40"
          : "border-transparent bg-transparent hover:border-ink-100",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold transition-colors",
          containsActive ? "text-ink-900" : "text-ink-700 hover:bg-ink-50/80 hover:text-ink-900",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {group.icon && (
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-md",
                containsActive
                  ? "bg-brand-100 text-brand-700"
                  : "bg-ink-100/80 text-ink-500",
              )}
            >
              {group.icon}
            </span>
          )}
          <span className="truncate">{group.label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {!open && containsActive && (
            <span className="size-1.5 rounded-full bg-brand-500" aria-hidden="true" />
          )}
          {!open && (
            <span className="text-[10px] font-normal text-ink-400">{leafCount}</span>
          )}
          {open ? (
            <ChevronDown className="size-3.5 text-ink-400" />
          ) : (
            <ChevronRight className="size-3.5 text-ink-400" />
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-1.5 pb-2 pt-0.5">
          {group.children.map((child) =>
            child.kind === "leaf" ? (
              <SidebarLeaf
                key={child.id}
                leaf={child}
                pathname={pathname}
                catalogSegment={catalogSegment}
                onNavigate={onNavigate}
              />
            ) : (
              <SubGroup
                key={child.id}
                group={child}
                pathname={pathname}
                catalogSegment={catalogSegment}
                onNavigate={onNavigate}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SubGroup({
  group,
  pathname,
  catalogSegment,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  catalogSegment: CatalogSegment;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-0.5 pt-1 first:pt-0">
      <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        {group.label}
      </p>
      {group.children.map((child) =>
        child.kind === "leaf" ? (
          <SidebarLeaf
            key={child.id}
            leaf={child}
            pathname={pathname}
            catalogSegment={catalogSegment}
            onNavigate={onNavigate}
          />
        ) : null,
      )}
    </div>
  );
}

function SidebarLeaf({
  leaf,
  pathname,
  catalogSegment,
  onNavigate,
  prominent = false,
}: {
  leaf: NavLeaf;
  pathname: string;
  catalogSegment: CatalogSegment;
  onNavigate?: () => void;
  prominent?: boolean;
}) {
  const active = hrefIsActive(leaf.href, pathname, catalogSegment);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Link
      href={leaf.href}
      aria-current={active ? "page" : undefined}
      aria-busy={isPending}
      title={leaf.description}
      onClick={(e) => {
        onNavigate?.();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || active) return;
        e.preventDefault();
        startTransition(() => {
          router.push(leaf.href);
        });
      }}
      className={cn(
        "group flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
        prominent ? "py-2 text-sm font-semibold" : "font-medium",
        active || isPending
          ? "bg-brand-50/90 text-brand-900 ring-1 ring-inset ring-brand-200/70"
          : prominent
            ? "bg-ink-50/70 text-ink-800 hover:bg-ink-100/80 hover:text-ink-900"
            : "text-ink-600 hover:bg-ink-100/60 hover:text-ink-900",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "shrink-0 transition-colors",
            active || isPending
              ? "text-brand-600"
              : "text-ink-400 group-hover:text-ink-600",
          )}
        >
          {leaf.icon}
        </span>
        <span className="truncate">{leaf.label}</span>
      </span>
      {isPending && <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-500" />}
    </Link>
  );
}
