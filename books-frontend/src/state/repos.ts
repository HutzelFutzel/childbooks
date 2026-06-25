/** Lazily-constructed repository singletons bound to the active storage backend. */
import {
  ModelCacheRepository,
  ProjectRepository,
  SettingsRepository,
} from "../core/storage/repositories";
import { getStorage } from "../platform/storage";

let reposPromise: Promise<{
  settings: SettingsRepository;
  projects: ProjectRepository;
  models: ModelCacheRepository;
}> | null = null;

export function getRepos() {
  if (!reposPromise) {
    reposPromise = (async () => {
      const backend = await getStorage();
      return {
        settings: new SettingsRepository(backend),
        projects: new ProjectRepository(backend),
        models: new ModelCacheRepository(backend),
      };
    })();
  }
  return reposPromise;
}
