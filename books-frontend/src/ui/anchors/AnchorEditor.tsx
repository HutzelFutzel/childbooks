import { useState } from "react";
import { Check, ChevronDown, GitBranch, Pencil, RefreshCw, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import type { Anchor } from "../../core/types";
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
import { useBlobUrl } from "../hooks/useBlobUrl";
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
  const deleteAnchorVersion = useProjectsStore((s) => s.deleteAnchorVersion);
  const project = useProjectsStore((s) => s.current());
  const [edit, setEdit] = useState("");
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
  const cursorId = anchor.versions?.cursorId;
  const cursorNode = cursorId ? anchor.versions!.nodes[cursorId] : undefined;
  const cursorUrl = useBlobUrl(cursorNode?.content.blobId);
  const hasImage = Boolean(anchor.versions);
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
          aspect={1}
          className="rounded-xl"
          emptyLabel="No image yet — generate below"
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
        </div>
      </div>

      {isStale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-amber-800">
            <RefreshCw className="size-3.5 shrink-0" />
            {changedRefs.length > 0
              ? `${formatList(changedRefs.map((a) => a.name))} changed since this was generated.`
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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // --- Controls: creative direction, generate / refine / regenerate. -------
  const controls = (
    <div className={cn("space-y-3", layout === "stacked" && "border-t border-ink-100 pt-4")}>
      <CreativeDirectionField
        anchorName={anchor.name}
        value={anchor.userGuidance ?? ""}
        onChange={(v) => void updateAnchor(anchor.id, { userGuidance: v })}
      />

      {!hasImage ? (
        <Button
          className="w-full"
          loading={generating}
          leftIcon={<Sparkles className="size-4" />}
          onClick={() => void generate()}
        >
          Generate reference sheet
        </Button>
      ) : (
        <div className="space-y-3">
          <Field
            label="Refine this version"
            hint="A one-off tweak to the image above — not saved, just makes one new version."
          >
            <Input
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              placeholder="e.g. make her smile, add a red scarf…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && edit.trim() && !generating) {
                  void generate({ edit, useReference: true });
                }
              }}
            />
          </Field>
          {/* One button, not two — "Apply edit" and "Regenerate" were the same
              action (re-render this version) with different inputs, so the
              label just follows whichever one applies: type a tweak and it
              applies it; leave it blank and it starts over from scratch. */}
          <Button
            variant="secondary"
            className="w-full"
            loading={generating}
            leftIcon={
              edit.trim() ? <GitBranch className="size-4" /> : <RotateCcw className="size-4" />
            }
            onClick={() =>
              void generate(edit.trim() ? { edit, useReference: true } : { useReference: false })
            }
          >
            {edit.trim() ? "Apply edit" : "Regenerate"}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            loading={generating}
            leftIcon={<Wand2 className="size-4" />}
            onClick={() => void generate({ useReference: true })}
          >
            Variation (keep likeness)
          </Button>
        </div>
      )}
    </div>
  );

  const relations = (
    <RelationsEditor
      anchor={anchor}
      all={project?.anchors ?? []}
      update={(anchorId, patch) => void updateAnchor(anchorId, patch)}
    />
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
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {portrait}
      {controls}
      {relations}
      {revertModal}
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
 * The one-line caption below the label is always visible (not just behind the
 * `(?)` hint) — it's what actually answers "what is this for", and how it
 * differs from "Refine this version" below, without an extra click.
 */
function CreativeDirectionField({
  anchorName,
  value,
  onChange,
}: {
  anchorName: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(value.trim()));

  return (
    <div className="overflow-hidden rounded-xl border border-ink-100">
      {/* The info hint is a real `<button>` (via `Popover`) — kept OUTSIDE the
          accordion toggle button, since nesting a button inside a button is
          invalid HTML and would fire both click handlers at once. */}
      <div className="flex items-start gap-1.5 px-3 py-2.5 transition hover:bg-ink-50">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-start justify-between gap-2 text-left"
        >
          <span className="space-y-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink-700">
              <Pencil className="size-3.5 text-ink-400" />
              Creative direction
              <span className="text-xs font-normal text-ink-400">(optional)</span>
            </span>
            <span className="block text-xs leading-relaxed text-ink-400">
              Details to keep every time {anchorName}&rsquo;s art is (re)created — outfit, colors,
              personality. Leave blank to let the AI design freely.
            </span>
          </span>
          <ChevronDown
            className={cn("mt-1 size-4 shrink-0 text-ink-400 transition", open && "rotate-180")}
          />
        </button>
        <InfoHint topic="creativeDirection" className="mt-0.5" />
      </div>
      {open && (
        <div className="border-t border-ink-100 p-3 pt-2.5">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder="e.g. always wears a red raincoat, cheerful and a little clumsy, warm honey-brown fur…"
          />
        </div>
      )}
    </div>
  );
}
