/** Lazily-constructed repository singletons bound to the active storage backend. */
import {
  GuideSessionRepository,
  ModelCacheRepository,
  ProjectRepository,
  SettingsRepository,
} from "../core/storage/repositories";
import { getStorage } from "../platform/storage";

let reposPromise: Promise<{
  settings: SettingsRepository;
  projects: ProjectRepository;
  models: ModelCacheRepository;
  guide: GuideSessionRepository;
}> | null = null;

export function getRepos() {
  if (!reposPromise) {
    reposPromise = (async () => {
      const backend = await getStorage();
      return {
        settings: new SettingsRepository(backend),
        projects: new ProjectRepository(backend),
        models: new ModelCacheRepository(backend),
        guide: new GuideSessionRepository(backend),
      };
    })();
  }
  return reposPromise;
}

/** For checks: forget the repositories built so far, so the next call binds the backend now in use. */
export function resetReposForChecks(): void {
  reposPromise = null;
}
