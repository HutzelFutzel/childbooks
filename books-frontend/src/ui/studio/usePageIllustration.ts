/**
 * Shared page/cover illustration actions for Design mode — generate, edit,
 * try-again, update scene, cast toggles, and version history. Powers the
 * Canva-style ImageStyleBar / ImageEditPanel (and the legacy PageControls
 * drawer when still open).
 */
import { useMemo, useState } from "react";
import type { Anchor, CoverSpec, ScreenplaySpread } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { effectiveAnchorIds } from "../../core/book/anchorRefs";
import { allVersions, getCursor, selectVersion, updateNodeContent } from "../../core/versioning";
import {
  changedAnchorsForSpread,
  generateIllustrationVersion,
  isIllustrationStale,
  staleAnchorIds,
} from "../../state/ai";
import { IntentAmbiguousError } from "../../platform/aiClient";
import { useProjectsStore } from "../../state/projectsStore";
import { useJobsStore } from "../../state/jobsStore";
import { useImageActionRange } from "../layout/SparkCost";
import { notify } from "../lib/notify";
import {
  illustrationMatchesLayout,
  type DesignPage,
} from "../design/designInit";
import { coverSpread, refreshSpread, updateAnchorsThenSpread } from "./studioGen";
import { useStudio } from "./StudioContext";
import type { PageSubject } from "./PageEditorCard";

function genSpreadFor(subject: PageSubject): ScreenplaySpread {
  return subject.kind === "spread"
    ? subject.spread
    : coverSpread(subject.coverId, subject.cover);
}

/** Resolve the screenplay subject for a design page id. */
export function subjectForPage(
  pageId: string,
  project: ReturnType<typeof useStudio>["project"],
): PageSubject | null {
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  if (!doc) return null;
  if (pageId === COVER_FRONT_ID && doc.frontCover) {
    return { kind: "cover", coverId: COVER_FRONT_ID, cover: doc.frontCover };
  }
  if (pageId === COVER_BACK_ID && doc.backCover) {
    return { kind: "cover", coverId: COVER_BACK_ID, cover: doc.backCover };
  }
  const spread = doc.spreads.find((s) => s.id === pageId);
  return spread ? { kind: "spread", spread } : null;
}

export function usePageIllustration(pageId: string) {
  const { project, pages, generatingPages, setPageGenerating, selectIllustration } = useStudio();
  const setScreenplay = useProjectsStore((s) => s.setScreenplay);
  const updateSpread = useProjectsStore((s) => s.updateSpread);
  const setBookTitle = useProjectsStore((s) => s.setBookTitle);

  const [edit, setEdit] = useState("");
  const [intentPick, setIntentPick] = useState<{
    edit: string;
    candidates: { anchorId: string; name: string; brief?: string }[];
  } | null>(null);

  const page: DesignPage | undefined = pages.find((p) => p.id === pageId);
  const subject = subjectForPage(pageId, project);
  const anchors = useMemo(
    () => (project.anchors ?? []).filter((a) => a.include),
    [project.anchors],
  );

  const coverMode = subject?.kind === "cover";
  const blank = subject?.kind === "spread" && !!subject.spread.blankCanvas;
  const genSpread = subject ? genSpreadFor(subject) : null;

  const tree = project.illustrations?.[pageId];
  const cursor = tree ? getCursor(tree).content : null;
  const versions = tree ? allVersions(tree) : [];

  const jobActive = useJobsStore((s) =>
    genSpread ? s.activeUnitIds.has(genSpread.id) : false,
  );
  const generating = generatingPages.has(pageId) || jobActive;
  // An edit is priced from the edit window: it re-renders one region per subject
  // rather than one image for the page, so quoting it as a fresh render
  // undershot the charge by however many subjects the instruction touches.
  const sparkRange = useImageActionRange(
    coverMode ? "coverIllustration" : "pageIllustration",
    edit.trim() ? "edit" : "fresh",
  );

  const subjectRef = subject
    ? subject.kind === "spread"
      ? subject.spread
      : subject.cover
    : null;
  const anchorIds = subjectRef?.anchorIds ?? [];
  const activeIds = subjectRef ? effectiveAnchorIds(anchors, subjectRef) : [];

  /** Anchors recorded on the current illustration version (what the art depicts). */
  const drawnAnchorIds = useMemo(() => {
    if (!cursor?.references?.length) return [] as string[];
    const known = new Set(anchors.map((a) => a.id));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const ref of cursor.references) {
      if (!known.has(ref.anchorId) || seen.has(ref.anchorId)) continue;
      seen.add(ref.anchorId);
      out.push(ref.anchorId);
    }
    return out;
  }, [cursor?.references, anchors]);

  const changedHere = useMemo(
    () => (cursor ? changedAnchorsForSpread(project, pageId) : []),
    // Recompute when the art or the project's anchors/screenplay change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.anchors, project.illustrations, project.screenplay, pageId, cursor?.blobId],
  );
  const isStale = useMemo(
    () => !!cursor && isIllustrationStale(project, pageId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.anchors, project.illustrations, project.screenplay, pageId, cursor?.blobId],
  );
  const layoutStale = page ? !illustrationMatchesLayout(project, page) : false;

  const staleRefAnchors = useMemo(() => {
    if (changedHere.length === 0) return [] as Anchor[];
    const staleSet = new Set(staleAnchorIds(project));
    return changedHere.filter((a) => staleSet.has(a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.anchors, isStale, cursor?.blobId, changedHere]);

  async function patchSubject(patch: Partial<ScreenplaySpread> & Partial<CoverSpec>) {
    if (!subject) return;
    if (subject.kind === "spread") {
      await updateSpread(subject.spread.id, patch);
      return;
    }
    const t = project.screenplay;
    if (!t) return;
    const doc = structuredClone(getCursor(t).content);
    const key = subject.coverId === COVER_FRONT_ID ? "frontCover" : "backCover";
    const base: CoverSpec = doc[key] ?? { title: "", subtitle: "", illustration: "", anchorIds: [] };
    doc[key] = { ...base, ...patch } as CoverSpec;
    await setScreenplay(updateNodeContent(t, t.cursorId, doc));
  }

  function toggleAnchor(id: string) {
    const has = anchorIds.includes(id);
    void setActiveAnchors(
      has ? anchorIds.filter((a) => a !== id) : [...anchorIds, id],
    );
  }

  /** Commit the page/cover cast (ids + self-healing names). */
  async function setActiveAnchors(ids: string[]) {
    const byId = new Map(anchors.map((a) => [a.id, a]));
    const next = ids.filter((id) => byId.has(id));
    await patchSubject({
      anchorIds: next,
      anchorNames: next.map((id) => byId.get(id)?.name ?? ""),
    });
  }

  /** Bind a durable illustration frame before enqueueing work so loading attaches to it. */
  function ensureArtFrame() {
    if (blank) return;
    // Allow an empty frame only for in-flight generation (veil / job target).
    selectIllustration(pageId, { createIfMissing: true });
  }

  async function generate(options: Parameters<typeof generateIllustrationVersion>[1] = {}) {
    // Prefer the live project — scene text may have just flushed from a buffered field.
    const live = useProjectsStore.getState().current() ?? project;
    const liveSubject = subjectForPage(pageId, live);
    const liveSpread = liveSubject ? genSpreadFor(liveSubject) : genSpread;
    if (!liveSpread) return;
    ensureArtFrame();
    if (!options.edit?.trim() && !options.mask) {
      setPageGenerating(pageId, true);
      try {
        await refreshSpread(live, liveSpread.id, {}, (err) => notify.error(err));
      } finally {
        setPageGenerating(pageId, false);
      }
      return;
    }
    setPageGenerating(pageId, true);
    try {
      let target = liveSpread;
      if (!coverMode && options.edit?.trim()) {
        const lower = options.edit.toLowerCase();
        const toAdd = anchors.filter(
          (a) => !anchorIds.includes(a.id) && lower.includes(a.name.toLowerCase()),
        );
        if (toAdd.length > 0) {
          const ids = [...anchorIds, ...toAdd.map((a) => a.id)];
          await updateSpread(liveSpread.id, { anchorIds: ids });
          target = { ...liveSpread, anchorIds: ids };
        }
      }
      await generateIllustrationVersion(target, options);
      setEdit("");
      setIntentPick(null);
    } catch (err) {
      if (err instanceof IntentAmbiguousError) {
        setIntentPick({
          edit: options.edit?.trim() || edit.trim(),
          candidates: err.candidates,
        });
        return;
      }
      notify.error(err);
    } finally {
      setPageGenerating(pageId, false);
    }
  }

  async function applyEdit() {
    if (!edit.trim()) return;
    await generate({ edit, useReference: true });
  }

  async function tryAgain() {
    await generate();
  }

  async function upgradeQuality() {
    if (!genSpread) return;
    ensureArtFrame();
    setPageGenerating(pageId, true);
    try {
      const latest = useProjectsStore.getState().current() ?? project;
      await refreshSpread(
        latest,
        genSpread.id,
        { useReference: true, tier: "premium" },
        (err) => notify.error(err),
      );
    } finally {
      setPageGenerating(pageId, false);
    }
  }

  async function applyIntentPick(anchorId: string) {
    if (!intentPick) return;
    await generate({
      edit: intentPick.edit,
      useReference: true,
      intentTargetAnchorId: anchorId,
    });
  }

  /** Update scene after cast/looks changed — chains stale looks first when needed. */
  async function updateScene() {
    if (!genSpread) return;
    ensureArtFrame();
    setPageGenerating(pageId, true);
    try {
      // Prefer the store snapshot so a cast commit immediately before this
      // call is visible to the refresh job.
      const latest =
        useProjectsStore.getState().projects.find((p) => p.id === project.id) ?? project;
      const staleLooks = staleRefAnchors.map((a) => a.id);
      if (staleLooks.length > 0) {
        await updateAnchorsThenSpread(
          latest,
          genSpread.id,
          staleLooks,
          (err) => notify.error(err),
        );
      } else {
        await refreshSpread(
          latest,
          genSpread.id,
          { useReference: true },
          (err) => notify.error(err),
        );
      }
    } finally {
      setPageGenerating(pageId, false);
    }
  }

  /** Redraw for a different layout/composition. */
  async function redrawLayout() {
    if (!genSpread) return;
    ensureArtFrame();
    setPageGenerating(pageId, true);
    try {
      await refreshSpread(
        project,
        genSpread.id,
        { useReference: true },
        (err) => notify.error(err),
      );
    } finally {
      setPageGenerating(pageId, false);
    }
  }

  function setVersion(nodeId: string) {
    if (!tree) return;
    void useProjectsStore.getState().setIllustration(pageId, selectVersion(tree, nodeId));
  }

  function deleteVersion(nodeId: string) {
    void useProjectsStore.getState().deleteIllustrationVersion(pageId, nodeId);
  }

  return {
    page,
    subject,
    anchors,
    coverMode,
    blank: !!blank,
    genSpread,
    cursor,
    versions,
    tree,
    generating,
    sparkRange,
    anchorIds,
    activeIds,
    drawnAnchorIds,
    changedHere,
    isStale,
    layoutStale,
    staleRefAnchors,
    edit,
    setEdit,
    intentPick,
    setIntentPick,
    patchSubject,
    toggleAnchor,
    setActiveAnchors,
    generate,
    applyEdit,
    tryAgain,
    upgradeQuality,
    applyIntentPick,
    updateScene,
    redrawLayout,
    setVersion,
    deleteVersion,
    setBookTitle,
  };
}

export type PageIllustrationApi = ReturnType<typeof usePageIllustration>;
