import { create } from "zustand";
import type {
  Anchor,
  BookConfig,
  BookDesign,
  IllustrationImage,
  PageDesign,
  Project,
  ProjectStage,
  ScreenplayDoc,
  ScreenplaySpread,
  StoryAnalysis,
} from "../core/types";
import { getCursor, updateNodeContent, type VersionTree } from "../core/versioning";
import { createDefaultConfig, STAGE_ORDER } from "../core/types";
import { getRepos } from "./repos";

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

  load: () => Promise<void>;
  createProject: (title?: string) => Promise<string>;
  openProject: (id: string) => void;
  closeProject: () => void;
  deleteProject: (id: string) => Promise<void>;
  current: () => Project | null;

  updateConfig: (patch: Partial<BookConfig>) => Promise<void>;
  renameProject: (id: string, title: string) => Promise<void>;
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

  setDesign: (design: BookDesign) => Promise<void>;
  updatePageDesign: (pageId: string, patch: Partial<PageDesign>) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  currentId: null,
  loaded: false,

  async load() {
    const { projects } = await getRepos();
    const list = await projects.list();
    set({ projects: list, loaded: true });
  },

  async createProject(title) {
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
    await projects.save(project);
    set((state) => ({
      projects: [project, ...state.projects],
      currentId: project.id,
    }));
    return project.id;
  },

  openProject(id) {
    set({ currentId: id });
  },

  closeProject() {
    set({ currentId: null });
  },

  async deleteProject(id) {
    const { projects } = await getRepos();
    await projects.remove(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentId: state.currentId === id ? null : state.currentId,
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
    await mutateProject(get, set, id, (p) => ({ ...p, title: title.trim() || p.title }));
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
    await mutateCurrent(get, set, (p) => ({ ...p, analysis, anchors }));
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
}));

type ProjectsGet = () => ProjectsState;
type ProjectsSet = (fn: (state: ProjectsState) => Partial<ProjectsState>) => void;

/**
 * Serializes persistence so concurrent generations can't clobber each other on
 * disk. Each save writes the LATEST in-memory snapshot of the project, so once
 * all queued saves drain the stored copy always reflects every applied change.
 * Failures don't break the chain (next saves still run).
 */
let saveChain: Promise<void> = Promise.resolve();
function persistLatest(get: ProjectsGet, id: string): Promise<void> {
  const next = saveChain.then(async () => {
    const latest = get().projects.find((p) => p.id === id);
    if (!latest) return;
    const { projects } = await getRepos();
    await projects.save(latest);
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
  return persistLatest(get, id);
}
