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
const PROJECTS_KEY = "projects";
const MODELS_KEY = (provider: ProviderId) => `models:${provider}`;

export interface CachedDiscovery {
  models: RawModel[];
  fetchedAt: number;
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

export class ProjectRepository {
  constructor(private backend: StorageBackend) {}

  private async readAll(): Promise<Record<string, Project>> {
    return (await this.backend.kv.get<Record<string, Project>>(PROJECTS_KEY)) ?? {};
  }

  private async writeAll(map: Record<string, Project>): Promise<void> {
    await this.backend.kv.set(PROJECTS_KEY, map);
  }

  async list(): Promise<Project[]> {
    const map = await this.readAll();
    return Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Project | null> {
    const map = await this.readAll();
    return map[id] ?? null;
  }

  async save(project: Project): Promise<void> {
    const map = await this.readAll();
    map[project.id] = project;
    await this.writeAll(map);
  }

  async remove(id: string): Promise<void> {
    const map = await this.readAll();
    delete map[id];
    await this.writeAll(map);
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
