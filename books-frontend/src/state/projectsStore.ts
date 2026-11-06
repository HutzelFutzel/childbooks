import { create } from "zustand";
import type {
  Anchor,
  BookConfig,
  BookDesign,
  CoverSpec,
  IllustrationImage,
  PageDesign,
  Project,
  ProjectStage,
  ScreenplayDoc,
  ScreenplaySpread,
  SourceArtRef,
  StoryAnalysis,
} from "../core/types";
import {
  allVersions,
  deleteVersion,
  getCursor,
  updateNodeContent,
  type VersionTree,
} from "../core/versioning";
import { anchorNameKeys, normalizeAnchorName, reconcileAnchorIds } from "../core/book/anchorRefs";
import { collectProjectImageBlobIds } from "../core/book/blobRefs";
import {
  applyArtworkLooks,
  collectSourceArtBlobIds,
  droppedSourceArtIds,
  renameDerivedStyleNames,
  setSourceArtOnNamedCharacters,
} from "../core/book/sourceArt";
import { resolveLayoutComposition } from "../core/config/layouts";
import {
  pictureRectFor,
  textFromParagraphs,
  withIllustrationFrame,
  withoutAutomaticIllustrationFrame,
  wordParagraphs,
} from "../core/design";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  createDefaultConfig,
  STAGE_ORDER,
} from "../core/types";
import { detectDefaultBookLanguage } from "../core/config/bookLanguages";
import { coverLinesOf } from "../core/book/coverLines";
import { applyBookTitle, applyCoverLine } from "../core/book/coverEdits";
import { authoringOf, withAuthoring } from "../core/guide/projectState";
import { reconcileCoverLettering } from "../ui/design/designInit";
import { ProjectConflictError } from "../core/storage/repositories";
import { StoredValueTooLargeError } from "../core/storage/types";
import {
  isRetryable,
  retryDelayMs,
  saveFailureReasonOf,
  type SaveFailureReason,
} from "../core/storage/saveRecovery";
import { decideRecovery, recoveredBook, type OutboxRecord } from "../core/storage/outbox";
import { biggestParts, createSizeWatch, STORED_BOOK_LIMIT_BYTES } from "../core/storage/bookSize";
import { compactProjectHistory } from "../core/book/compactHistory";
import { resolveBookConflict } from "../core/guide/merge";
import { reconcilePageWords, repairPageWords } from "../core/book/pageWordsGate";
import { reconcileCoverWords } from "../core/book/coverWordsGate";
import { likenessPhotosOf } from "../core/guide/portrait";
import { reconcilePendingLooks } from "../core/guide/pending";
import { getRepos } from "./repos";
import { touchProjectRemote } from "../platform/aiClient";
import type { ClientLogArgs } from "../platform/clientLogger";
import { copyBlob, removeBlob } from "./blobs";
import { useSettingsStore } from "./settingsStore";
import { useAppConfigStore } from "./appConfigStore";
import { resolveShipCountry, useShipCountryStore } from "./shipCountryStore";
import { bindLikenessPhoto, deleteLikenessPhoto } from "../platform/likeness";
import {
  forgetBook,
  forgetSaved,
  keepStorageDurable,
  pendingRecords,
  rememberUnsaved,
} from "../platform/localOutbox";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stageIndex(stage: ProjectStage): number {
  return STAGE_ORDER.indexOf(stage);
}

function collectLikenessPhotoSubjects(project: Project): {
  projectId: string;
  subjectId: string;
  createdAt: number;
}[] {
  const targets = new Map<
    string,
    { projectId: string; subjectId: string; createdAt: number }
  >();
  for (const member of project.config.storyBrief?.cast ?? []) {
    for (const photo of likenessPhotosOf(member)) {
      const target = { projectId: project.id, subjectId: member.id, createdAt: photo.createdAt };
      targets.set(`${target.subjectId}:${target.createdAt}`, target);
    }
  }
  for (const anchor of project.anchors ?? []) {
    if (!anchor.likenessPhoto) continue;
    const target = {
      projectId: project.id,
      subjectId: anchor.id,
      createdAt: anchor.likenessPhoto.createdAt,
    };
    targets.set(`${target.subjectId}:${target.createdAt}`, target);
  }
  return [...targets.values()];
}

function remapSourceArt(
  images: SourceArtRef[] | undefined,
  remap: Map<string, string>,
): SourceArtRef[] | undefined {
  if (!images?.length) return undefined;
  const next = images
    .map((image) => {
      const blobId = remap.get(image.blobId);
      return blobId ? { ...image, blobId } : null;
    })
    .filter((image): image is SourceArtRef => Boolean(image));
  return next.length > 0 ? next : undefined;
}

/** Duplicate drawings so the copy doesn't share blob ids with the original. */
async function copySourceArtBlobs(project: Project): Promise<Project> {
  const ids = [...new Set(collectSourceArtBlobIds(project))];
  if (ids.length === 0) return project;
  const remap = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      const copied = await copyBlob(id);
      if (copied) remap.set(id, copied);
    }),
  );
  const storyBrief = project.config.storyBrief;
  return {
    ...project,
    ...(project.authoringState?.styleSourceArt?.length
      ? {
          authoringState: {
            ...project.authoringState,
            styleSourceArt: remapSourceArt(
              project.authoringState.styleSourceArt,
              remap,
            ),
          },
        }
      : {}),
    config: {
      ...project.config,
      artStyle: {
        ...project.config.artStyle,
        referenceArt: remapSourceArt(project.config.artStyle.referenceArt, remap),
      },
      ...(storyBrief?.cast
        ? {
            storyBrief: {
              ...storyBrief,
              cast: storyBrief.cast.map((member) => {
                if (!member.sourceArt?.length) return member;
                return { ...member, sourceArt: remapSourceArt(member.sourceArt, remap) };
              }),
            },
          }
        : {}),
    },
    anchors: project.anchors?.map((anchor) => {
      if (!anchor.sourceArt?.length) return anchor;
      return { ...anchor, sourceArt: remapSourceArt(anchor.sourceArt, remap) };
    }),
  };
}

function stripLikenessPhotos(project: Project): Project {
  const storyBrief = project.config.storyBrief;
  return {
    ...project,
    config: {
      ...project.config,
      ...(storyBrief?.cast
        ? {
            storyBrief: {
              ...storyBrief,
              cast: storyBrief.cast.map(({ likenessPhoto: _drop, moreLikenessPhotos: _more, ...member }) => {
                void _drop;
                void _more;
                return member;
              }),
            },
          }
        : {}),
    },
    anchors: project.anchors?.map(({ likenessPhoto: _drop, ...anchor }) => {
      void _drop;
      return anchor;
    }),
  };
}

// Prevent a slower load for a previous Firebase identity from replacing the
// project list after the user has already switched accounts.
let projectLoadGeneration = 0;

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
  /** Two devices changed the same thing; saving waits for the reader's choice. */
  bookConflict: PendingBookConflict | null;
  settleBookConflict: (keep: "mine" | "theirs") => Promise<void>;
  /**
   * Id of a project whose last save FAILED. Edits stay in memory and a banner
   * tells the user their latest changes aren't stored yet.
   */
  saveFailedProjectId: string | null;
  /**
   * Why it failed. Only a `transient` failure (offline, storage hiccup) is
   * retried on a timer; the others would fail the same way every time, so
   * they wait for the next edit or a manual retry.
   */
  saveFailureReason: SaveFailureReason | null;
  /** How many saves in a row have failed for that book. */
  saveFailureAttempts: number;
  /**
   * Changes that were not saved last time were found on this device and put back. Shown once, until
   * dismissed.
   */
  recoveredNotice: RecoveredNotice | null;
  dismissRecovered: () => void;
  /**
   * A book that was just created and should already be open, before the URL
   * has caught up. While this is set, the library route must not close the
   * book or present it as a card that still needs a click.
   */
  pendingEntryId: string | null;
  /** Drop {@link pendingEntryId} once the route has caught up, or on leaving. */
  clearPendingEntry: () => void;
  /** Manually retry persisting a project whose save failed. */
  retrySave: (id: string) => Promise<void>;

  load: () => Promise<void>;
  /**
   * Fetch a single project directly by id so a direct `/studio/{bookId}` entry
   * can mount the book workspace immediately while the full library list loads
   * in the background.
   */
  loadSingleProject: (id: string) => Promise<Project | null>;
  /** Re-fetch a project from storage, replacing the in-memory copy and clearing its stale flag. */
  reloadProject: (id: string) => Promise<void>;
  /** Create a project; `open` (default true) also makes it the current one. */
  createProject: (title?: string, open?: boolean) => Promise<string>;
  duplicateProject: (id: string) => Promise<string | null>;
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
  /**
   * Set the front-cover subtitle from the cover toolbox or the linked canvas
   * text box. Keeps `frontCover.subtitle` and the `book-subtitle` overlay in sync.
   */
  setCoverSubtitle: (id: string, subtitle: string) => Promise<void>;
  /** The front cover's author line: kept in the cover spec, the Chat's choice and the text layer. */
  setCoverAuthor: (id: string, author: string) => Promise<void>;
  /** Settle the cover's words in one write: title (when changed), subtitle, author, confirmed. */
  settleCoverWords: (id: string, lines: { title?: string; subtitle: string; author: string }) => Promise<void>;
  goToStage: (stage: ProjectStage) => Promise<void>;
  advanceStage: (stage: ProjectStage) => Promise<void>;

  setAnalysis: (
    analysis: StoryAnalysis,
    anchors: Anchor[],
    /** Private container dependencies by NAME — resolved after id reconciliation. */
    embeddings?: { container: string; subject: string }[],
  ) => Promise<void>;
  /** Patch fields on the current analysis without re-running the AI. */
  patchAnalysis: (patch: Partial<StoryAnalysis>) => Promise<void>;
  setAnchors: (anchors: Anchor[]) => Promise<void>;
  updateAnchor: (anchorId: string, patch: Partial<Anchor>) => Promise<void>;
  /**
   * Rename an anchor, remembering its old name so a later "re-read the
   * story" still recognizes it (see `reconcileAnchorIds`) instead of
   * orphaning its art/custom details behind a freshly-minted duplicate.
   */
  renameAnchor: (anchorId: string, name: string) => Promise<void>;
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
  /**
   * Atomically patch the current project. Used by studio undo (restore a
   * snapshot) and by page ops that touch screenplay + design together.
   */
  patchCurrent: (mutator: (p: Project) => Project) => Promise<void>;
  /**
   * Delete blobs only if the current project no longer references them.
   * Artwork is stored on both the story cast and character anchors; callers
   * must not `removeBlob` those ids directly.
   */
  gcUnreferencedBlobs: (ids: string[]) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  currentId: null,
  loaded: false,
  staleProjectId: null,
  bookConflict: null,
  saveFailedProjectId: null,
  saveFailureReason: null,
  saveFailureAttempts: 0,
  recoveredNotice: null,
  pendingEntryId: null,

  dismissRecovered() {
    if (get().recoveredNotice) set({ recoveredNotice: null });
  },

  async retrySave(id) {
    await persistLatest(get, set, id);
  },

  clearPendingEntry() {
    if (get().pendingEntryId) set({ pendingEntryId: null });
  },

  async load() {
    const generation = ++projectLoadGeneration;
    set({
      projects: [],
      currentId: null,
      loaded: false,
      staleProjectId: null,
      saveFailedProjectId: null,
      saveFailureReason: null,
      saveFailureAttempts: 0,
      pendingEntryId: null,
    });
    const { projects } = await getRepos();
    const list = await projects.list();
    if (generation !== projectLoadGeneration) return;
    // Preserve any fresher in-memory copy of a project that was already opened
    // via `loadSingleProject` and edited while the full library list was in flight.
    const existingById = new Map(get().projects.map((p) => [p.id, p]));
    const merged: Project[] = [];
    for (const stored of list) {
      // A book saved with a page's words and its text box apart is made whole as it comes in.
      const p = repairPageWords(stored);
      if (!savedBase.has(p.id)) savedBase.set(p.id, p);
      const existing = existingById.get(p.id);
      if (existing && (existing.updatedAt > p.updatedAt || (existing.rev ?? 0) >= (p.rev ?? 0))) {
        merged.push(existing);
      } else {
        savedBase.set(p.id, p);
        merged.push(p);
      }
      existingById.delete(p.id);
    }
    for (const remaining of existingById.values()) {
      merged.unshift(remaining);
    }
    set({ projects: merged, loaded: true });
    // Changes the last session never got to save come back before anyone starts editing.
    await recoverUnsaved(get, set, list, generation, { complete: true });
  },

  async loadSingleProject(id) {
    const existing = get().projects.find((p) => p.id === id);
    if (existing) return existing;
    const generation = projectLoadGeneration;
    const { projects } = await getRepos();
    const stored = await projects.get(id);
    if (!stored || generation !== projectLoadGeneration) return null;
    const project = repairPageWords(stored);
    savedBase.set(project.id, project);
    set((state) => {
      if (state.projects.some((p) => p.id === project.id)) return {};
      return { projects: [project, ...state.projects] };
    });
    await recoverUnsaved(get, set, [stored], generation);
    return get().projects.find((p) => p.id === id) ?? project;
  },

  async settleBookConflict(keep) {
    const pending = get().bookConflict;
    if (!pending) return;
    const settled = repairPageWords(
      resolveBookConflict(pending.merged, pending.mine, pending.theirs, pending.conflicts, keep, Date.now()),
    );
    set((state) => ({
      bookConflict: null,
      projects: state.projects.map((p) =>
        p.id === pending.projectId
          ? { ...withEditsSince({ ...pending.merged, rev: pending.theirs.rev }, p, settled), rev: pending.theirs.rev }
          : p,
      ),
    }));
    await persistLatest(get, set, pending.projectId);
  },

  async reloadProject(id) {
    const { projects } = await getRepos();
    const fresh = await projects.get(id);
    if (fresh) savedBase.set(id, fresh);
    // Reloading is choosing the stored copy over this tab's edits; they must not come back next time.
    void forgetBook(id);
    set((state) => {
      if (!fresh) {
        // Deleted elsewhere — drop it locally and close it if it was open.
        return {
          projects: state.projects.filter((p) => p.id !== id),
          currentId: state.currentId === id ? null : state.currentId,
          pendingEntryId: state.pendingEntryId === id ? null : state.pendingEntryId,
          staleProjectId: state.staleProjectId === id ? null : state.staleProjectId,
        };
      }
      return {
        projects: state.projects.map((p) => (p.id === id ? repairPageWords(fresh) : p)),
        staleProjectId: state.staleProjectId === id ? null : state.staleProjectId,
      };
    });
  },

  async createProject(title, open = true) {
    const now = Date.now();
    const languageConfig = useAppConfigStore.getState().bookLanguages;
    const countryHint = resolveShipCountry(useShipCountryStore.getState());
    const defaultLocale = detectDefaultBookLanguage(languageConfig, countryHint);

    const project: Project = {
      id: genId(),
      title: title?.trim() || "Untitled Story",
      createdAt: now,
      updatedAt: now,
      stage: "setup",
      furthestStage: "setup",
      config: createDefaultConfig(defaultLocale),
    };
    const { projects } = await getRepos();
    const saved = await projects.save(project);
    // Register the book with the backend now, so a project that's started and
    // abandoned still appears in analysis instead of only counting once it
    // makes its first (paid) AI call.
    touchProjectRemote({ projectId: saved.id, stage: saved.stage, title: saved.title });
    set((state) => ({
      projects: [saved, ...state.projects],
      ...(open ? { currentId: saved.id, pendingEntryId: saved.id } : {}),
    }));
    return saved.id;
  },

  async duplicateProject(id) {
    const original = get().projects.find((p) => p.id === id);
    if (!original) return null;
    const now = Date.now();
    const newId = genId();
    const duplicate: Project = await copySourceArtBlobs(
      stripLikenessPhotos({
        ...JSON.parse(JSON.stringify(original)),
        id: newId,
        title: `${original.title} (Copy)`,
        createdAt: now,
        updatedAt: now,
        rev: undefined,
      }),
    );
    const { projects } = await getRepos();
    const saved = await projects.save(duplicate);
    touchProjectRemote({ projectId: saved.id, stage: saved.stage, title: saved.title });
    set((state) => ({
      projects: [saved, ...state.projects],
    }));
    return saved.id;
  },

  openProject(id) {
    // Route ids are untrusted input. Only select a project that was loaded from
    // the active user's UID-scoped Firestore store.
    if (!get().projects.some((project) => project.id === id)) return;
    set({ currentId: id });
  },

  closeProject() {
    set({ currentId: null, pendingEntryId: null });
  },

  async deleteProject(id) {
    // GC every image blob this project owns BEFORE dropping it, so deleting a
    // book doesn't leak its generated images in Storage forever. Version-tree
    // blobs are project-exclusive, so this is always safe; global uploaded
    // assets (settings.assets) are excluded by gcBlobs.
    const target = get().projects.find((p) => p.id === id);
    if (target) {
      void gcBlobs(collectProjectImageBlobIds(target));
      for (const photo of collectLikenessPhotoSubjects(target)) {
        void deleteLikenessPhoto(photo).catch(() => {});
      }
    }

    const { projects } = await getRepos();
    await projects.remove(id);
    void forgetBook(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentId: state.currentId === id ? null : state.currentId,
      pendingEntryId: state.pendingEntryId === id ? null : state.pendingEntryId,
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

  async setCoverSubtitle(id, subtitle) {
    await mutateProject(get, set, id, (p) => applyCoverLine(p, "subtitle", subtitle));
  },

  async setCoverAuthor(id, author) {
    await mutateProject(get, set, id, (p) => applyCoverLine(p, "author", author));
  },

  async settleCoverWords(id, lines) {
    await mutateProject(get, set, id, (p) => {
      let next = p;
      const title = lines.title?.trim();
      if (title && title !== coverLinesOf(p).title) {
        next = applyBookTitle(next, title);
        next = withAuthoring(next, { cover: { ...authoringOf(next).cover, titleEdited: true } });
      }
      next = applyCoverLine(next, "subtitle", lines.subtitle.trim());
      next = applyCoverLine(next, "author", lines.author.trim());
      return withAuthoring(next, { cover: { ...authoringOf(next).cover, confirmedAt: Date.now() } });
    });
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
    const current = get().current();
    if (current) {
      touchProjectRemote({ projectId: current.id, stage, title: current.title });
    }
  },

  async setAnalysis(analysis, anchors, embeddings) {
    // Re-analysis mints fresh anchors; preserve the ids (and images) of anchors
    // whose name is unchanged so existing screenplay/illustration references —
    // which point at anchors by id — don't drift and get silently ignored.
    await mutateCurrent(get, set, (p) => {
      const reconciled = reconcileAnchorIds(anchors, p.anchors ?? []);
      const likenessByName = new Map<string, NonNullable<Anchor["likenessPhoto"]>[]>();
      const sourceArtByName = new Map<string, NonNullable<Anchor["sourceArt"]>[]>();
      const lookByName = new Map<string, string>();
      for (const member of p.config.storyBrief?.cast ?? []) {
        const key = normalizeAnchorName(member.name);
        if (!key) continue;
        if (member.likenessPhoto) {
          const bucket = likenessByName.get(key) ?? [];
          bucket.push(member.likenessPhoto);
          likenessByName.set(key, bucket);
        }
        if (member.sourceArt?.length) {
          const bucket = sourceArtByName.get(key) ?? [];
          bucket.push(member.sourceArt);
          sourceArtByName.set(key, bucket);
        }
        if (member.lookFromArt?.trim()) lookByName.set(key, member.lookFromArt.trim());
      }
      // Private embedding dependencies arrive keyed by name because the server
      // never sees the final reconciled ids. Resolve them here and replace the
      // old inferred set; there is intentionally no user-facing graph.
      const byName = new Map<string, (typeof reconciled)[number]>();
      for (const a of reconciled) {
        for (const key of anchorNameKeys(a)) {
          if (!byName.has(key)) byName.set(key, a);
        }
      }
      const embeddedByContainer = new Map<string, Set<string>>();
      for (const embedding of embeddings ?? []) {
        const container = byName.get(normalizeAnchorName(embedding.container));
        const subject = byName.get(normalizeAnchorName(embedding.subject));
        if (!container || !subject || container.id === subject.id) continue;
        const ids = embeddedByContainer.get(container.id) ?? new Set<string>();
        ids.add(subject.id);
        embeddedByContainer.set(container.id, ids);
      }
      const next: Project = {
        ...p,
        analysis,
        config: { ...p.config, castReady: false },
        anchors: reconciled.map((anchor) => {
          const bucket = likenessByName.get(normalizeAnchorName(anchor.name));
          const likenessPhoto =
            anchor.type === "character" && !anchor.versions
              ? (anchor.likenessPhoto ?? bucket?.shift())
              : anchor.likenessPhoto;
          const artBucket = sourceArtByName.get(normalizeAnchorName(anchor.name));
          const sourceArt =
            anchor.type === "character"
              ? (anchor.sourceArt?.length ? anchor.sourceArt : artBucket?.shift())
              : anchor.sourceArt;
          const lookFromArt = anchor.lookFromArt ?? lookByName.get(normalizeAnchorName(anchor.name));
          return {
            ...anchor,
            ...(likenessPhoto ? { likenessPhoto } : {}),
            ...(sourceArt?.length ? { sourceArt } : {}),
            ...(lookFromArt ? { lookFromArt } : {}),
            containedIds: [...(embeddedByContainer.get(anchor.id) ?? [])],
          };
        }),
      };
      const looks = next.anchors
        ?.filter((anchor) => anchor.lookFromArt?.trim())
        .map((anchor) => ({
          name: anchor.name,
          description: anchor.lookFromArt!,
          bodyPlan: anchor.bodyPlan,
        }));
      return looks?.length ? applyArtworkLooks(next, looks) : next;
    });
    const current = get().current();
    if (current?.config.storyBrief?.cast) {
      const cast = current.config.storyBrief.cast;
      await Promise.all(
        (current.anchors ?? []).flatMap((anchor) => {
          const photo = anchor.likenessPhoto;
          if (!photo) return [];
          const source = cast.find(
            (member) => member.likenessPhoto?.createdAt === photo.createdAt,
          );
          if (!source || source.id === anchor.id) return [];
          return [
            bindLikenessPhoto({
              projectId: current.id,
              fromSubjectId: source.id,
              toSubjectId: anchor.id,
              createdAt: photo.createdAt,
            }),
          ];
        }),
      );
    }
  },

  async patchAnalysis(patch) {
    await mutateCurrent(get, set, (p) =>
      p.analysis ? { ...p, analysis: { ...p.analysis, ...patch } } : p,
    );
  },

  async setAnchors(anchors) {
    await mutateCurrent(get, set, (p) => ({ ...p, anchors }));
  },

  async updateAnchor(anchorId, patch) {
    const current = get().current();
    const previous = current?.anchors?.find((anchor) => anchor.id === anchorId);
    const dropped =
      "sourceArt" in patch && previous
        ? droppedSourceArtIds(previous.sourceArt, patch.sourceArt)
        : [];
    await mutateCurrent(get, set, (p) => {
      if (!p.anchors) return p;
      let next: Project = {
        ...p,
        anchors: p.anchors.map((a) => (a.id === anchorId ? { ...a, ...patch } : a)),
      };
      if ("sourceArt" in patch) {
        const name = next.anchors?.find((a) => a.id === anchorId)?.name ?? previous?.name;
        if (name) next = setSourceArtOnNamedCharacters(next, name, patch.sourceArt);
      }
      return next;
    });
    if (dropped.length > 0 && current) {
      void gcBlobsIfUnreferenced(get, current.id, dropped);
    }
  },

  async renameAnchor(anchorId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await mutateCurrent(get, set, (p) =>
      p.anchors
        ? {
            ...p,
            config: {
              ...p.config,
              artStyle:
                renameDerivedStyleNames(
                  p.config.artStyle,
                  p.anchors.find((a) => a.id === anchorId)?.name ?? "",
                  trimmed,
                ) ?? p.config.artStyle,
            },
            anchors: p.anchors.map((a) => {
              if (a.id !== anchorId || a.name === trimmed) return a;
              const aliasNames = Array.from(
                new Set([...(a.aliasNames ?? []), a.name].filter((n) => n !== trimmed)),
              );
              return { ...a, name: trimmed, aliasNames, nameEdited: true };
            }),
          }
        : p,
    );
  },

  async removeAnchor(anchorId) {
    const current = get().current();
    const removed = current?.anchors?.find((anchor) => anchor.id === anchorId);
    const photo = removed?.likenessPhoto;
    const sourceArt = removed?.sourceArt ?? [];
    const sourceSubjectId = current?.config.storyBrief?.cast?.find(
      (member) => member.likenessPhoto?.createdAt === photo?.createdAt,
    )?.id;
    await mutateCurrent(get, set, (p) => ({
      ...p,
      config:
        p.config.storyBrief?.cast && photo
          ? {
              ...p.config,
              storyBrief: {
                ...p.config.storyBrief,
                cast: p.config.storyBrief.cast.map((member) =>
                  member.likenessPhoto?.createdAt === photo.createdAt
                    ? { ...member, likenessPhoto: undefined }
                    : member,
                ),
              },
            }
          : p.config,
      anchors: (p.anchors ?? [])
        .filter((a) => a.id !== anchorId)
        .map((a) => ({
          ...a,
          containedIds: (a.containedIds ?? []).filter((id) => id !== anchorId),
        })),
    }));
    if (photo && current) {
      void deleteLikenessPhoto({
        projectId: current.id,
        subjectId: anchorId,
        createdAt: photo.createdAt,
      }).catch(() => {});
      if (sourceSubjectId && sourceSubjectId !== anchorId) {
        void deleteLikenessPhoto({
          projectId: current.id,
          subjectId: sourceSubjectId,
          createdAt: photo.createdAt,
        }).catch(() => {});
      }
    }
    if (sourceArt.length > 0 && current) {
      void gcBlobsIfUnreferenced(
        get,
        current.id,
        sourceArt.map((image) => image.blobId),
      );
    }
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
    await mutateCurrent(get, set, (p) => {
      const illustrations = { ...(p.illustrations ?? {}), [spreadId]: tree };
      let next: Project = { ...p, illustrations };
      // New/updated art should appear on the canvas immediately. Editable stages
      // only paint AI art through an illustration ImageElement — without this,
      // filmstrip thumbs (non-editable full-bleed) update while the stage stays
      // blank until the user clicks the page to materialize a frame.
      const art = getCursor(tree).content;
      const blobId = art.blobId;
      if (blobId && next.design) {
        const isCover = spreadId === COVER_FRONT_ID || spreadId === COVER_BACK_ID;
        const focus = isCover ? { x: 0.5, y: 0 } : undefined;
        const transparent = art.generation?.applied.background === "transparent";
        const design = transparent
          ? withoutAutomaticIllustrationFrame(next.design, spreadId)
          : next.design;
        next = {
          ...next,
          design: withIllustrationFrame(design, spreadId, {
            focus,
            // Interior art sits a little smaller than the page, centred, so
            // the page color frames it. Covers keep bleeding to the trim.
            rect: pictureRectFor(
              spreadId,
              { x: 0, y: 0, w: 1, h: 1 },
              resolveLayoutComposition(useAppConfigStore.getState().layouts).pictureScale,
            ),
            ...(!transparent && !isCover && design.defaultImageMaskId
              ? {
                  imageMaskId: design.defaultImageMaskId,
                  frameSource: "auto" as const,
                }
              : {}),
          }),
        };
      }
      if (blobId && next.screenplay) {
        const screenplay = next.screenplay;
        const doc = getCursor(screenplay).content;
        if (doc.spreads.some((spread) => spread.id === spreadId && spread.completion)) {
          next = {
            ...next,
            screenplay: updateNodeContent(screenplay, screenplay.cursorId, {
              ...doc,
              spreads: doc.spreads.map((spread) => {
                if (spread.id !== spreadId || !spread.completion) return spread;
                const { completion: _drop, ...rest } = spread;
                void _drop;
                return rest;
              }),
            }),
          };
        }
      }
      return next;
    });
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

  async patchCurrent(mutator) {
    // Looks held for somebody who was not in the book yet are attached the moment they are:
    // after every change to the book, so no caller has to remember to.
    await mutateCurrent(get, set, (p) => reconcilePendingLooks(mutator(p)));
  },

  async gcUnreferencedBlobs(ids) {
    const id = get().currentId;
    if (!id || ids.length === 0) return;
    await gcBlobsIfUnreferenced(get, id, ids);
  },

}));

// The cover-word helpers live in core so skills can run them on a copy of the book.
export { applyBookTitle, applyCoverLine };

// Sync diagnostic breadcrumbs and save-health warnings whenever the active
// project or save status changes. Kept inside projectsStore so the root layout
// does not need to import the studio's project state graph.
if (typeof window !== "undefined") {
  void import("../platform/clientLogger").then(
    ({ clientLog, recordBreadcrumb, setClientLogProjectId }) => {
      let prevCurrentId: string | null = useProjectsStore.getState().currentId;
      let prevStaleId: string | null = useProjectsStore.getState().staleProjectId;
      if (prevCurrentId) {
        setClientLogProjectId(prevCurrentId);
        recordBreadcrumb("studio", "open_project", prevCurrentId);
      }
      useProjectsStore.subscribe((state) => {
        if (state.currentId !== prevCurrentId) {
          prevCurrentId = state.currentId;
          setClientLogProjectId(state.currentId);
          if (state.currentId) {
            recordBreadcrumb("studio", "open_project", state.currentId);
          }
        }
        if (state.staleProjectId !== prevStaleId) {
          prevStaleId = state.staleProjectId;
          if (state.staleProjectId) {
            clientLog.warn({
              domain: "studio",
              event: "project.save.conflict",
              message: "Book was modified on another device or tab (version conflict).",
              projectId: state.staleProjectId,
            });
          }
        }
      });
    },
  );
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
 *
 * Rapid edits (sliders, colour drags) are debounced so we don't rewrite storage
 * on every pointer sample; {@link flushProjectSaves} forces any pending write.
 */
let saveChain: Promise<void> = Promise.resolve();

/** The copy each book was last loaded or saved as: the base of a two-device merge. */
const savedBase = new Map<string, Project>();

/**
 * A presentation may take over two-device conflicts (the Chat studio merges
 * them). Returns the book to store, or a pending choice; null keeps the
 * default freeze-and-reload.
 */
export type ConflictResolver = (args: { base: Project; mine: Project; theirs: Project }) =>
  | { kind: "merged"; project: Project }
  | { kind: "choose"; conflicts: string[]; merged: Project }
  | null;

let conflictResolver: ConflictResolver | null = null;

export function setProjectConflictResolver(resolver: ConflictResolver | null): void {
  conflictResolver = resolver;
}

/** A conflict the reader has to settle, held until they choose. */
export interface PendingBookConflict {
  projectId: string;
  conflicts: string[];
  merged: Project;
  mine: Project;
  theirs: Project;
}

async function resolveConflict(get: ProjectsGet, set: ProjectsSet, id: string, mine: Project): Promise<boolean> {
  const base = savedBase.get(id);
  if (!base || !conflictResolver) return false;
  const { projects } = await getRepos();
  const theirs = await projects.get(id);
  if (!theirs) return false;
  // What was typed while the stored copy was fetched is part of "mine": the
  // failed save's snapshot alone would drop it.
  const latest = get().projects.find((p) => p.id === id) ?? mine;
  const outcome = conflictResolver({ base, mine: latest, theirs });
  if (!outcome) return false;
  savedBase.set(id, theirs);
  if (outcome.kind === "merged") {
    const whole = repairPageWords(outcome.project);
    set((state) => ({ projects: state.projects.map((p) => (p.id === id ? whole : p)) }));
    void persistLatest(get, set, id);
    return true;
  }
  set(() => ({
    bookConflict: { projectId: id, conflicts: outcome.conflicts, merged: outcome.merged, mine: latest, theirs },
    projects: get().projects.map((p) => (p.id === id ? { ...outcome.merged, rev: theirs.rev } : p)),
  }));
  return true;
}

/**
 * The settled book, with what the reader changed while the choice was open
 * laid on top: those edits are the newest, so they win.
 */
function withEditsSince(shown: Project, now: Project, settled: Project): Project {
  if (!conflictResolver || now === shown) return settled;
  const outcome = conflictResolver({ base: shown, mine: now, theirs: settled });
  if (!outcome) return settled;
  if (outcome.kind === "merged") return outcome.project;
  return resolveBookConflict(outcome.merged, now, settled, outcome.conflicts, "mine", Date.now());
}
export type { SaveFailureReason };

/** Changes the last session never got to save, found on this device and put back. */
export interface RecoveredNotice {
  projectId: string;
  title: string;
  /** `merged`: the cloud copy had moved on, and the changes were folded into it. */
  kind: "restored" | "merged";
  /** Fields both copies had changed; the changes made on this device won and the other value is kept in the book's history. */
  conflicts: number;
}

type ClientLogLevel = "info" | "warn" | "error";

/** Best-effort diagnostics: never in the way of the work being logged, and silent outside the browser. */
function logClient(level: ClientLogLevel, args: ClientLogArgs): void {
  if (typeof window === "undefined") return;
  void import("../platform/clientLogger")
    .then(({ clientLog }) => clientLog[level](args))
    .catch(() => {});
}

/** One log line per failure (not per retry), with what the backend actually said. */
function reportSaveFailure(projectId: string, reason: SaveFailureReason, err: unknown, project: Project): void {
  const code = (err as { code?: unknown } | null)?.code;
  let bytes: number | null = err instanceof StoredValueTooLargeError ? err.bytes : null;
  if (bytes === null) {
    try {
      bytes = new TextEncoder().encode(JSON.stringify(project)).length;
    } catch {
      bytes = null;
    }
  }
  const level: ClientLogLevel = reason === "transient" || reason === "signedOut" ? "warn" : "error";
  logClient(level, {
    domain: "studio",
    event: "project.save.failed",
    message: isRetryable(reason)
      ? "Saving book changes failed; retrying in the background."
      : reason === "signedOut"
        ? "Saving book changes failed because the session ended."
        : `Saving book changes failed and won't succeed on retry (${reason}).`,
    projectId,
    error: err,
    context: { reason, code: typeof code === "string" ? code : null, bytes },
  });
}

/** Consecutive failures at which "check your connection" stops being the likely story. */
const STUBBORN_AFTER_ATTEMPTS = 5;

/** The save keeps failing while the browser says it is online: worth knowing about, once per streak. */
function reportStubbornSave(projectId: string, attempts: number, since: number): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  logClient("warn", {
    domain: "studio",
    event: "project.save.stubborn",
    message: `Saving a book has failed ${attempts} times in a row while the browser is online.`,
    projectId,
    context: { attempts, failingForMs: Date.now() - since },
  });
}

/** A book that was failing to save has saved: say how long it took, so recovery time is visible. */
function reportSaveRecovered(projectId: string): void {
  const trouble = failingSaves.get(projectId);
  if (!trouble) return;
  failingSaves.delete(projectId);
  logClient("info", {
    domain: "studio",
    event: "project.save.recovered",
    message: "A book that was failing to save saved again.",
    projectId,
    context: { attempts: trouble.attempts, failedForMs: Date.now() - trouble.since },
  });
}

const sizeWatch = createSizeWatch();

/**
 * A book was stored at this many bytes. Logs the first time it reaches half, three quarters and nine
 * tenths of the limit in a session, with what is biggest in it, so growth is seen long before a save fails.
 */
export function reportStoredSize(projectId: string, bytes: number): void {
  const level = sizeWatch.observe(projectId, bytes);
  if (level === null) return;
  const project = useProjectsStore.getState().projects.find((p) => p.id === projectId);
  logClient(level >= 0.9 ? "error" : "warn", {
    domain: "studio",
    event: "project.size.high",
    message: `A book (${projectId.slice(0, 8)}) reached ${Math.round(level * 100)}% of the storage size limit.`,
    projectId,
    context: {
      level,
      bytes,
      limit: STORED_BOOK_LIMIT_BYTES,
      ratio: Math.round((bytes / STORED_BOOK_LIMIT_BYTES) * 1000) / 1000,
      parts: project ? biggestParts(project) : [],
    },
  });
}

/** Books that are failing to save right now: when it started and how many tries in a row. */
const failingSaves = new Map<string, { since: number; attempts: number }>();
const saveRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DEBOUNCE_MS = 350;
const saveDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPersist = new Map<string, { get: ProjectsGet; set: ProjectsSet }>();
const persistWaiters = new Map<string, Array<() => void>>();
/** Saves running right now (a book being sent). */
let savesInFlight = 0;
/** The copy on this device must not slow a save down by more than this. */
const KEEP_LOCAL_TIMEOUT_MS = 1_500;
let durableStorageAsked = false;

function clearSaveRetry(id: string): void {
  const timer = saveRetryTimers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  saveRetryTimers.delete(id);
}

function scheduleSaveRetry(get: ProjectsGet, set: ProjectsSet, id: string, attempts: number): void {
  clearSaveRetry(id);
  const timer = setTimeout(() => {
    saveRetryTimers.delete(id);
    void persistLatest(get, set, id);
  }, retryDelayMs(attempts));
  // A waiting retry must not keep a Node process (the offline checks) alive.
  (timer as { unref?: () => void }).unref?.();
  saveRetryTimers.set(id, timer);
}

/** Write the book to this device before it is sent; never waits longer than {@link KEEP_LOCAL_TIMEOUT_MS}. */
async function keepLocalCopy(project: Project, base: Project | undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      rememberUnsaved(project, base),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, KEEP_LOCAL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function persistLatest(get: ProjectsGet, set: ProjectsSet, id: string): Promise<void> {
  const next = saveChain.then(async () => {
    // A conflicted project is frozen from auto-save until the user reloads it,
    // so we don't keep re-attempting a write that can only be rejected.
    if (get().staleProjectId === id || get().bookConflict?.projectId === id) return;
    const current = get().projects.find((p) => p.id === id);
    if (!current) return;
    // This attempt replaces any retry that was waiting on its timer.
    clearSaveRetry(id);
    savesInFlight += 1;
    try {
      await saveBook(get, set, id, current);
    } finally {
      savesInFlight -= 1;
    }
  });
  saveChain = next.catch(() => {});
  return next;
}

/**
 * One attempt to store `current`. Everything that can go wrong sits inside the `try`, so no failure
 * is silent: the reader always sees the banner, and the changes are kept on this device either way.
 */
async function saveBook(get: ProjectsGet, set: ProjectsSet, id: string, current: Project): Promise<void> {
  let latest = current;
  let keptLocally = false;
  try {
    // Compacted in memory too, so the copy being edited and the stored one agree.
    latest = compactProjectHistory(current);
    if (latest !== current) {
      set((state) => ({ projects: state.projects.map((p) => (p === current ? latest : p)) }));
    }
    // Kept on this device before it is sent: a tab that closes mid-save, or a connection that never
    // comes back, loses nothing. Dropped again once the cloud has it.
    await keepLocalCopy(latest, savedBase.get(id));
    keptLocally = true;
    const { projects } = await getRepos();
    const saved = await projects.save(latest);
    savedBase.set(id, { ...latest, rev: saved.rev });
    // Fold the incremented generation back into the in-memory copy so the next
    // save uses it as its base (otherwise the tab would conflict with itself).
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id && p.rev !== saved.rev ? { ...p, rev: saved.rev } : p,
      ),
      ...(state.saveFailedProjectId === id
        ? { saveFailedProjectId: null, saveFailureReason: null, saveFailureAttempts: 0 }
        : {}),
    }));
    clearSaveRetry(id);
    reportSaveRecovered(id);
    // The cloud has everything up to this edit. A newer edit already waiting in memory keeps the
    // local copy until its own save lands.
    const newest = get().projects.find((p) => p.id === id);
    if (!newest || newest.updatedAt <= latest.updatedAt) void forgetSaved(id, latest.updatedAt);
    if (!durableStorageAsked) {
      durableStorageAsked = true;
      void keepStorageDurable();
    }
  } catch (err) {
    if (err instanceof ProjectConflictError) {
      if (conflictResolver && (await resolveConflict(get, set, id, latest))) return;
      // Another writer advanced the stored copy — flag it so the UI can prompt
      // a reload; the local edits stay in memory until then.
      set(() => ({ staleProjectId: id }));
      return;
    }
    // Keep the edits in memory and tell the user their work isn't stored yet.
    // Only a transient failure (e.g. offline) is worth retrying on a timer.
    const reason = saveFailureReasonOf(err);
    const earlier = failingSaves.get(id);
    const attempts = (earlier?.attempts ?? 0) + 1;
    const since = earlier?.since ?? Date.now();
    failingSaves.set(id, { since, attempts });
    const state = get();
    const isNew = state.saveFailedProjectId !== id || state.saveFailureReason !== reason;
    set(() => ({ saveFailedProjectId: id, saveFailureReason: reason, saveFailureAttempts: attempts }));
    if (isNew) reportSaveFailure(id, reason, err, latest);
    if (reason === "transient" && attempts === STUBBORN_AFTER_ATTEMPTS) reportStubbornSave(id, attempts, since);
    // Whatever stopped the save, the changes are on this device.
    if (!keptLocally) void rememberUnsaved(get().projects.find((p) => p.id === id) ?? latest, savedBase.get(id));
    if (isRetryable(reason)) scheduleSaveRetry(get, set, id, attempts);
  }
}

/** Records already dealt with this session, so a second load never applies them twice. */
const handledRecords = new Set<string>();
/** A copy of a book that is gone from the cloud is not kept forever. */
const ORPHAN_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Put back changes the last session never saved. For each record on this device, compared with the
 * book as the cloud has it:
 *   - the cloud already has them: the record is dropped;
 *   - the cloud is where the edits started: they are put back;
 *   - the cloud moved on: they are merged into it (the edits made here win a field both changed);
 *   - anything else is kept and reported, never guessed at.
 * Applied changes are saved again at once. Never throws: a failure here must not stop a book opening.
 */
async function recoverUnsaved(
  get: ProjectsGet,
  set: ProjectsSet,
  stored: readonly Project[],
  generation: number,
  options: { complete: boolean } = { complete: false },
): Promise<void> {
  try {
    const records: OutboxRecord[] = await pendingRecords();
    for (const record of records) {
      if (generation !== projectLoadGeneration) return;
      const key = `${record.projectId}@${record.savedAt}`;
      if (handledRecords.has(key)) continue;
      const cloud = stored.find((p) => p.id === record.projectId);
      // Opening one book says nothing about the others.
      if (!cloud && !options.complete) continue;
      const decision = decideRecovery(record, cloud ?? null);
      const context = { kind: decision.kind, baseRev: record.baseRev, cloudRev: cloud?.rev ?? null, ageMs: Date.now() - record.savedAt };

      if (decision.kind === "landed") {
        handledRecords.add(key);
        void forgetSaved(record.projectId, record.project.updatedAt);
        continue;
      }
      if (decision.kind === "orphan") {
        handledRecords.add(key);
        if (Date.now() - record.savedAt > ORPHAN_KEEP_MS) {
          void forgetBook(record.projectId);
        } else {
          logClient("error", { domain: "studio", event: "project.outbox.kept", message: "Unsaved changes were found for a book that is no longer stored.", projectId: record.projectId, context });
        }
        continue;
      }
      if (!cloud) continue;
      const current = get().projects.find((p) => p.id === record.projectId);
      // Edited since it was loaded: those edits are newer, and their own save keeps the local copy fresh.
      if (!current || (current.rev ?? 0) !== (cloud.rev ?? 0) || current.updatedAt !== cloud.updatedAt) continue;
      const result = recoveredBook(record, cloud, decision, Date.now());
      handledRecords.add(key);
      if (!result) {
        logClient("error", { domain: "studio", event: "project.outbox.kept", message: "Unsaved changes were found on this device and could not be put back safely.", projectId: record.projectId, context });
        continue;
      }
      const whole = repairPageWords(result.project);
      savedBase.set(record.projectId, cloud);
      set((state) => ({
        projects: state.projects.map((p) => (p.id === record.projectId ? whole : p)),
        recoveredNotice: {
          projectId: record.projectId,
          title: whole.title,
          kind: decision.kind === "merge" ? "merged" : "restored",
          conflicts: result.conflicts.length,
        },
      }));
      logClient("info", { domain: "studio", event: "project.outbox.restored", message: "Unsaved changes were found on this device and put back.", projectId: record.projectId, context: { ...context, conflicts: result.conflicts.length } });
      void persistLatest(get, set, record.projectId);
    }
  } catch {
    // The local copy is a safety net; losing the net must not stop the book from opening.
  }
}

/** Whether anything the reader typed is not in the cloud yet: a save being sent, waiting, or failing. */
function hasUnsavedChanges(state: ProjectsState): boolean {
  return savesInFlight > 0 || pendingPersist.size > 0 || state.saveFailedProjectId !== null;
}

/**
 * Hooks that make saving robust to the page and the network: retry the moment the connection or the
 * tab comes back, keep what is waiting on this device when the page goes away, and warn before
 * leaving with something unsaved. Installed once, in the browser.
 */
function installSaveListeners(): void {
  if (typeof window === "undefined") return;
  const get = useProjectsStore.getState;
  const set = useProjectsStore.setState as ProjectsSet;

  const retryNow = () => {
    const { saveFailedProjectId: id, saveFailureReason: reason } = get();
    if (id && reason && isRetryable(reason) && savesInFlight === 0) void persistLatest(get, set, id);
  };
  // Edits that are still waiting for their save, and the book that failed: written to this device now.
  const keepWaiting = () => {
    const ids = new Set(pendingPersist.keys());
    const failed = get().saveFailedProjectId;
    if (failed) ids.add(failed);
    for (const id of ids) {
      const book = get().projects.find((p) => p.id === id);
      if (book && get().staleProjectId !== id) void rememberUnsaved(book, savedBase.get(id));
    }
  };

  window.addEventListener("online", retryNow);
  window.addEventListener("pagehide", keepWaiting);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retryNow();
    else keepWaiting();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges(get())) return;
    event.preventDefault();
    event.returnValue = "";
  });
  void getRepos()
    .then(({ projects }) => projects.onStoredSize(reportStoredSize))
    .catch(() => {});
}

/** Coalesce rapid mutations into one storage write shortly after editing settles. */
function schedulePersist(get: ProjectsGet, set: ProjectsSet, id: string): Promise<void> {
  pendingPersist.set(id, { get, set });
  const prev = saveDebounceTimers.get(id);
  if (prev) clearTimeout(prev);
  return new Promise((resolve) => {
    const waiters = persistWaiters.get(id) ?? [];
    waiters.push(resolve);
    persistWaiters.set(id, waiters);
    saveDebounceTimers.set(
      id,
      setTimeout(() => {
        saveDebounceTimers.delete(id);
        pendingPersist.delete(id);
        const ready = persistWaiters.get(id) ?? [];
        persistWaiters.delete(id);
        void persistLatest(get, set, id).finally(() => {
          for (const w of ready) w();
        });
      }, SAVE_DEBOUNCE_MS),
    );
  });
}

/**
 * Wait for every queued save to land before reading the book back.
 *
 * Editing is fire-and-forget: a change lands in memory and the write follows.
 * That's fine while the browser is the only one drawing the book — but the
 * renderer works from the SAVED copy, so a render kicked off in the same
 * breath as the last edit would photograph the previous version, or (since the
 * fingerprint it was asked for wouldn't match what's on disk) refuse outright.
 * Anyone about to hand the book to the server waits here first.
 */
export function flushProjectSaves(): Promise<void> {
  for (const [id, { get, set }] of [...pendingPersist]) {
    const t = saveDebounceTimers.get(id);
    if (t) clearTimeout(t);
    saveDebounceTimers.delete(id);
    pendingPersist.delete(id);
    const ready = persistWaiters.get(id) ?? [];
    persistWaiters.delete(id);
    void persistLatest(get, set, id).finally(() => {
      for (const w of ready) w();
    });
  }
  return saveChain;
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
    // Whoever wrote, a page's words and its text box leave this write saying the same thing.
    const written = reconcileCoverWords(target, reconcilePageWords(target, mutator(target)));
    // Strictly later than the copy it replaces, so "is this the newest edit?" never ties.
    const updated: Project = { ...reconcileCoverLettering(written), updatedAt: Math.max(Date.now(), target.updatedAt + 1) };
    return {
      projects: state.projects.map((p) => (p.id === id ? updated : p)),
    };
  });
  if (!found) return Promise.resolve();
  return schedulePersist(get, set, id);
}

installSaveListeners();
