import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Copy,
  GitBranch,
  MoreHorizontal,
  MoveDown,
  MoveUp,
  Plus,
  RefreshCw,
  RotateCcw,
  Shapes,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import type { Anchor, CoverSpec, ScreenplaySpread, ShapeKind } from "../../core/types";
import { COVER_FRONT_ID } from "../../core/types";
import { wordParagraphs } from "../../core/design";
import { allVersions, getCursor, selectVersion, updateNodeContent } from "../../core/versioning";
import { changedAnchorsForSpread, generateIllustrationVersion } from "../../state/ai";
import { useProjectsStore } from "../../state/projectsStore";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Field, Input, Textarea } from "../components/Input";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { formatList } from "../lib/formatList";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { PageStage } from "../design/PageStage";
import { SHAPE_DEFS, shapePath } from "../design/shapes";
import type { DesignPage } from "../design/designInit";
import type { SpanRef } from "../design/TextBoxView";
import { useStudio } from "./StudioContext";
import { coverSpread } from "./studioGen";
import { duplicateSpread, moveSpread, removeSpread } from "./pageOps";

export type PageSubject =
  | { kind: "spread"; spread: ScreenplaySpread }
  | { kind: "cover"; coverId: string; cover: CoverSpec };

/** Derived per-page values shared by the stage and the controls. */
function genSpreadFor(subject: PageSubject): ScreenplaySpread {
  return subject.kind === "spread"
    ? subject.spread
    : coverSpread(subject.coverId, subject.cover);
}

/**
 * The interactive page surface only: image + overlay (text/shapes), with inline
 * text editing (double-click) and drop-target wiring. No chrome of its own when
 * `chromeless`, so a wrapper can frame two facing pages as one spread.
 */
export function PageStagePanel({
  page,
  subject,
  chromeless = false,
}: {
  page: DesignPage;
  subject: PageSubject;
  chromeless?: boolean;
}) {
  const { project, selection, select, pageDesign, patchBox, patchShape, patchImage, snap, grid } =
    useStudio();

  const coverMode = subject.kind === "cover";
  const blank = subject.kind === "spread" && !!subject.spread.blankCanvas;
  const genSpread = genSpreadFor(subject);

  const tree = project.illustrations?.[page.id];
  const cursor = tree ? getCursor(tree).content : null;
  const url = useBlobUrl(cursor?.blobId ?? page.blobId);

  const pd = pageDesign(page.id);
  const onThisPage =
    (selection.kind === "box" || selection.kind === "shape" || selection.kind === "image") &&
    selection.pageId === page.id;
  const selectedElementId = onThisPage
    ? selection.kind === "box"
      ? selection.boxId
      : selection.kind === "shape"
        ? selection.shapeId
        : selection.imageId
    : null;
  const selectedSpan = selection.kind === "box" && onThisPage ? selection.span : null;

  return (
    <PageStage
      pageDesign={pd}
      imageUrl={blank ? undefined : url ?? undefined}
      aspect={page.aspect}
      dropId={page.id}
      chromeless={chromeless}
      snap={snap}
      grid={grid}
      showGutter={!coverMode && genSpread.kind === "spread"}
      selectedId={selectedElementId}
      onSelectElement={(ref) => {
        if (!ref) {
          select({ kind: "page", pageId: page.id });
        } else if (ref.kind === "text") {
          select({ kind: "box", pageId: page.id, boxId: ref.id, span: null });
        } else if (ref.kind === "shape") {
          select({ kind: "shape", pageId: page.id, shapeId: ref.id });
        } else {
          select({ kind: "image", pageId: page.id, imageId: ref.id });
        }
      }}
      onChangeElement={(id, kind, patch) =>
        kind === "text"
          ? patchBox(page.id, id, patch)
          : kind === "shape"
            ? patchShape(page.id, id, patch)
            : patchImage(page.id, id, patch)
      }
      onEditText={(id, value) =>
        patchBox(page.id, id, { paragraphs: wordParagraphs(value) })
      }
      onEditRichText={(id, paragraphs) => patchBox(page.id, id, { paragraphs })}
      selectedSpan={selectedSpan}
      onSelectSpan={(ref: SpanRef | null) => {
        if (selection.kind === "box" && onThisPage)
          select({ kind: "box", pageId: page.id, boxId: selection.boxId, span: ref });
      }}
    />
  );
}

/**
 * The editing controls for one page: per-page toolbar (add text/shape, page
 * menu), illustration generation + version history, anchors, and the
 * collapsible art-direction brief.
 */
export function PageControls({
  page,
  subject,
  anchors,
  stale,
  label,
}: {
  page: DesignPage;
  subject: PageSubject;
  anchors: Anchor[];
  stale: boolean;
  /** Overrides the displayed page label (e.g. physical page number). */
  label?: string;
}) {
  const { project, addBox, addShape, generatingPages, setPageGenerating } = useStudio();
  const setScreenplay = useProjectsStore((s) => s.setScreenplay);
  const updateSpread = useProjectsStore((s) => s.updateSpread);
  const [edit, setEdit] = useState("");
  const [showBrief, setShowBrief] = useState(false);

  const coverMode = subject.kind === "cover";
  const blank = subject.kind === "spread" && !!subject.spread.blankCanvas;
  const genSpread = genSpreadFor(subject);

  const tree = project.illustrations?.[page.id];
  const cursor = tree ? getCursor(tree).content : null;
  const versions = tree ? allVersions(tree) : [];
  const generating = generatingPages.has(page.id);

  const anchorIds = subject.kind === "spread" ? subject.spread.anchorIds : subject.cover.anchorIds;
  const changedHere = stale && cursor ? changedAnchorsForSpread(project, page.id) : [];

  /** Patch the underlying screenplay subject (a content spread or a cover spec). */
  function patchSubject(patch: Partial<ScreenplaySpread> & Partial<CoverSpec>) {
    if (subject.kind === "spread") {
      void updateSpread(subject.spread.id, patch);
      return;
    }
    const t = project.screenplay;
    if (!t) return;
    const doc = structuredClone(getCursor(t).content);
    const key = subject.coverId === COVER_FRONT_ID ? "frontCover" : "backCover";
    const base: CoverSpec = doc[key] ?? { title: "", subtitle: "", illustration: "", anchorIds: [] };
    doc[key] = { ...base, ...patch } as CoverSpec;
    void setScreenplay(updateNodeContent(t, t.cursorId, doc));
  }

  function toggleAnchor(id: string) {
    const has = anchorIds.includes(id);
    patchSubject({ anchorIds: has ? anchorIds.filter((a) => a !== id) : [...anchorIds, id] });
  }

  async function generate(options: Parameters<typeof generateIllustrationVersion>[1] = {}) {
    setPageGenerating(page.id, true);
    try {
      let target = genSpread;
      if (!coverMode && options.edit?.trim()) {
        const lower = options.edit.toLowerCase();
        const toAdd = anchors.filter(
          (a) => !anchorIds.includes(a.id) && lower.includes(a.name.toLowerCase()),
        );
        if (toAdd.length > 0) {
          const ids = [...anchorIds, ...toAdd.map((a) => a.id)];
          await updateSpread(genSpread.id, { anchorIds: ids });
          target = { ...genSpread, anchorIds: ids };
        }
      }
      await generateIllustrationVersion(target, options);
      setEdit("");
    } catch (err) {
      notify.error(err);
    } finally {
      setPageGenerating(page.id, false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Per-page toolbar */}
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-ink-800">{label ?? page.label}</span>
        {page.isCover ? (
          <Badge tone="brand">Cover</Badge>
        ) : blank ? (
          <Badge tone="neutral">Blank page</Badge>
        ) : (
          <Badge tone={genSpread.kind === "spread" ? "accent" : "neutral"}>
            {genSpread.kind === "spread" ? "Double spread" : "Single page"}
          </Badge>
        )}
        {stale && cursor && <Badge tone="accent">Reference changed</Badge>}
        <div className="ml-auto flex items-center gap-1">
          <ToolButton title="Add text box" onClick={() => addBox(page.id)} icon={<Plus className="size-3.5" />}>
            Text
          </ToolButton>
          <ShapeMenu onAdd={(kind) => addShape(page.id, kind)} />
          {subject.kind === "spread" && <PageMenu spreadId={subject.spread.id} />}
        </div>
      </div>

      {/* Version history */}
      {versions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {versions.map((node, i) => (
            <VersionThumb
              key={node.id}
              blobId={node.content.blobId}
              index={i + 1}
              active={node.id === tree?.cursorId}
              onClick={() => tree && void setIllustrationVersion(page.id, node.id)}
            />
          ))}
        </div>
      )}

      {blank ? (
        <p className="text-xs leading-relaxed text-ink-400">
          A blank page. Add <span className="font-medium text-ink-500">Text</span> or a{" "}
          <span className="font-medium text-ink-500">Shape</span> above (or double-click text on the
          page to edit it), and set a background or pattern from the inspector on the right.
        </p>
      ) : (
        <>
          {genSpread.text.trim() && !coverMode && (
            <p className="line-clamp-2 text-sm italic text-ink-500">"{genSpread.text.trim()}"</p>
          )}

          {stale && cursor && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-amber-800">
                <RefreshCw className="size-3.5 shrink-0" />
                {changedHere.length > 0
                  ? `${formatList(changedHere.map((a) => a.name))} changed.`
                  : "A reference changed."}
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

          {/* Anchors used on this page */}
          {anchors.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-500">
                {coverMode ? "Featured characters & places" : "Characters & places here"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {anchors.map((a) => (
                  <AnchorToggle
                    key={a.id}
                    anchor={a}
                    active={anchorIds.includes(a.id)}
                    onClick={() => toggleAnchor(a.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Generation controls */}
          <div className="space-y-2">
            {!cursor ? (
              <Button
                className="w-full"
                loading={generating}
                leftIcon={<Sparkles className="size-4" />}
                onClick={() => void generate()}
              >
                Generate illustration
              </Button>
            ) : (
              <>
                <Input
                  value={edit}
                  onChange={(e) => setEdit(e.target.value)}
                  placeholder="Refine, e.g. warmer light, add a butterfly…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && edit.trim() && !generating)
                      void generate({ edit, useReference: true });
                  }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    loading={generating}
                    leftIcon={<GitBranch className="size-4" />}
                    disabled={!edit.trim()}
                    onClick={() => void generate({ edit, useReference: true })}
                  >
                    Apply edit
                  </Button>
                  <Button
                    variant="secondary"
                    loading={generating}
                    leftIcon={<RotateCcw className="size-4" />}
                    onClick={() => void generate()}
                  >
                    Regenerate
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Art direction (collapsible) */}
          <div className="rounded-xl border border-ink-100">
            <button
              onClick={() => setShowBrief((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-left"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-600">
                <Wand2 className="size-3.5 text-ink-400" /> Art direction
                <span className="font-normal text-ink-400">(AI inputs)</span>
              </span>
              <ChevronDown
                className={cn("size-4 text-ink-400 transition-transform", showBrief && "rotate-180")}
              />
            </button>
            <AnimatePresence initial={false}>
              {showBrief && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 border-t border-ink-100 px-3 py-3">
                    {coverMode && subject.kind === "cover" ? (
                      <>
                        <Field label="Title">
                          <Input
                            value={subject.cover.title ?? ""}
                            onChange={(e) => patchSubject({ title: e.target.value })}
                          />
                        </Field>
                        <Field label="Subtitle">
                          <Input
                            value={subject.cover.subtitle ?? ""}
                            onChange={(e) => patchSubject({ subtitle: e.target.value })}
                          />
                        </Field>
                      </>
                    ) : (
                      <Field label="Story text (drives the illustration)">
                        <Textarea
                          rows={2}
                          value={genSpread.text}
                          onChange={(e) => patchSubject({ text: e.target.value })}
                        />
                      </Field>
                    )}
                    <Field label="Illustration brief">
                      <Textarea
                        rows={2}
                        value={genSpread.illustration}
                        onChange={(e) => patchSubject({ illustration: e.target.value })}
                        placeholder="What the picture shows…"
                      />
                    </Field>
                    {!coverMode && (
                      <Field label="Layout note">
                        <Input
                          value={genSpread.layoutNote}
                          onChange={(e) => patchSubject({ layoutNote: e.target.value })}
                          placeholder="e.g. text in a band along the bottom"
                        />
                      </Field>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}

/** Move the illustration version cursor for a page. */
function setIllustrationVersion(pageId: string, nodeId: string) {
  const project = useProjectsStore.getState().current();
  const tree = project?.illustrations?.[pageId];
  if (!tree) return;
  void useProjectsStore.getState().setIllustration(pageId, selectVersion(tree, nodeId));
}

function ToolButton({
  children,
  icon,
  onClick,
  title,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
    >
      {icon} {children}
    </button>
  );
}

/** "Add shape" popover with a grid of shape previews. */
function ShapeMenu({ onAdd }: { onAdd: (kind: ShapeKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Add a shape"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
      >
        <Shapes className="size-3.5" /> Shape
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} aria-label="Close" />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 z-40 mt-1 w-52 rounded-2xl border border-ink-200 bg-white p-2 shadow-lifted"
            >
              <div className="grid grid-cols-4 gap-1.5">
                {SHAPE_DEFS.map((def) => {
                  const d = shapePath(def.id, 26, 26, { corner: 0.18, points: 5, tailX: 0.32 });
                  return (
                    <button
                      key={def.id}
                      title={def.label}
                      onClick={() => {
                        onAdd(def.id);
                        setOpen(false);
                      }}
                      className="flex aspect-square items-center justify-center rounded-lg border border-ink-200 bg-white transition hover:border-brand-400 hover:bg-brand-50"
                    >
                      <svg width={34} height={34} viewBox="0 0 34 34">
                        <g transform="translate(4 4)">
                          <path d={d} fill="rgba(71,85,105,0.85)" />
                        </g>
                      </svg>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Per-page actions: move, duplicate, delete. */
function PageMenu({ spreadId }: { spreadId: string }) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  function run(fn: () => void) {
    fn();
    setOpen(false);
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Page options"
        className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
      >
        <MoreHorizontal className="size-4" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} aria-label="Close" />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 z-40 mt-1 w-40 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lifted"
            >
              <MenuItem icon={<MoveUp className="size-4" />} onClick={() => run(() => moveSpread(spreadId, -1))}>
                Move up
              </MenuItem>
              <MenuItem icon={<MoveDown className="size-4" />} onClick={() => run(() => moveSpread(spreadId, 1))}>
                Move down
              </MenuItem>
              <MenuItem icon={<Copy className="size-4" />} onClick={() => run(() => duplicateSpread(spreadId))}>
                Duplicate
              </MenuItem>
              <MenuItem
                icon={<Trash2 className="size-4" />}
                danger
                onClick={() => run(() => setConfirmingDelete(true))}
              >
                Delete
              </MenuItem>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this page?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmingDelete(false);
                removeSpread(spreadId);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This removes the page and its generated art from the book. This can't be undone.
        </p>
      </Modal>
    </div>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-ink-50",
        danger ? "text-red-600 hover:bg-red-50" : "text-ink-600",
      )}
    >
      {icon} {children}
    </button>
  );
}

function AnchorToggle({
  anchor,
  active,
  onClick,
}: {
  anchor: Anchor;
  active: boolean;
  onClick: () => void;
}) {
  const blobId = anchor.versions?.nodes[anchor.versions.cursorId]?.content.blobId;
  const url = useBlobUrl(blobId);
  return (
    <button onClick={onClick} className="transition active:scale-95" title={active ? "On this page" : "Add to this page"}>
      <Badge tone={active ? "brand" : "neutral"} className={active ? "" : "opacity-60"}>
        {url ? <img src={url} alt="" className="-ml-0.5 size-4 rounded-full object-cover" /> : null}
        {anchor.name}
      </Badge>
    </button>
  );
}

function VersionThumb({
  blobId,
  index,
  active,
  onClick,
}: {
  blobId: string;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const url = useBlobUrl(blobId);
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative size-11 shrink-0 overflow-hidden rounded-lg ring-2 transition",
        active ? "ring-brand-500" : "ring-transparent hover:ring-ink-200",
      )}
    >
      {url ? (
        <img src={url} alt={`Version ${index}`} className="size-full object-cover" />
      ) : (
        <div className="size-full bg-ink-100" />
      )}
    </button>
  );
}
