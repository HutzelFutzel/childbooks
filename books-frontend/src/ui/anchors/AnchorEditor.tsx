import { useState } from "react";
import {
  Check,
  ChevronDown,
  Dices,
  Eye,
  EyeOff,
  Pencil,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Anchor } from "../../core/types";
import { layoutOf, sheetAspect, sheetSpecFor } from "../../core/pipeline/anchorLayout";
import { selectVersion, allVersions, getCursor } from "../../core/versioning";
import { changedAnchorsForAnchor, staleAnchorIds } from "../../state/ai";
import { useJobsStore } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { InfoHint } from "../components/InfoHint";
import { Field, Input, Textarea } from "../components/Input";
import { ImagePreview } from "../components/ImagePreview";
import { Modal } from "../components/Modal";
import { VersionThumb } from "../components/VersionThumb";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";
import { formatList } from "../lib/formatList";
import { notify } from "../lib/notify";
import { generateAnchorViaJob } from "../studio/studioGen";
import { ANCHOR_TYPE_ICON } from "./AnchorCard";
import { RelationsEditor } from "./RelationsEditor";

export function AnchorEditor({
  anchor,
  generating: generatingProp,
  setGenerating,
  /** "split" pins the portrait (art + caption + versions) beside the controls
   *  on wide screens — used by the Characters stage's big spotlight. "stacked"
   *  (default) keeps everything in one column — used by the narrow context
   *  rail while designing pages. */
  layout = "stacked",
}: {
  anchor: Anchor;
  generating: boolean;
  setGenerating: (v: boolean) => void;
  layout?: "stacked" | "split";
}) {
  const updateAnchor = useProjectsStore((s) => s.updateAnchor);
  const renameAnchor = useProjectsStore((s) => s.renameAnchor);
  const removeAnchor = useProjectsStore((s) => s.removeAnchor);
  const deleteAnchorVersion = useProjectsStore((s) => s.deleteAnchorVersion);
  const project = useProjectsStore((s) => s.current());
  const [edit, setEdit] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(anchor.name);
  // A background job rendering this anchor keeps the "working" state on after
  // the brief enqueue spinner clears (survives refresh; result folds in on
  // reconcile).
  const jobActive = useJobsStore((s) => s.activeUnitIds.has(anchor.id));
  const generating = generatingProp || jobActive;

  const isStale = Boolean(project && anchor.versions && staleAnchorIds(project).includes(anchor.id));
  const changedRefs = project && isStale ? changedAnchorsForAnchor(project, anchor.id) : [];
  // The anchor's own signature is recorded as a self-entry (see `renderAnchor`)
  // so editing THIS anchor's description after it has art also flags it stale
  // — surfaced separately so "Arthur changed" doesn't read as if some other
  // anchor named Arthur is to blame.
  const selfChanged = changedRefs.some((a) => a.id === anchor.id);
  const otherChangedRefs = changedRefs.filter((a) => a.id !== anchor.id);
  const cursorId = anchor.versions?.cursorId;
  const cursorNode = cursorId ? anchor.versions!.nodes[cursorId] : undefined;
  const { url: cursorUrl, status: cursorStatus } = useBlobUrlState(cursorNode?.content.blobId);
  const hasImage = Boolean(anchor.versions);
  // Sheets predating the layout contract (or a version generated under an
  // older spec) have no recorded layout; the spec for the anchor's CURRENT
  // shape is the best guess then. Bipedal sheets render landscape (three
  // columns fit more comfortably wide than square), so previewing the full,
  // uncropped sheet at a hardcoded square aspect cropped/squashed it.
  const fallbackLayout = layoutOf(sheetSpecFor(anchor));
  const cursorAspect = sheetAspect(cursorNode?.content.layout ?? fallbackLayout);
  const versions = anchor.versions ? allVersions(anchor.versions) : [];
  const TypeIcon = ANCHOR_TYPE_ICON[anchor.type];

  /**
   * Generation runs through the backend job queue (non-blocking): the click
   * only awaits the enqueue; the spinner is then driven by the live job state
   * and the result appears when the worker's render reconciles. Anchors this
   * one contains that have no image yet are queued in the same job first, so
   * the sheet actually embeds their designs.
   */
  async function generate(options: { edit?: string; useReference?: boolean } = {}) {
    if (!project) return;
    setGenerating(true);
    try {
      await generateAnchorViaJob(project, anchor.id, options, (err) => notify.error(err));
      setEdit("");
    } finally {
      setGenerating(false);
    }
  }

  /** Pages whose current illustration was rendered with this anchor. */
  function dependentPageCount(): number {
    if (!project) return 0;
    let count = 0;
    for (const tree of Object.values(project.illustrations ?? {})) {
      const refs = getCursor(tree).content.references ?? [];
      if (refs.some((u) => u.anchorId === anchor.id && !u.textOnly)) count += 1;
    }
    return count;
  }

  function applyVersion(id: string) {
    if (!anchor.versions) return;
    void updateAnchor(anchor.id, { versions: selectVersion(anchor.versions, id) });
  }

  function selectVer(id: string) {
    if (!anchor.versions || id === cursorId) return;
    // Switching the active version cascades: every page rendered with the
    // current version goes stale. Confirm instead of silently flipping.
    if (dependentPageCount() > 0) setConfirmRevertId(id);
    else applyVersion(id);
  }

  function deleteVer(id: string) {
    void deleteAnchorVersion(anchor.id, id);
  }

  function startRename() {
    setRenameValue(anchor.name);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== anchor.name) void renameAnchor(anchor.id, trimmed);
    setRenaming(false);
  }

  // --- Portrait: the reference art, its caption plate, staleness banner and
  // version history — a self-contained "photo" block reused unchanged whether
  // it sits above the controls (stacked) or beside them (split). ------------
  const portrait = (
    <div
      className={cn(
        "space-y-3",
        // Below `lg` the split grid collapses to one column, so the portrait
        // needs its own width cap — otherwise the square art stretches to the
        // full stage width (and height, since it's 1:1) instead of staying a
        // sensible photo-sized block.
        layout === "split" &&
          "mx-auto w-full max-w-xs lg:sticky lg:top-4 lg:mx-0 lg:max-w-none lg:self-start",
      )}
    >
      <div className="overflow-hidden rounded-2xl bg-white p-2.5 shadow-soft ring-1 ring-ink-100">
        <ImagePreview
          src={cursorUrl}
          loading={generating}
          loadingAction="anchorImage"
          refCount={anchor.containedIds?.length ?? 0}
          aspect={cursorAspect}
          className="rounded-xl"
          emptyLabel={
            // The version exists but its blob didn't come back: say so rather
            // than pretending nothing was ever generated.
            cursorStatus === "error" || cursorStatus === "missing"
              ? "This image couldn't be loaded"
              : "No image yet — generate below"
          }
        />
        <div className="flex items-center gap-2 pt-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <TypeIcon className="size-3.5" />
          </span>
          {renaming ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={commitRename}
                className="h-7 px-2 text-sm"
              />
              <button
                type="button"
                aria-label="Save name"
                onMouseDown={(e) => e.preventDefault()}
                onClick={commitRename}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              >
                <Check className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Cancel rename"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setRenaming(false)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startRename}
              title="Rename"
              className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left leading-tight transition hover:bg-ink-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-800">
                  {anchor.name}
                </span>
                <span className="text-[11px] capitalize text-ink-400">{anchor.type}</span>
              </span>
              <Pencil className="size-3 shrink-0 text-ink-300 opacity-0 transition group-hover:opacity-100" />
            </button>
          )}
          {/* Two basics that were simply missing: a story analysis sometimes
              invents a subject nobody wants, and there was no way to drop it or
              to keep it in the story without spending Sparks drawing it. */}
          <button
            type="button"
            onClick={() => void updateAnchor(anchor.id, { include: !anchor.include })}
            title={anchor.include ? "Skip — don't draw this one" : "Include this one again"}
            aria-label={anchor.include ? "Skip this subject" : "Include this subject"}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            {anchor.include ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            title={`Remove ${anchor.name}`}
            aria-label={`Remove ${anchor.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {!anchor.include && (
        <p className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-500">
          Skipped — no reference art will be made for {anchor.name}, and they won&rsquo;t be
          offered on pages.
        </p>
      )}

      {isStale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-amber-800">
            <RefreshCw className="size-3.5 shrink-0" />
            {selfChanged && otherChangedRefs.length > 0
              ? `Its own description and ${formatList(otherChangedRefs.map((a) => a.name))} changed since this was generated.`
              : selfChanged
                ? "Its description changed since this was generated."
                : otherChangedRefs.length > 0
                  ? `${formatList(otherChangedRefs.map((a) => a.name))} changed since this was generated.`
                  : "A referenced character or object changed since this was generated."}
          </span>
          <Button
            size="sm"
            loading={generating}
            leftIcon={<RefreshCw className="size-4" />}
            onClick={() => void generate({ useReference: true })}
          >
            Update
          </Button>
        </div>
      )}

      {/* Refine lives right under the photo — like commenting on it — and is
          kept physically apart from the description below. The two used to
          share one control surface (an "edit" text box next to an editable
          description), which was a real trap: applying a typed tweak
          deliberately ignores the description (so it can't undo the tweak),
          so an edited description could silently vanish the moment someone
          also typed a refine and hit the old "Apply edit" button. Separating
          them spatially makes that combination impossible to reach by
          accident instead of just less likely. */}
      {hasImage && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-ink-500">Refine</span>
            <InfoHint topic="refineImage" />
          </div>
          <RefineBar
            value={edit}
            onChange={setEdit}
            disabled={generating}
            onSend={() => void generate({ edit, useReference: true })}
            onShuffle={() => void generate({ useReference: true })}
          />
        </div>
      )}

      {versions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-500">
            Version history — click to revert or branch from any point
          </p>
          {/* `overflow-x-auto` also computes `overflow-y: auto` (not `visible`)
              per the CSS spec, so the active ring's box-shadow gets clipped
              without room on every side — `-mx-1 px-1 pt-1` gives it that room,
              matching the pattern used for the casting reel. `overflow-y-hidden`
              pins that forced axis explicitly closed instead of leaving it as a
              live (if usually empty) scroll region — with a single version, the
              hover-only delete button pokes a few px past the thumb's own box,
              which registered as real scrollable overflow the instant you
              hovered it, even though there was never anything to scroll to. */}
          <div className="-mx-1 flex gap-2 overflow-x-auto overflow-y-hidden px-1 pb-1 pt-1">
            {versions.map((node, i) => (
              <VersionThumb
                key={node.id}
                blobId={node.content.blobId}
                index={i + 1}
                active={node.id === cursorId}
                onClick={() => selectVer(node.id)}
                onDelete={() => deleteVer(node.id)}
                aspect={sheetAspect(node.content.layout ?? fallbackLayout)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // --- Controls: description, creative direction, generate / refine. -------
  const controls = (
    <div className={cn("space-y-3", layout === "stacked" && "border-t border-ink-100 pt-4")}>
      {/* The description drives the art, so it has to be editable here. It used
          to be read-only, which left a user who disagreed with the AI's take no
          way to fix it except writing a correction in a different box and
          hoping the two got reconciled. */}
      <Field
        label="What they look like"
        hint="Written from your story. Edit it directly if anything's off."
      >
        <Textarea
          value={anchor.description}
          onChange={(e) => void updateAnchor(anchor.id, { description: e.target.value })}
          rows={3}
          placeholder="e.g. a small girl with dark curls, red rain boots and a yellow coat"
        />
      </Field>

      <CreativeDirectionField
        value={anchor.userGuidance ?? ""}
        onChange={(v) => void updateAnchor(anchor.id, { userGuidance: v })}
      />

      {/* The one button here always means the same thing: (re)build the sheet
          from this description, from scratch, ignoring the current image.
          One-off tweaks to the image that's already there live in the
          "Refine" bar under the photo instead — the two are kept apart
          rather than layered into the same control (see the note above it). */}
      <Button
        className="w-full"
        variant={hasImage ? "secondary" : "primary"}
        loading={generating}
        leftIcon={<Sparkles className="size-4" />}
        onClick={() => void generate(hasImage ? { useReference: false } : {})}
      >
        {hasImage ? "Redesign from this description" : "Generate reference sheet"}
      </Button>
    </div>
  );

  const relations = (
    <RelationsEditor
      anchor={anchor}
      all={project?.anchors ?? []}
      update={(anchorId, patch) => void updateAnchor(anchorId, patch)}
    />
  );

  const deleteModal = (
    <Modal
      open={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      title={`Remove ${anchor.name}?`}
      size="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setConfirmDelete(false);
              void removeAnchor(anchor.id);
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-600">
        This removes <span className="font-medium text-ink-800">{anchor.name}</span> from your cast
        along with any reference art. Pages already illustrated with them keep their artwork.
        {" "}
        To keep them in the story but skip the artwork, use{" "}
        <span className="font-medium text-ink-800">Skip</span> instead.
      </p>
    </Modal>
  );

  const revertModal = (
    <Modal
      open={confirmRevertId !== null}
      onClose={() => setConfirmRevertId(null)}
      title="Switch the active reference?"
      size="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => setConfirmRevertId(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (confirmRevertId) applyVersion(confirmRevertId);
              setConfirmRevertId(null);
            }}
          >
            Switch version
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-600">
        {dependentPageCount()} page{dependentPageCount() === 1 ? "" : "s"} of your book{" "}
        {dependentPageCount() === 1 ? "was" : "were"} illustrated with the current version of{" "}
        <span className="font-medium text-ink-800">{anchor.name}</span>. Switching marks{" "}
        {dependentPageCount() === 1 ? "it" : "them"} as needing an update — you can re-render them
        with one click from the sidebar afterwards.
      </p>
    </Modal>
  );

  if (layout === "split") {
    return (
      <div className="grid gap-6 lg:grid-cols-[19rem_1fr]">
        {portrait}
        <div className="space-y-5">
          {controls}
          {relations}
        </div>
        {revertModal}
        {deleteModal}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {portrait}
      {controls}
      {relations}
      {revertModal}
      {deleteModal}
    </div>
  );
}

/**
 * The optional creative-direction field. There used to be a "Let AI design" /
 * "I'll describe it" mode toggle here, but it never actually changed how the
 * image was generated — it only decided whether this field was visible. That
 * implied a real behavioral choice that didn't exist, and let guidance text
 * stay in place (and in effect) after switching "back" to AI mode. A single
 * optional field, collapsed by default when empty, says exactly what happens:
 * leave it blank for a free AI take, or add specifics if you have them.
 *
 * Deliberately just one line, with no permanent caption or card chrome — this
 * is a niche, rarely-touched control, so it shouldn't compete visually with
 * the description/refine controls above and below it. The explanation lives
 * entirely behind the `(?)` hint, one click away for whoever actually needs
 * it, instead of being printed for everyone every time.
 */
function CreativeDirectionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(value.trim()));

  return (
    <div className="space-y-2">
      {/* The info hint is a real `<button>` (via `Popover`) — kept OUTSIDE the
          toggle button, since nesting a button inside a button is invalid
          HTML and would fire both click handlers at once. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-ink-500 transition hover:text-brand-600"
        >
          <ChevronDown className={cn("size-3.5 shrink-0 transition", open && "rotate-180")} />
          Creative direction
          <span className="font-normal text-ink-400">(optional)</span>
        </button>
        <InfoHint topic="creativeDirection" />
      </div>
      {open && (
        <Textarea
          autoFocus={!value.trim()}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="e.g. always wears a red raincoat, cheerful and a little clumsy, warm honey-brown fur…"
        />
      )}
    </div>
  );
}

/**
 * The refine bar: a slim, chat-like control sitting right under the photo —
 * "comment on this photo" — kept physically apart from the description field
 * below so the two can never be mistaken for one combined control (see the
 * note where this is rendered). Typing a tweak and sending it edits the
 * current image in place; the dice next to it makes a fresh variation with
 * the same likeness and no typed instruction, replacing what used to be a
 * separate full-width "Variation" button for something used far less often
 * than the send action.
 */
function RefineBar({
  value,
  onChange,
  disabled,
  onSend,
  onShuffle,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  onSend: () => void;
  onShuffle: () => void;
}) {
  const canSend = value.trim().length > 0 && !disabled;
  return (
    <div className="flex items-center gap-1 rounded-full bg-white py-1 pl-3.5 pr-1 shadow-soft ring-1 ring-inset ring-ink-200 transition focus-within:ring-brand-400">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSend) onSend();
        }}
        disabled={disabled}
        placeholder="Tell it what to tweak…"
        className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
      />
      <button
        type="button"
        onClick={onShuffle}
        disabled={disabled}
        title="New variation — same likeness, no instructions"
        aria-label="New variation — same likeness, no instructions"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 disabled:pointer-events-none disabled:opacity-40"
      >
        <Dices className="size-4" />
      </button>
      <button
        type="button"
        onClick={onSend}
        disabled={!canSend}
        title="Apply this tweak to the image above"
        aria-label="Apply this tweak to the image above"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full transition disabled:pointer-events-none disabled:opacity-40",
          canSend
            ? "bg-brand-600 text-(--color-brand-foreground) hover:bg-brand-700"
            : "bg-ink-100 text-ink-300",
        )}
      >
        <SendHorizontal className="size-4" />
      </button>
    </div>
  );
}
