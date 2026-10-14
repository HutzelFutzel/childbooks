"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "../lib/cn";
import {
  filterNavTree,
  hrefIsActive,
  treeContainsActive,
  type NavGroup,
  type NavLeaf,
  type NavNode,
} from "./adminNav";
import type { CatalogSegment } from "./adminTabStore";

export function AdminSidebarNav({
  tree,
  pathname,
  catalogSegment,
  canReach,
  onNavigate,
}: {
  tree: NavNode[];
  pathname: string;
  catalogSegment: CatalogSegment;
  canReach: (leaf: NavLeaf) => boolean;
  onNavigate?: () => void;
}) {
  const visible = filterNavTree(tree, canReach);
  return (
    <nav className="space-y-5">
      {visible.map((node) =>
        node.kind === "leaf" ? (
          <SidebarLeaf
            key={node.id}
            leaf={node}
            pathname={pathname}
            catalogSegment={catalogSegment}
            onNavigate={onNavigate}
          />
        ) : (
          <SidebarGroup
            key={node.id}
            group={node}
            pathname={pathname}
            catalogSegment={catalogSegment}
            onNavigate={onNavigate}
          />
        ),
      )}
    </nav>
  );
}

function SidebarLeaf({
  leaf,
  pathname,
  catalogSegment,
  onNavigate,
  nested,
}: {
  leaf: NavLeaf;
  pathname: string;
  catalogSegment: CatalogSegment;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const active = hrefIsActive(leaf.href, pathname, catalogSegment);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Link
      href={leaf.href}
      aria-current={active ? "page" : undefined}
      aria-busy={isPending}
      onClick={(e) => {
        onNavigate?.();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || active) return;
        e.preventDefault();
        startTransition(() => {
          router.push(leaf.href);
        });
      }}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        nested ? "font-normal" : "font-medium",
        active || isPending
          ? "bg-ink-100 text-ink-900"
          : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
      )}
    >
      <span className="truncate">{leaf.label}</span>
      {isPending && <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-400" />}
    </Link>
  );
}

function SidebarGroup({
  group,
  pathname,
  catalogSegment,
  onNavigate,
  nested = false,
}: {
  group: NavGroup;
  pathname: string;
  catalogSegment: CatalogSegment;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const containsActive = treeContainsActive(group, pathname, catalogSegment);
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  if (nested) {
    return (
      <div className="space-y-0.5">
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-ink-400">{group.label}</p>
        {group.children.map((child) =>
          child.kind === "leaf" ? (
            <SidebarLeaf
              key={child.id}
              leaf={child}
              pathname={pathname}
              catalogSegment={catalogSegment}
              onNavigate={onNavigate}
              nested
            />
          ) : (
            <SidebarGroup
              key={child.id}
              group={child}
              pathname={pathname}
              catalogSegment={catalogSegment}
              onNavigate={onNavigate}
              nested
            />
          ),
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
          containsActive ? "text-ink-700" : "text-ink-400 hover:text-ink-600",
        )}
        aria-expanded={open}
      >
        {group.label}
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {group.children.map((child) =>
            child.kind === "leaf" ? (
              <SidebarLeaf
                key={child.id}
                leaf={child}
                pathname={pathname}
                catalogSegment={catalogSegment}
                onNavigate={onNavigate}
                nested
              />
            ) : (
              <SidebarGroup
                key={child.id}
                group={child}
                pathname={pathname}
                catalogSegment={catalogSegment}
                onNavigate={onNavigate}
                nested
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
