/**
 * Slim Canva-style floating toolbar for selected images / page illustrations.
 * Everyday controls stay on the row; Refine / Characters / Scene / Versions /
 * Effects open the docked ImageEditPanel.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Crop,
  History,
  Lock,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import type { Anchor, ImageElement } from "../../core/types";
import { cn } from "../lib/cn";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { anchorThumbBlobId } from "../../state/ai";
import { useStudio } from "../studio/StudioContext";
import { usePageIllustration } from "../studio/usePageIllustration";
import type { ImageEditSection } from "./ImageEditPanel";
import {
  floatingBarPortalProps,
  type FloatingBarPlacement,
} from "./floatingBarPlacement";
import { PortalToolbarFlyout } from "./toolbarFlyout";

export type ImageToolbarChrome = {
  image: ImageElement;
  pageId: string;
  onPatch: (patch: Partial<ImageElement>, opts?: { coalesce?: string }) => void;
  onCrop: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
};

/** Effective letterbox mode for Fit — matches KonvaImageElement defaults. */
export function effectiveFitBackdrop(image: ImageElement): "blur" | "none" {
  return image.fitBackdrop ?? (image.kind === "illustration" ? "blur" : "none");
}

export function ImageStyleBar({
  placement,
  chrome,
}: {
  placement: FloatingBarPlacement;
  chrome: ImageToolbarChrome;
}) {
  const isIllustration = chrome.image.kind === "illustration";
  const isFill = chrome.image.fit !== "contain";
  const softFill = effectiveFitBackdrop(chrome.image) === "blur";
  const portal = floatingBarPortalProps(placement);

  return createPortal(
    <div
      data-image-style-bar
      className={portal.className}
      style={portal.style}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("input, button, select, textarea, a")) return;
        e.preventDefault();
      }}
    >
      <div className="flex items-center gap-0.5 rounded-xl border border-ink-200 bg-white/95 p-1 shadow-lifted backdrop-blur">
        <Toggle
          label={isFill ? "Position picture in frame" : "Crop / resize frame"}
          active={false}
          onClick={chrome.onCrop}
        >
          <Crop className="size-4" />
          <span className="hidden px-0.5 text-xs font-medium sm:inline">
            {isFill ? "Position" : "Crop"}
          </span>
        </Toggle>

        <div className="mx-0.5 inline-flex rounded-lg border border-ink-200">
          <FitBtn
            label="Fill"
            title="Fill the frame — drag to choose which part shows"
            active={isFill}
            onClick={() => {
              chrome.onPatch({ fit: "cover" });
              // Aspect mismatch crops edges — open position mode so the user
              // can immediately drag the picture into place.
              chrome.onCrop();
            }}
          />
          <FitBtn
            label="Fit"
            title="Show the whole picture — may leave bars"
            active={!isFill}
            onClick={() => chrome.onPatch({ fit: "contain" })}
          />
        </div>

        {!isFill && (
          <Toggle
            label={softFill ? "Soft fill on leftover space" : "Transparent leftover space"}
            active={softFill}
            onClick={() =>
              chrome.onPatch({ fitBackdrop: softFill ? "none" : "blur" })
            }
          >
            <Square className={cn("size-4", softFill && "fill-current opacity-40")} />
            <span className="hidden px-0.5 text-xs font-medium sm:inline">
              {softFill ? "Soft fill" : "Clear"}
            </span>
          </Toggle>
        )}

        {isIllustration && (
          <>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
            <IllustrationActions chrome={chrome} />
          </>
        )}

        <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
        <MoreMenu chrome={chrome} />
        <Toggle
          label={
            isIllustration
              ? "Clear art from page (versions kept)"
              : "Delete"
          }
          active={false}
          onClick={chrome.onDelete}
        >
          <Trash2 className="size-4" />
        </Toggle>
      </div>
    </div>,
    document.body,
  );
}

function IllustrationActions({ chrome }: { chrome: ImageToolbarChrome }) {
  const { toggleImageEdit, imageEditSection } = useStudio();
  const illo = usePageIllustration(chrome.pageId);

  return (
    <>
      {!illo.cursor ? (
        <Toggle
          label={illo.coverMode ? "Generate cover" : "Generate illustration"}
          active={false}
          disabled={illo.generating}
          onClick={() => void illo.generate()}
          tone="accent"
        >
          <Sparkles className={cn("size-4", illo.generating && "animate-spin")} />
          <span className="hidden px-0.5 text-xs font-medium sm:inline">
            {illo.coverMode ? "Generate cover" : "Generate"}
          </span>
        </Toggle>
      ) : null}
      <Toggle
        label="Edit illustration"
        active={imageEditSection === "refine"}
        onClick={() => toggleImageEdit("refine")}
      >
        <Sparkles className="size-4" />
        <span className="hidden px-0.5 text-xs font-medium sm:inline">Edit</span>
      </Toggle>
      <CastToggle
        active={imageEditSection === "characters"}
        dirty={illo.isStale}
        anchors={illo.anchors}
        activeIds={illo.activeIds}
        onClick={() => toggleImageEdit("characters")}
      />
      {illo.isStale && (
        <Toggle
          label={
            illo.staleRefAnchors.length > 0
              ? "Update looks, then scene"
              : "Update scene"
          }
          active={false}
          disabled={illo.generating}
          onClick={() => void illo.updateScene()}
          tone="accent"
        >
          <RefreshCw className={cn("size-4", illo.generating && "animate-spin")} />
        </Toggle>
      )}
      {!illo.isStale && illo.layoutStale && (
        <Toggle
          label="Redraw for layout"
          active={false}
          disabled={illo.generating}
          onClick={() => void illo.redrawLayout()}
          tone="accent"
        >
          <RefreshCw className={cn("size-4", illo.generating && "animate-spin")} />
        </Toggle>
      )}
    </>
  );
}

function MoreMenu({ chrome }: { chrome: ImageToolbarChrome }) {
  const { imageEditSection, toggleImageEdit } = useStudio();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isIllustration = chrome.image.kind === "illustration";

  const openPanel = (section: ImageEditSection) => {
    toggleImageEdit(section);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Toggle
        label="More"
        active={open || imageEditSection !== null}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="size-4" />
      </Toggle>
      <PortalToolbarFlyout
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={rootRef}
        align="end"
        className="w-44 overflow-hidden py-1"
      >
        {isIllustration && (
          <>
            <MenuRow
              icon={<Wand2 className="size-4" />}
              label="Scene"
              active={imageEditSection === "scene"}
              onClick={() => openPanel("scene")}
            />
            <MenuRow
              icon={<History className="size-4" />}
              label="Versions"
              active={imageEditSection === "versions"}
              onClick={() => openPanel("versions")}
            />
          </>
        )}
        <MenuRow
          icon={<Sparkles className="size-4" />}
          label="Effects"
          active={imageEditSection === "effects"}
          onClick={() => openPanel("effects")}
        />
        <MenuRow
          icon={<Crop className="size-4" />}
          label="Frame & position"
          active={imageEditSection === "frame"}
          onClick={() => openPanel("frame")}
        />
        <div className="my-1 border-t border-ink-100" />
        <MenuRow
          icon={<Lock className="size-4" />}
          label={chrome.image.locked ? "Unlock" : "Lock"}
          onClick={() => {
            chrome.onToggleLock();
            setOpen(false);
          }}
        />
        {!isIllustration && (
          <MenuRow
            label="Duplicate"
            onClick={() => {
              chrome.onDuplicate();
              setOpen(false);
            }}
          />
        )}
      </PortalToolbarFlyout>
    </div>
  );
}

function FitBtn({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-[11px] font-medium transition first:rounded-l-md last:rounded-r-md",
        active ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-ink-50",
      )}
    >
      {label}
    </button>
  );
}

function CastToggle({
  active,
  dirty,
  anchors,
  activeIds,
  onClick,
}: {
  active: boolean;
  dirty: boolean;
  anchors: Anchor[];
  activeIds: string[];
  onClick: () => void;
}) {
  const activeAnchors = activeIds
    .map((id) => anchors.find((a) => a.id === id))
    .filter((a): a is Anchor => !!a);
  const shown = activeAnchors.slice(0, 3);
  const count = activeAnchors.length;
  const label =
    count === 0
      ? "In this picture — add characters & places"
      : `In this picture · ${count}`;

  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-1 rounded-lg px-1.5 py-1 transition",
        active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100",
        dirty && !active && "ring-1 ring-inset ring-amber-300",
      )}
    >
      {shown.length === 0 ? (
        <Users className="size-4" />
      ) : (
        <span className="flex items-center pl-0.5">
          {shown.map((a, i) => (
            <MiniAvatar key={a.id} anchor={a} overlap={i > 0} />
          ))}
        </span>
      )}
      <span
        className={cn(
          "min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-bold tabular-nums leading-4",
          dirty
            ? "bg-amber-100 text-amber-800"
            : count > 0
              ? "bg-brand-100 text-brand-700"
              : "bg-ink-100 text-ink-500",
        )}
      >
        {count}
      </span>
      {dirty && (
        <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-amber-400 ring-1 ring-white" />
      )}
    </button>
  );
}

function MiniAvatar({ anchor, overlap }: { anchor: Anchor; overlap?: boolean }) {
  const url = useBlobUrl(anchorThumbBlobId(anchor));
  return (
    <span
      className={cn(
        "inline-flex size-5 items-center justify-center overflow-hidden rounded-full bg-ink-200 ring-2 ring-white",
        overlap && "-ml-1.5",
      )}
      title={anchor.name}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <span className="text-[9px] font-bold text-ink-500">
          {anchor.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function Toggle({
  children,
  label,
  active,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone?: "accent";
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg p-1.5 transition disabled:opacity-40",
        tone === "accent" && "text-amber-700 hover:bg-amber-50",
        !tone && active && "bg-brand-50 text-brand-700",
        !tone && !active && "text-ink-600 hover:bg-ink-100",
      )}
    >
      {children}
    </button>
  );
}

function MenuRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-ink-50",
        active ? "text-brand-700" : "text-ink-600",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
