/**
 * Repositories: typed persistence on top of the platform storage backend.
 * Pure orchestration over the KeyValueStore — no React.
 */
import { createDefaultSettings, type AppSettings } from "../settings";
import type { ProviderId } from "../config/options";
import type { RawModel } from "../providers/types";
import type { Project } from "../types";
import type { StorageBackend } from "./types";

const SETTINGS_KEY = "settings";
/** Legacy key: ALL projects packed into one document (pre-split). */
const LEGACY_PROJECTS_KEY = "projects";
/** Per-project key prefix — each project is now its own KV document. */
const PROJECT_KEY_PREFIX = "project:";
const MODELS_KEY = (provider: ProviderId) => `models:${provider}`;

const projectKey = (id: string) => `${PROJECT_KEY_PREFIX}${id}`;
const isProjectKey = (key: string) => key.startsWith(PROJECT_KEY_PREFIX);

export interface CachedDiscovery {
  models: RawModel[];
  fetchedAt: number;
}

/**
 * Thrown by {@link ProjectRepository.save} when the stored project has advanced
 * past the generation the caller edited from — i.e. another tab/device saved in
 * the meantime. The caller's write is rejected (never applied) so it can prompt
 * the user to reload instead of silently overwriting the newer state.
 */
export class ProjectConflictError extends Error {
  constructor(
    public projectId: string,
    public storedRev: number,
    public baseRev: number,
  ) {
    super("This book was changed somewhere else.");
    this.name = "ProjectConflictError";
  }
}

export class SettingsRepository {
  constructor(private backend: StorageBackend) {}

  async load(): Promise<AppSettings> {
    const stored = await this.backend.kv.get<AppSettings>(SETTINGS_KEY);
    if (!stored) return createDefaultSettings();
    const defaults = createDefaultSettings();
    return {
      ...defaults,
      ...stored,
      apiKeys: { ...defaults.apiKeys, ...stored.apiKeys },
      colorHistory: stored.colorHistory ?? defaults.colorHistory,
      assets: stored.assets ?? defaults.assets,
      fulfillment: {
        ...defaults.fulfillment,
        ...stored.fulfillment,
        lulu: { ...defaults.fulfillment.lulu, ...stored.fulfillment?.lulu },
        assetHost: stored.fulfillment?.assetHost ?? defaults.fulfillment.assetHost,
      },
    };
  }

  async save(settings: AppSettings): Promise<void> {
    await this.backend.kv.set(SETTINGS_KEY, settings);
  }
}

/**
 * Persistence for projects. Each project is stored in its OWN key-value document
 * (`project:{id}`) rather than one monolithic map, so:
 *   - a save only ever rewrites the one project it touches (no cross-project
 *     read-modify-write clobbering, and no shared-document write contention), and
 *   - no single document accumulates every project's full version history, which
 *     would eventually blow Firestore's 1 MB per-document limit.
 *
 * Writes are transactional and monotonic by `updatedAt` when the backend supports
 * it, so a delayed/stale save can never overwrite a newer committed state.
 *
 * Legacy data written under the single `projects` key is migrated lazily (and
 * once) the first time projects are read.
 */
export class ProjectRepository {
  constructor(private backend: StorageBackend) {}

  /**
   * Split any legacy monolithic `projects` map into per-project documents, then
   * drop the legacy key. Stateless and idempotent: once the legacy key is gone
   * (the common case) it's a single cheap read that no-ops — so it stays correct
   * even when one repository instance outlives a user switch (guest → account),
   * where a cached "already migrated" flag would wrongly skip the new user.
   */
  private async migrateLegacy(): Promise<void> {
    const legacy = await this.backend.kv.get<Record<string, Project>>(LEGACY_PROJECTS_KEY);
    if (!legacy) return;
    if (Object.keys(legacy).length > 0) {
      await Promise.all(
        Object.values(legacy).map((p) => this.backend.kv.set(projectKey(p.id), p)),
      );
    }
    await this.backend.kv.remove(LEGACY_PROJECTS_KEY);
  }

  async list(): Promise<Project[]> {
    await this.migrateLegacy();
    const keys = (await this.backend.kv.keys()).filter(isProjectKey);
    const projects = await Promise.all(
      keys.map((k) => this.backend.kv.get<Project>(k)),
    );
    return projects
      .filter((p): p is Project => Boolean(p))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Project | null> {
    const direct = await this.backend.kv.get<Project>(projectKey(id));
    if (direct) return direct;
    // Fall back to the legacy map for reads that race the lazy migration.
    const legacy = await this.backend.kv.get<Record<string, Project>>(LEGACY_PROJECTS_KEY);
    return legacy?.[id] ?? null;
  }

  /**
   * Persist a project with optimistic concurrency. Uses a transactional
   * compare-and-set on `rev` when the backend supports it: the write only
   * proceeds if the stored generation still matches the one the caller edited
   * from (`project.rev`); otherwise it throws {@link ProjectConflictError} and
   * applies nothing. On success the stored (and returned) project carries the
   * incremented `rev`, which the caller must fold back into its in-memory copy so
   * the next save uses the new base.
   *
   * Backends without transactions fall back to a plain write (no cross-writer
   * protection), still returning the bumped `rev` for a consistent contract.
   */
  async save(project: Project): Promise<Project> {
    const key = projectKey(project.id);
    const baseRev = project.rev ?? 0;
    const next: Project = { ...project, rev: baseRev + 1 };
    if (this.backend.kv.update) {
      return this.backend.kv.update<Project>(key, (prev) => {
        if (prev && (prev.rev ?? 0) !== baseRev) {
          throw new ProjectConflictError(project.id, prev.rev ?? 0, baseRev);
        }
        return next;
      });
    }
    await this.backend.kv.set(key, next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.backend.kv.remove(projectKey(id));
  }
}

/** Caches the last successful model discovery per provider (local-first). */
export class ModelCacheRepository {
  constructor(private backend: StorageBackend) {}

  async get(provider: ProviderId): Promise<CachedDiscovery | null> {
    return this.backend.kv.get<CachedDiscovery>(MODELS_KEY(provider));
  }

  async set(provider: ProviderId, models: RawModel[]): Promise<void> {
    await this.backend.kv.set(MODELS_KEY(provider), {
      models,
      fetchedAt: Date.now(),
    } satisfies CachedDiscovery);
  }
}
