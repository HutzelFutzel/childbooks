import { create } from "zustand";
import type {
  Anchor,
  BookConfig,
  BookDesign,
  CoverSpec,
  IllustrationImage,
  PageDesign,
  Project,
  ProjectShare,
  ProjectStage,
  ScreenplayDoc,
  ScreenplaySpread,
  StoryAnalysis,
} from "../core/types";
import {
  allVersions,
  deleteVersion,
  getCursor,
  updateNodeContent,
  type VersionTree,
} from "../core/versioning";
import { reconcileAnchorIds } from "../core/book/anchorRefs";
import { collectProjectImageBlobIds } from "../core/book/blobRefs";
import { textFromParagraphs, wordParagraphs } from "../core/design";
import { COVER_FRONT_ID, createDefaultConfig, STAGE_ORDER } from "../core/types";
import { ProjectConflictError } from "../core/storage/repositories";
import { getRepos } from "./repos";
import { removeBlob } from "./blobs";
import { useSettingsStore } from "./settingsStore";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stageIndex(stage: ProjectStage): number {
  return STAGE_ORDER.indexOf(stage);
}

interface ProjectsState {
  projects: Project[];
  currentId: string | null;
  loaded: boolean;
  /**
   * Id of a project whose local copy is stale: a save was rejected because
   * another tab/device advanced the stored generation. Auto-saving is paused for
   * it until {@link ProjectsState.reloadProject} pulls the latest and clears this.
   */
  staleProjectId: string | null;

  load: () => Promise<void>;
  /** Re-fetch a project from storage, replacing the in-memory copy and clearing its stale flag. */
  reloadProject: (id: string) => Promise<void>;
  /** Create a project; `open` (default true) also makes it the current one. */
  createProject: (title?: string, open?: boolean) => Promise<string>;
  openProject: (id: string) => void;
  closeProject: () => void;
  deleteProject: (id: string) => Promise<void>;
  current: () => Project | null;

  updateConfig: (patch: Partial<BookConfig>) => Promise<void>;
  renameProject: (id: string, title: string) => Promise<void>;
  /**
   * Set the book title from any linked surface (story step, project name, or the
   * front-cover brief). Keeps the project title, the front-cover spec title and
   * the front-cover title text box in sync.
   */
  setBookTitle: (id: string, title: string) => Promise<void>;
  goToStage: (stage: ProjectStage) => Promise<void>;
  advanceStage: (stage: ProjectStage) => Promise<void>;

  setAnalysis: (analysis: StoryAnalysis, anchors: Anchor[]) => Promise<void>;
  setAnchors: (anchors: Anchor[]) => Promise<void>;
  updateAnchor: (anchorId: string, patch: Partial<Anchor>) => Promise<void>;
  removeAnchor: (anchorId: string) => Promise<void>;

  setScreenplay: (screenplay: VersionTree<ScreenplayDoc>) => Promise<void>;
  updateSpread: (
    spreadId: string,
    patch: Partial<ScreenplaySpread>,
  ) => Promise<void>;
  setIllustration: (
    spreadId: string,
    tree: VersionTree<IllustrationImage>,
  ) => Promise<void>;
  /**
   * Delete a single illustration version. When it is the last version the whole
   * illustration entry is removed. The dropped image blob(s) are garbage
   * collected (never referenced anywhere else).
   */
  deleteIllustrationVersion: (spreadId: string, versionId: string) => Promise<void>;
  /** Remove a spread's entire illustration history and GC its image blobs. */
  removeIllustration: (spreadId: string) => Promise<void>;
  /**
   * Delete a single anchor image version. When it is the last version the
   * anchor's `versions` tree is cleared. The dropped blob(s) are GC'd.
   */
  deleteAnchorVersion: (anchorId: string, versionId: string) => Promise<void>;

  setDesign: (design: BookDesign) => Promise<void>;
  updatePageDesign: (pageId: string, patch: Partial<PageDesign>) => Promise<void>;

  setShare: (share: ProjectShare) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  currentId: null,
  loaded: false,
  staleProjectId: null,

  async load() {
    const { projects } = await getRepos();
    const list = await projects.list();
    set({ projects: list, loaded: true });
  },

  async reloadProject(id) {
    const { projects } = await getRepos();
    const fresh = await projects.get(id);
    set((state) => {
      if (!fresh) {
        // Deleted elsewhere — drop it locally and close it if it was open.
        return {
          projects: state.projects.filter((p) => p.id !== id),
          currentId: state.currentId === id ? null : state.currentId,
          staleProjectId: state.staleProjectId === id ? null : state.staleProjectId,
        };
      }
      return {
        projects: state.projects.map((p) => (p.id === id ? fresh : p)),
        staleProjectId: state.staleProjectId === id ? null : state.staleProjectId,
      };
    });
  },

  async createProject(title, open = true) {
    const now = Date.now();
    const project: Project = {
      id: genId(),
      title: title?.trim() || "Untitled Story",
      createdAt: now,
      updatedAt: now,
      stage: "setup",
      furthestStage: "setup",
      config: createDefaultConfig(),
    };
    const { projects } = await getRepos();
    const saved = await projects.save(project);
    set((state) => ({
      projects: [saved, ...state.projects],
      ...(open ? { currentId: saved.id } : {}),
    }));
    return saved.id;
  },

  openProject(id) {
    set({ currentId: id });
  },

  closeProject() {
    set({ currentId: null });
  },

  async deleteProject(id) {
    // GC every image blob this project owns BEFORE dropping it, so deleting a
    // book doesn't leak its generated images in Storage forever. Version-tree
    // blobs are project-exclusive, so this is always safe; global uploaded
    // assets (settings.assets) are excluded by gcBlobs.
    const target = get().projects.find((p) => p.id === id);
    if (target) void gcBlobs(collectProjectImageBlobIds(target));

    const { projects } = await getRepos();
    await projects.remove(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentId: state.currentId === id ? null : state.currentId,
      staleProjectId: state.staleProjectId === id ? null : state.staleProjectId,
    }));
  },

  current() {
    const { projects, currentId } = get();
    return projects.find((p) => p.id === currentId) ?? null;
  },

  async updateConfig(patch) {
    await mutateCurrent(get, set, (p) => ({ ...p, config: { ...p.config, ...patch } }));
  },

  async renameProject(id, title) {
    await mutateProject(get, set, id, (p) => applyBookTitle(p, title));
  },

  async setBookTitle(id, title) {
    await mutateProject(get, set, id, (p) => applyBookTitle(p, title));
  },

  async goToStage(stage) {
    // Only allow navigating to stages already unlocked.
    await mutateCurrent(get, set, (p) =>
      stageIndex(stage) > stageIndex(p.furthestStage) ? p : { ...p, stage },
    );
  },

  async advanceStage(stage) {
    await mutateCurrent(get, set, (p) => ({
      ...p,
      stage,
      furthestStage:
        stageIndex(stage) > stageIndex(p.furthestStage) ? stage : p.furthestStage,
    }));
  },

  async setAnalysis(analysis, anchors) {
    // Re-analysis mints fresh anchors; preserve the ids (and images) of anchors
    // whose name is unchanged so existing screenplay/illustration references —
    // which point at anchors by id — don't drift and get silently ignored.
    await mutateCurrent(get, set, (p) => ({
      ...p,
      analysis,
      anchors: reconcileAnchorIds(anchors, p.anchors ?? []),
    }));
  },

  async setAnchors(anchors) {
    await mutateCurrent(get, set, (p) => ({ ...p, anchors }));
  },

  async updateAnchor(anchorId, patch) {
    await mutateCurrent(get, set, (p) =>
      p.anchors
        ? {
            ...p,
            anchors: p.anchors.map((a) => (a.id === anchorId ? { ...a, ...patch } : a)),
          }
        : p,
    );
  },

  async removeAnchor(anchorId) {
    await mutateCurrent(get, set, (p) => ({
      ...p,
      anchors: (p.anchors ?? []).filter((a) => a.id !== anchorId),
    }));
  },

  async setScreenplay(screenplay) {
    await mutateCurrent(get, set, (p) => ({ ...p, screenplay }));
  },

  async updateSpread(spreadId, patch) {
    await mutateCurrent(get, set, (p) => {
      if (!p.screenplay) return p;
      const tree = p.screenplay;
      const doc = getCursor(tree).content;
      const nextDoc: ScreenplayDoc = {
        ...doc,
        spreads: doc.spreads.map((s) => (s.id === spreadId ? { ...s, ...patch } : s)),
      };
      return { ...p, screenplay: updateNodeContent(tree, tree.cursorId, nextDoc) };
    });
  },

  async setIllustration(spreadId, tree) {
    await mutateCurrent(get, set, (p) => ({
      ...p,
      illustrations: { ...(p.illustrations ?? {}), [spreadId]: tree },
    }));
  },

  async deleteIllustrationVersion(spreadId, versionId) {
    const id = get().currentId;
    if (!id) return;
    const tree = get().projects.find((p) => p.id === id)?.illustrations?.[spreadId];
    if (!tree) return;
    const removedBlob = tree.nodes[versionId]?.content.blobId;

    await mutateCurrent(get, set, (p) => {
      const current = p.illustrations?.[spreadId];
      if (!current) return p;
      const illustrations = { ...(p.illustrations ?? {}) };
      if (Object.keys(current.nodes).length <= 1) {
        delete illustrations[spreadId];
      } else {
        illustrations[spreadId] = deleteVersion(current, versionId);
      }
      return { ...p, illustrations };
    });

    if (removedBlob) void gcBlobsIfUnreferenced(get, id, [removedBlob]);
  },

  async removeIllustration(spreadId) {
    const id = get().currentId;
    if (!id) return;
    const tree = get().projects.find((p) => p.id === id)?.illustrations?.[spreadId];
    const blobs = tree ? allVersions(tree).map((n) => n.content.blobId) : [];

    await mutateCurrent(get, set, (p) => {
      if (!p.illustrations?.[spreadId]) return p;
      const illustrations = { ...p.illustrations };
      delete illustrations[spreadId];
      return { ...p, illustrations };
    });

    if (blobs.length) void gcBlobsIfUnreferenced(get, id, blobs);
  },

  async deleteAnchorVersion(anchorId, versionId) {
    const id = get().currentId;
    if (!id) return;
    const anchor = get().projects.find((p) => p.id === id)?.anchors?.find((a) => a.id === anchorId);
    const tree = anchor?.versions;
    if (!tree) return;
    const removedBlob = tree.nodes[versionId]?.content.blobId;

    await mutateCurrent(get, set, (p) => {
      if (!p.anchors) return p;
      return {
        ...p,
        anchors: p.anchors.map((a) => {
          if (a.id !== anchorId || !a.versions) return a;
          if (Object.keys(a.versions.nodes).length <= 1) {
            const { versions: _drop, ...rest } = a;
            void _drop;
            return rest;
          }
          return { ...a, versions: deleteVersion(a.versions, versionId) };
        }),
      };
    });

    if (removedBlob) void gcBlobsIfUnreferenced(get, id, [removedBlob]);
  },

  async setDesign(design) {
    await mutateCurrent(get, set, (p) => ({ ...p, design }));
  },

  async updatePageDesign(pageId, patch) {
    await mutateCurrent(get, set, (p) => {
      if (!p.design) return p;
      const prev = p.design.pages[pageId] ?? { textBoxes: [] };
      return {
        ...p,
        design: {
          ...p.design,
          pages: { ...p.design.pages, [pageId]: { ...prev, ...patch } },
        },
      };
    });
  },

  async setShare(share) {
    await mutateCurrent(get, set, (p) => ({ ...p, share }));
  },
}));

/**
 * Apply a new book title across every linked surface: the project name, the
 * front-cover spec title, and the front-cover title text box. The project always
 * keeps a non-empty name, but the cover title may be blank.
 */
function applyBookTitle(p: Project, rawTitle: string): Project {
  const clean = rawTitle.trim();
  // The project must keep a name; only overwrite it with a non-empty value.
  let next: Project = clean ? { ...p, title: clean } : p;

  if (p.screenplay) {
    const tree = p.screenplay;
    const doc = getCursor(tree).content;
    const prevTitle = doc.frontCover?.title ?? "";
    const base: CoverSpec =
      doc.frontCover ?? { title: "", subtitle: "", illustration: "", anchorIds: [] };
    const nextDoc: ScreenplayDoc = { ...doc, frontCover: { ...base, title: rawTitle } };
    next = { ...next, screenplay: updateNodeContent(tree, tree.cursorId, nextDoc) };
    next = syncCoverTitleBox(next, prevTitle, rawTitle);
  }
  return next;
}

/**
 * Mirror the title into the front-cover "book-title" text box, but only when that
 * box still shows the previous title — so a manually restyled/retyped cover
 * title on the canvas is never clobbered by an edit made elsewhere.
 */
function syncCoverTitleBox(p: Project, prevTitle: string, nextTitle: string): Project {
  const design = p.design;
  const page = design?.pages[COVER_FRONT_ID];
  if (!design || !page) return p;

  let changed = false;
  const textBoxes = page.textBoxes.map((b) => {
    if (b.role !== "book-title") return b;
    const current = textFromParagraphs(b.paragraphs);
    if (current !== prevTitle && current.trim() !== "") return b;
    changed = true;
    return { ...b, paragraphs: wordParagraphs(nextTitle) };
  });
  if (!changed) return p;

  return {
    ...p,
    design: {
      ...design,
      pages: { ...design.pages, [COVER_FRONT_ID]: { ...page, textBoxes } },
    },
  };
}

type ProjectsGet = () => ProjectsState;
type ProjectsSet = (fn: (state: ProjectsState) => Partial<ProjectsState>) => void;

/** Blob ids of GLOBAL uploaded assets, which a project-scoped GC must never touch. */
function globalAssetBlobIds(): Set<string> {
  return new Set(useSettingsStore.getState().settings.assets.map((a) => a.blobId));
}

/**
 * Best-effort delete of image blobs, always excluding global uploaded assets.
 * Failures are swallowed (a leaked blob is harmless; a thrown error mid-delete
 * is not) so GC never blocks or breaks the surrounding user action.
 */
async function gcBlobs(ids: Iterable<string>): Promise<void> {
  const globals = globalAssetBlobIds();
  const targets = [...new Set(ids)].filter((b) => b && !globals.has(b));
  await Promise.allSettled(targets.map((b) => removeBlob(b)));
}

/**
 * Delete candidate blobs only if, AFTER the mutation that dropped them, they are
 * no longer referenced by the project's version trees (belt-and-suspenders: a
 * version blob is project-exclusive and single-node, but re-checking guarantees
 * we never delete a blob still in use).
 */
async function gcBlobsIfUnreferenced(
  get: ProjectsGet,
  projectId: string,
  candidates: string[],
): Promise<void> {
  const project = get().projects.find((p) => p.id === projectId);
  const referenced = project ? collectProjectImageBlobIds(project) : new Set<string>();
  await gcBlobs(candidates.filter((b) => !referenced.has(b)));
}

/**
 * Serializes persistence so concurrent generations can't clobber each other on
 * disk. Each save writes the LATEST in-memory snapshot of the project, so once
 * all queued saves drain the stored copy always reflects every applied change.
 * Failures don't break the chain (next saves still run).
 */
let saveChain: Promise<void> = Promise.resolve();
function persistLatest(get: ProjectsGet, set: ProjectsSet, id: string): Promise<void> {
  const next = saveChain.then(async () => {
    // A conflicted project is frozen from auto-save until the user reloads it,
    // so we don't keep re-attempting a write that can only be rejected.
    if (get().staleProjectId === id) return;
    const latest = get().projects.find((p) => p.id === id);
    if (!latest) return;
    const { projects } = await getRepos();
    try {
      const saved = await projects.save(latest);
      // Fold the incremented generation back into the in-memory copy so the next
      // save uses it as its base (otherwise the tab would conflict with itself).
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id && p.rev !== saved.rev ? { ...p, rev: saved.rev } : p,
        ),
      }));
    } catch (err) {
      if (err instanceof ProjectConflictError) {
        // Another writer advanced the stored copy — flag it so the UI can prompt
        // a reload; the local edits stay in memory until then.
        set(() => ({ staleProjectId: id }));
        return;
      }
      // Transient failure (e.g. offline): leave state as-is; a later save retries.
    }
  });
  saveChain = next.catch(() => {});
  return next;
}

/**
 * Atomically apply `mutator` to the current project. The in-memory update runs
 * inside a functional `set`, so the mutator always sees the freshest state even
 * when many writes happen concurrently (no read-modify-write races / lost
 * updates). Persistence is queued via {@link persistLatest}.
 */
function mutateCurrent(
  get: ProjectsGet,
  set: ProjectsSet,
  mutator: (p: Project) => Project,
): Promise<void> {
  const id = get().currentId;
  if (!id) return Promise.resolve();
  return mutateProject(get, set, id, mutator);
}

/** Atomically apply `mutator` to the project with the given id. */
function mutateProject(
  get: ProjectsGet,
  set: ProjectsSet,
  id: string,
  mutator: (p: Project) => Project,
): Promise<void> {
  let found = false;
  set((state) => {
    const target = state.projects.find((p) => p.id === id);
    if (!target) return {};
    found = true;
    const updated: Project = { ...mutator(target), updatedAt: Date.now() };
    return {
      projects: state.projects.map((p) => (p.id === id ? updated : p)),
    };
  });
  if (!found) return Promise.resolve();
  return persistLatest(get, set, id);
}
