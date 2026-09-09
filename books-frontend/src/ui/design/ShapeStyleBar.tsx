/**
 * Slim floating toolbar for decorative shapes and speech bubbles.
 * Kind, fill, outline (with weight), shadow, and delete stay on the pill —
 * no dock. Tail stays on-canvas; lock lives in Arrange; duplicate is ⌘D.
 */
import { useRef, useState } from "react";
import { Shapes, Trash2 } from "lucide-react";
import type { ShapeElement } from "../../core/types";
import { cn } from "../lib/cn";
import { parseColor } from "./color";
import { ColorField } from "./ColorPicker";
import { FloatingBarPortal } from "./FloatingBarPortal";
import type { FloatingBarPlacement } from "./floatingBarPlacement";
import { ShadowFlyout } from "./ShadowFlyout";
import { ShapeKindPicker } from "./ShapeKindPicker";
import { isBubble, SHAPE_DEFS } from "./shapes";
import { PortalToolbarFlyout } from "./toolbarFlyout";
import { ToolbarSlider } from "./toolbarSlider";

const DEFAULT_OUTLINE_WIDTH = 0.006;

export type ShapeToolbarChrome = {
  shape: ShapeElement;
  onPatch: (patch: Partial<ShapeElement>, opts?: { coalesce?: string }) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onGestureEnd: () => void;
};

export function ShapeStyleBar({
  placement,
  chrome,
}: {
  placement: FloatingBarPlacement;
  chrome: ShapeToolbarChrome;
}) {
  const label = SHAPE_DEFS.find((def) => def.id === chrome.shape.kind)?.label
    ?? (isBubble(chrome.shape.kind) ? "Speech" : "Shape");

  return (
    <FloatingBarPortal
      placement={placement}
      data-shape-style-bar
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("input, button, select, textarea, a")) return;
        e.preventDefault();
      }}
    >
      <div className="flex max-w-[calc(100vw-16px)] items-center gap-0.5 overflow-x-auto rounded-xl border border-ink-200 bg-white/95 p-1 shadow-lifted backdrop-blur">
        <KindPicker chrome={chrome} label={label} />
        <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
        <ColorField
          value={chrome.shape.fill}
          onChange={(fill) =>
            chrome.onPatch({ fill }, { coalesce: `fill-${chrome.shape.id}` })
          }
          onOpenChange={(open) => {
            if (!open) chrome.onGestureEnd();
          }}
          compact
          look="swatch"
          label="Fill"
        />
        {chrome.shape.text && (
          <ColorField
            value={chrome.shape.text.color}
            onChange={(color) =>
              chrome.onPatch(
                { text: { ...chrome.shape.text!, color } },
                { coalesce: `shape-text-color-${chrome.shape.id}` },
              )
            }
            onOpenChange={(open) => {
              if (!open) chrome.onGestureEnd();
            }}
            compact
            look="glyph"
            label="Text"
          />
        )}
        <ColorField
          value={chrome.shape.stroke ?? "rgba(0,0,0,0)"}
          onChange={(stroke) => {
            const patch: Partial<ShapeElement> = { stroke };
            if (parseColor(stroke).a > 0 && !(chrome.shape.strokeWidth ?? 0)) {
              patch.strokeWidth = DEFAULT_OUTLINE_WIDTH;
            }
            chrome.onPatch(patch, { coalesce: `stroke-${chrome.shape.id}` });
          }}
          onOpenChange={(open) => {
            if (!open) chrome.onGestureEnd();
          }}
          compact
          look="stroke"
          label="Outline"
          footer={
            <ToolbarSlider
              label="Weight"
              min={0}
              max={0.03}
              step={0.001}
              value={chrome.shape.strokeWidth ?? 0}
              format={(v) => `${Math.round((v / 0.03) * 100)}`}
              onChange={(strokeWidth) =>
                chrome.onPatch(
                  { strokeWidth },
                  { coalesce: `strokeWidth-${chrome.shape.id}` },
                )
              }
              onGestureEnd={chrome.onGestureEnd}
            />
          }
        />
        <ShadowFlyout
          effects={chrome.shape.effects}
          coalesceKey={`shadow-${chrome.shape.id}`}
          onChange={(effects, opts) => chrome.onPatch({ effects }, opts)}
          onGestureEnd={chrome.onGestureEnd}
        />
        <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
        <Toggle label="Delete" active={false} onClick={chrome.onDelete}>
          <Trash2 className="size-4" />
        </Toggle>
      </div>
    </FloatingBarPortal>
  );
}

function KindPicker({ chrome, label }: { chrome: ShapeToolbarChrome; label: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Toggle label={label} active={open} onClick={() => setOpen((value) => !value)}>
        <Shapes className="size-4" />
        <span className="hidden max-w-24 truncate px-0.5 text-xs font-medium sm:inline">
          {label}
        </span>
      </Toggle>
      <PortalToolbarFlyout
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={rootRef}
        className="w-72 p-2.5"
      >
        <ShapeKindPicker
          value={chrome.shape.kind}
          onSelect={(kind) => {
            chrome.onPatch({ kind });
            setOpen(false);
          }}
        />
      </PortalToolbarFlyout>
    </div>
  );
}

function Toggle({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg p-1.5 transition",
        active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100",
      )}
    >
      {children}
    </button>
  );
}
