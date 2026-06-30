/**
 * Backend runtime config.
 *
 * Reuses the SAME env -> typed config mapping the repo already defines in
 * `books-frontend/src/core/config/serverEnv.ts`, fed from `process.env`. When
 * deployed, the secrets declared in `secrets.ts` are injected into
 * `process.env`; in the emulator they come from `functions/.env.local` /
 * `functions/.secret.local`.
 */
import { loadServerConfig, type ServerConfig } from "../../books-frontend/src/core/config/serverEnv";

export function serverConfig(): ServerConfig {
  return loadServerConfig(process.env as Record<string, string | undefined>);
}
