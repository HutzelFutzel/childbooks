/**
 * Provider registry. Maps a ProviderId to its text/image implementations.
 * This is the single place to register a new provider.
 */
import type { ProviderId } from "../config/options";
import { googleImageProvider, googleTextProvider } from "./google";
import { openaiImageProvider, openaiTextProvider } from "./openai";
import type { ImageProvider, TextProvider } from "./types";

const TEXT_PROVIDERS: Record<ProviderId, TextProvider> = {
  openai: openaiTextProvider,
  google: googleTextProvider,
};

const IMAGE_PROVIDERS: Record<ProviderId, ImageProvider> = {
  openai: openaiImageProvider,
  google: googleImageProvider,
};

export function getTextProvider(provider: ProviderId): TextProvider {
  return TEXT_PROVIDERS[provider];
}

export function getImageProvider(provider: ProviderId): ImageProvider {
  return IMAGE_PROVIDERS[provider];
}

export const ALL_PROVIDERS: ProviderId[] = ["openai", "google"];

export * from "./types";
