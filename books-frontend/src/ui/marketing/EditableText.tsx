"use client";

import { useEffect, useRef, useState, type ElementType } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/cn";
import { useAppConfigStore } from "@/state/appConfigStore";
import type { SiteTextSlot } from "@/core/config/siteContent";
import { useEditMode } from "./editMode";

/**
 * An inline-editable string on the landing page. Visitors see plain text; a
 * signed-in admin in edit mode can click to edit it in place (contentEditable,
 * plain-text only). Enter (or blur) saves, Escape reverts, and clearing the text
 * — or a hover "reset" button — restores the code default. The default lives at
 * the call site; only overrides are persisted (`appConfig/siteContent`).
 */
export function EditableText({
  slotId,
  as = "span",
  defaultValue,
  serverValue,
  className,
  multiline = false,
}: {
  slotId: SiteTextSlot;
  /** The element to render (h1/h2/h3/p/span/…). */
  as?: ElementType;
  /** The hardcoded copy used when there's no admin override. */
  defaultValue: string;
  /** The override resolved during SSR (from `appConfig/siteContent`). */
  serverValue?: string;
  className?: string;
  /** Allow newlines (Enter inserts a line break instead of committing). */
  multiline?: boolean;
}) {
  const editing = useEditMode((s) => s.enabled);
  const override = useAppConfigStore((s) => s.siteContent.text[slotId]);
  const save = useAppConfigStore((s) => s.saveSiteText);
  const reset = useAppConfigStore((s) => s.resetSiteText);

  const value = override ?? serverValue ?? defaultValue;
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);

  // Keep the DOM text in sync with the value when the field isn't being edited
  // (covers live updates + reverting on error). Avoid clobbering active typing.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) {
      el.textContent = value;
    }
  }, [value, editing]);

  const Tag = as;

  if (!editing) {
    return <Tag className={className}>{value}</Tag>;
  }

  const commit = async () => {
    const el = ref.current;
    if (!el) return;
    const raw = (el.textContent ?? "").replace(/\u00a0/g, " ").trim();
    if (raw === value.trim()) return;
    setBusy(true);
    try {
      if (raw === "" || raw === defaultValue.trim()) await reset(slotId);
      else await save(slotId, raw);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save copy.");
      el.textContent = value; // revert on failure
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="group relative inline-block max-w-full align-top">
      <Tag
        ref={ref as never}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={`Edit ${slotId}`}
        className={cn(
          className,
          "cursor-text rounded-md outline-dashed outline-1 outline-offset-2 outline-transparent transition-[outline-color]",
          "hover:outline-brand-300 focus:outline-2 focus:outline-brand-500",
          busy && "opacity-60",
        )}
        onBlur={() => void commit()}
        onClick={(e: React.MouseEvent) => {
          // When the copy lives inside a link/button, editing it must not trigger
          // navigation — cancel the default action while keeping caret placement.
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (ref.current) ref.current.textContent = value;
            ref.current?.blur();
          } else if (e.key === "Enter" && !multiline) {
            e.preventDefault();
            ref.current?.blur();
          }
        }}
        onPaste={(e: React.ClipboardEvent) => {
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain") ?? "";
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            sel.deleteFromDocument();
            sel.getRangeAt(0).insertNode(document.createTextNode(text));
            sel.collapseToEnd();
          }
        }}
      >
        {value}
      </Tag>
      {override !== undefined && (
        <button
          type="button"
          title="Reset to default"
          aria-label="Reset to default"
          onClick={() => void reset(slotId)}
          className="absolute -right-2.5 -top-2.5 z-10 hidden size-6 items-center justify-center rounded-full bg-white text-ink-500 shadow-soft ring-1 ring-ink-200 transition hover:text-ink-900 group-hover:flex"
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </span>
  );
}
