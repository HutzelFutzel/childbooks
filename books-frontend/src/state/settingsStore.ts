import { create } from "zustand";
import type { ProviderId } from "../core/config/options";
import { ALL_PROVIDERS } from "../core/providers";
import { discoverProvider, type ProviderDiscovery } from "../core/models/registry";
import {
  createDefaultSettings,
  hasKey,
  withColor,
  type AppSettings,
  type AssetItem,
} from "../core/settings";
import { getRepos } from "./repos";

/** Re-fetch model lists in the background if the cache is older than this. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type ConnectionStatus = "idle" | "testing" | "ok" | "error";

interface ProviderConnection {
  status: ConnectionStatus;
  message?: string;
  modelCount?: number;
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  /** Live discovery results keyed by provider, populated by tests / refresh. */
  discovery: Partial<Record<ProviderId, ProviderDiscovery>>;
  connections: Record<ProviderId, ProviderConnection>;

  load: () => Promise<void>;
  setApiKey: (provider: ProviderId, key: string) => void;
  saveKey: (provider: ProviderId) => Promise<void>;
  testConnection: (provider: ProviderId) => Promise<void>;
  hasAnyKey: () => boolean;
  /** Record a recently-used color in the MRU history (persisted). */
  pushColor: (color: string) => void;
  /** Add a reusable image asset (persisted). */
  addAsset: (asset: AssetItem) => void;
  removeAsset: (id: string) => void;
  renameAsset: (id: string, name: string) => void;
}

/** Persist the current settings snapshot (best-effort). */
async function persistSettings(settings: AppSettings) {
  try {
    const repos = await getRepos();
    await repos.settings.save(settings);
  } catch {
    // Local persistence is best-effort.
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: createDefaultSettings(),
  loaded: false,
  discovery: {},
  connections: {
    openai: { status: "idle" },
    google: { status: "idle" },
  },

  async load() {
    const repos = await getRepos();
    const loaded = await repos.settings.load();

    // Hydrate model lists from the last successful discovery so the UI shows
    // real, recent models immediately (even offline) instead of guesses.
    const discovery: Partial<Record<ProviderId, ProviderDiscovery>> = {};
    const staleProviders: ProviderId[] = [];
    for (const p of ALL_PROVIDERS) {
      const cached = await repos.models.get(p);
      if (cached) {
        discovery[p] = { provider: p, models: cached.models };
        if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) staleProviders.push(p);
      } else {
        staleProviders.push(p);
      }
    }
    set({ settings: loaded, loaded: true, discovery });

    // Background-refresh keyed providers whose cache is missing/stale.
    for (const p of ALL_PROVIDERS) {
      if (hasKey(loaded, p) && staleProviders.includes(p)) {
        void get().testConnection(p);
      }
    }
  },

  setApiKey(provider, key) {
    set((state) => ({
      settings: {
        ...state.settings,
        apiKeys: { ...state.settings.apiKeys, [provider]: key },
      },
    }));
  },

  async saveKey(provider) {
    const { settings } = await getRepos();
    await settings.save(get().settings);
    // Saving a new key invalidates a previous connection result.
    set((state) => ({
      connections: {
        ...state.connections,
        [provider]: { status: "idle" },
      },
    }));
  },

  async testConnection(provider) {
    const key = get().settings.apiKeys[provider]?.trim();
    if (!key) {
      set((state) => ({
        connections: {
          ...state.connections,
          [provider]: { status: "error", message: "No API key set." },
        },
      }));
      return;
    }
    set((state) => ({
      connections: {
        ...state.connections,
        [provider]: { status: "testing" },
      },
    }));
    const result = await discoverProvider(provider, { apiKey: key });
    if (result.error) {
      set((state) => ({
        discovery: { ...state.discovery, [provider]: result },
        connections: {
          ...state.connections,
          [provider]: { status: "error", message: result.error },
        },
      }));
    } else {
      set((state) => ({
        discovery: { ...state.discovery, [provider]: result },
        connections: {
          ...state.connections,
          [provider]: {
            status: "ok",
            modelCount: result.models.length,
            message: `${result.models.length} models available`,
          },
        },
      }));
      // Persist the fresh list so it survives reloads / offline use.
      try {
        const repos = await getRepos();
        await repos.models.set(provider, result.models);
      } catch {
        // Caching is best-effort; ignore failures.
      }
    }
  },

  hasAnyKey() {
    const s = get().settings;
    return hasKey(s, "openai") || hasKey(s, "google");
  },

  pushColor(color) {
    set((state) => {
      const settings = { ...state.settings, colorHistory: withColor(state.settings.colorHistory, color) };
      void persistSettings(settings);
      return { settings };
    });
  },

  addAsset(asset) {
    set((state) => {
      const settings = { ...state.settings, assets: [asset, ...state.settings.assets] };
      void persistSettings(settings);
      return { settings };
    });
  },

  removeAsset(id) {
    set((state) => {
      const settings = { ...state.settings, assets: state.settings.assets.filter((a) => a.id !== id) };
      void persistSettings(settings);
      return { settings };
    });
  },

  renameAsset(id, name) {
    set((state) => {
      const settings = {
        ...state.settings,
        assets: state.settings.assets.map((a) => (a.id === id ? { ...a, name } : a)),
      };
      void persistSettings(settings);
      return { settings };
    });
  },
}));
