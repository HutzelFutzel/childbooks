import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Box,
  GripVertical,
  ImagePlus,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  User,
  Wand2,
  X,
} from "lucide-react";
import { ART_STYLE_PRESETS, AGE_RANGES } from "../../core/config/options";
import { ageBandHasReadingModes, readingModeLabel } from "../../core/config/ageWritingCatalog";
import { bookProductForConfig } from "../../core/book";
import { isAbortError } from "../../core/errors";
import type { Anchor, AnchorType } from "../../core/types";
import type { AssetItem } from "../../core/settings";
import {
  analyzeCurrentStory,
  currentAnchorImage,
  currentIllustration,
  staleAnchorIds,
  staleIllustrationSpreadIds,
} from "../../state/ai";
import { putBlob } from "../../state/blobs";
import { useProjectsStore } from "../../state/projectsStore";
import { useSettingsStore } from "../../state/settingsStore";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { SparkEstimateCost, useImageBatchRange } from "../layout/SparkCost";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import { useDragSource } from "./StudioDnd";
import {
  generateAllAnchors,
  generateAllPages,
  illustrationUnits,
  refreshStalePages,
  updateStaleAnchors,
} from "./studioGen";

const TYPE_ICON: Record<AnchorType, typeof User> = {
  character: User,
  place: MapPin,
  object: Box,
};

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function StudioSidebar() {
  const {
    project,
    selection,
    select,
    openSetup,
    generatingAnchors,
    busy,
    setBusy,
    setAnchorGenerating,
    setPageGenerating,
    startGeneration,
    cancelGeneration,
  } = useStudio();
  const setAnchors = useProjectsStore((s) => s.setAnchors);
  const models = useResolvedModels();
  const [analyzing, setAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Staleness scans every version tree; memoize per project snapshot so the
  // sidebar doesn't recompute it on unrelated re-renders.
  const stalePageIds = useMemo(() => staleIllustrationSpreadIds(project), [project]);
  const stale = useMemo(() => new Set(staleAnchorIds(project)), [project]);
  const staleCount = stalePageIds.length;

  const anchors = (project.anchors ?? []).filter((a) => a.include);
  const staleAnchorCount = anchors.filter(
    (a) => stale.has(a.id) && currentAnchorImage(a),
  ).length;
  const anchorsReady = anchors.filter((a) => currentAnchorImage(a)).length;

  const units = illustrationUnits(project);
  const pagesReady = units.filter((s) => currentIllustration(project, s.id)).length;

  const styleLabel = project.config.artStyle.presetId
    ? ART_STYLE_PRESETS.find((s) => s.id === project.config.artStyle.presetId)?.label ?? "Custom"
    : "Custom";
  const ageBase = AGE_RANGES.find((a) => a.id === project.config.ageRangeId)?.label ?? project.config.ageRangeId;
  const ageLabel =
    ageBandHasReadingModes(project.config.ageRangeId) && project.config.readingModeId
      ? `${ageBase} · ${readingModeLabel(project.config.readingModeId)}`
      : ageBase;
  const sizeLabel = bookProductForConfig(project.config).label;

  const everythingDone =
    anchors.length > 0 && anchorsReady === anchors.length && units.length > 0 && pagesReady === units.length;

  // Spark cost preview for the whole remaining batch (anchors + pages).
  const batchRange = useImageBatchRange([
    { action: "anchorImage", count: Math.max(0, anchors.length - anchorsReady) },
    { action: "pageIllustration", count: Math.max(0, units.length - pagesReady) },
  ]);

  async function reanalyze() {
    setAnalyzing(true);
    try {
      await analyzeCurrentStory();
      notify.success("Story re-analyzed", "Characters & places refreshed.");
    } catch (err) {
      notify.error(err);
    } finally {
      setAnalyzing(false);
    }
  }

  function addAnchor() {
    const next: Anchor = {
      id: uid(),
      name: "New character",
      type: "character",
      description: "",
      importance: "medium",
      mode: "creative",
      include: true,
    };
    void setAnchors([...(project.anchors ?? []), next]).then(() =>
      select({ kind: "anchor", anchorId: next.id }),
    );
  }

  /**
   * Update everything stale in the right ORDER: first re-render outdated anchor
   * sheets (waiting for their results, since the pages must reference the NEW
   * sheets), then queue the stale pages — including any that only became stale
   * because of the anchor updates in step one.
   */
  async function refreshStale() {
    if (!models) {
      notify.error("AI generation isn't available yet — it's being set up on the server.");
      return;
    }
    setRefreshing(true);
    try {
      const updatedAnchors = await updateStaleAnchors(
        useProjectsStore.getState().current()!,
        (err) => notify.error(err),
      );
      if (updatedAnchors > 0) {
        notify.info(
          "References updated",
          `${updatedAnchors} reference sheet${updatedAnchors === 1 ? "" : "s"} re-rendered — now updating the affected pages.`,
        );
      }
      const queued = await refreshStalePages(
        useProjectsStore.getState().current()!,
        (err) => notify.error(err),
      );
      if (queued > 0) {
        notify.info(
          "Updating pages",
          `${queued} stale page${queued === 1 ? "" : "s"} are re-rendering in the background — they'll update as each finishes.`,
        );
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function generateEverything() {
    if (!models) {
      notify.error("AI generation isn't available yet — it's being set up on the server.");
      return;
    }
    const signal = startGeneration();
    let failures = 0;
    const onError = (err: unknown) => {
      if (isAbortError(err)) return; // cancellations are not failures
      failures += 1;
      notify.error(err);
    };
    setBusy(true);
    try {
      await generateAllAnchors(useProjectsStore.getState().current()!, setAnchorGenerating, onError, signal);
      if (!signal.aborted) {
        await generateAllPages(useProjectsStore.getState().current()!, setPageGenerating, onError, signal);
      }

      if (signal.aborted) {
        notify.info("Generation cancelled", "Anything already finished was kept.");
      } else if (failures === 0) {
        notify.success("Your book is generated", "Tap any page to refine the art or layout.");
      } else {
        notify.info(
          "Finished with some errors",
          `${failures} item${failures === 1 ? "" : "s"} couldn't be generated — retry them individually.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Story brief */}
      <section className="border-b border-ink-100 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Story</p>
            <h2 className="mt-0.5 truncate text-sm font-bold text-ink-900">{project.title}</h2>
          </div>
          <button
            onClick={openSetup}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
        </div>
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-500">
          {project.config.storyText.trim() || "No story text yet."}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="brand">{styleLabel}</Badge>
          <Badge tone="neutral">{ageLabel}</Badge>
          <Badge tone="neutral">{sizeLabel}</Badge>
        </div>
        {project.analysis?.summary && (
          <p className="mt-3 flex gap-1.5 rounded-lg bg-brand-50/60 p-2.5 text-[11px] leading-relaxed text-ink-600">
            <Sparkles className="mt-0.5 size-3 shrink-0 text-brand-500" />
            <span className="line-clamp-3">{project.analysis.summary}</span>
          </p>
        )}
      </section>

      {/* Characters & places */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Characters &amp; places
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void reanalyze()}
              title="Re-analyze story"
              className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-brand-600"
            >
              {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            </button>
            <button
              onClick={addAnchor}
              title="Add character or place"
              className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-brand-600"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-2 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
          {anchors.length === 0 ? (
            <div className="mx-1 flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-200 px-3 py-8 text-center">
              {analyzing ? (
                <>
                  <Loader2 className="size-5 animate-spin text-brand-500" />
                  <p className="text-xs text-ink-500">Reading your story…</p>
                </>
              ) : (
                <>
                  <Sparkles className="size-5 text-ink-300" />
                  <p className="text-xs text-ink-500">
                    Characters &amp; places will appear here automatically.
                  </p>
                </>
              )}
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {anchors.map((anchor) => (
                <AnchorRow
                  key={anchor.id}
                  anchor={anchor}
                  active={selection.kind === "anchor" && selection.anchorId === anchor.id}
                  generating={generatingAnchors.has(anchor.id)}
                  stale={stale.has(anchor.id)}
                  onClick={() => select({ kind: "anchor", anchorId: anchor.id })}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </section>

      {/* Custom assets */}
      <AssetsLibrary />

      {/* Generate everything */}
      <section className="border-t border-ink-100 p-4">
        <div className="mb-2 flex items-center justify-between text-[11px] text-ink-500">
          <span>References {anchorsReady}/{anchors.length || 0}</span>
          <span>Pages {pagesReady}/{units.length || 0}</span>
        </div>
        <Button
          className="w-full"
          size="lg"
          loading={busy}
          disabled={everythingDone}
          leftIcon={!busy ? <Sparkles className="size-5" /> : undefined}
          onClick={() => void generateEverything()}
        >
          {busy ? "Generating…" : everythingDone ? "All generated" : "Generate everything"}
          {!busy && !everythingDone && <SparkEstimateCost range={batchRange} />}
        </Button>
        {busy && (
          <button
            onClick={cancelGeneration}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-red-600"
          >
            <X className="size-3.5" /> Cancel generation
          </button>
        )}
        {!busy && (staleCount > 0 || staleAnchorCount > 0) && (
          <Button
            className="mt-2 w-full"
            variant="secondary"
            size="sm"
            loading={refreshing}
            leftIcon={!refreshing ? <RefreshCw className="size-4" /> : undefined}
            onClick={() => void refreshStale()}
          >
            {refreshing
              ? "Updating references…"
              : staleAnchorCount > 0
                ? `Update ${staleAnchorCount} reference${staleAnchorCount === 1 ? "" : "s"}${staleCount > 0 ? ` + ${staleCount} page${staleCount === 1 ? "" : "s"}` : ""}`
                : `Update ${staleCount} stale page${staleCount === 1 ? "" : "s"}`}
          </Button>
        )}
        {!models && (
          <p className="mt-2 text-center text-[11px] text-amber-600">
            AI generation is being set up on the server.
          </p>
        )}
      </section>
    </div>
  );
}

/** Read the intrinsic aspect ratio (w/h) of an image file. */
function imageAspect(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(1);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Uploadable, draggable library of reusable image assets. */
function AssetsLibrary() {
  const assets = useSettingsStore((s) => s.settings.assets);
  const addAsset = useSettingsStore((s) => s.addAsset);
  const removeAsset = useSettingsStore((s) => s.removeAsset);
  const { addAssetImage, selection, pages } = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const activePageId =
    selection.kind === "page" ||
    selection.kind === "box" ||
    selection.kind === "shape" ||
    selection.kind === "image"
      ? selection.pageId
      : pages[0]?.id;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const blobId = await putBlob(file);
        const aspect = await imageAspect(file);
        addAsset({
          id: Math.random().toString(36).slice(2, 10),
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Image",
          blobId,
          aspect,
        });
      }
    } catch (err) {
      notify.error(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="border-t border-ink-100 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">My assets</p>
        <button
          onClick={() => fileRef.current?.click()}
          title="Upload images"
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {assets.length === 0 ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="mt-2 flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-ink-200 px-3 py-5 text-center transition hover:border-brand-300 hover:bg-brand-50/40"
        >
          <ImagePlus className="size-5 text-ink-300" />
          <span className="text-[11px] text-ink-500">Upload images to drag onto pages.</span>
        </button>
      ) : (
        <div className="mt-2 grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto">
          {assets.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              onRemove={() => removeAsset(asset.id)}
              onClick={activePageId ? () => addAssetImage(activePageId, asset) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AssetTile({
  asset,
  onRemove,
  onClick,
}: {
  asset: AssetItem;
  onRemove: () => void;
  onClick?: () => void;
}) {
  const url = useBlobUrl(asset.blobId);
  const drag = useDragSource(() => ({ type: "asset", asset, label: asset.name }), onClick);
  return (
    <div
      {...drag}
      title={`${asset.name} — drag onto a page${onClick ? " (or click to place)" : ""}`}
      className="group relative aspect-square cursor-grab touch-none overflow-hidden rounded-lg border border-ink-200 bg-ink-50 transition hover:border-brand-300 active:cursor-grabbing"
    >
      {url ? (
        <img
          src={url}
          alt={asset.name}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          className="size-full select-none object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center">
          <Loader2 className="size-4 animate-spin text-ink-300" />
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Remove asset"
        className="absolute right-0.5 top-0.5 hidden rounded bg-white/90 p-0.5 text-red-500 shadow-sm group-hover:block"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

function AnchorRow({
  anchor,
  active,
  generating,
  stale,
  onClick,
}: {
  anchor: Anchor;
  active: boolean;
  generating: boolean;
  stale: boolean;
  onClick: () => void;
}) {
  const image = currentAnchorImage(anchor);
  const url = useBlobUrl(image?.blobId);
  const Icon = TYPE_ICON[anchor.type];
  const drag = useDragSource(
    () => ({ type: "anchor", anchorId: anchor.id, label: anchor.name, blobId: image?.blobId }),
    onClick,
  );

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      {...drag}
      className={cn(
        "group flex w-full touch-none items-center gap-3 rounded-xl px-2 py-2 text-left transition",
        active ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-ink-100",
      )}
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-100 ring-1 ring-inset ring-ink-200">
        {generating ? (
          <Loader2 className="size-4 animate-spin text-brand-500" />
        ) : url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            className="size-full select-none object-cover"
          />
        ) : (
          <Icon className="size-4 text-ink-400" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-800">{anchor.name}</span>
        <span className="flex items-center gap-1 text-[11px] capitalize text-ink-400">
          <Icon className="size-3" /> {anchor.type}
        </span>
      </span>
      <GripVertical className="size-3.5 shrink-0 text-ink-300 opacity-0 transition group-hover:opacity-100" />
      {stale ? (
        <RefreshCw className="size-3.5 shrink-0 text-accent-500" />
      ) : url ? (
        <span className="size-2 shrink-0 rounded-full bg-emerald-400" />
      ) : (
        <span className="size-2 shrink-0 rounded-full bg-ink-300" />
      )}
    </motion.button>
  );
}
