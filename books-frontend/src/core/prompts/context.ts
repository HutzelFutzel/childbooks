/** Shared prompt overlays loaded from admin `appConfig/*` documents. */
import type { ArtStylesConfig } from "../config/artStyles";
import type { AgeWritingConfig } from "../config/ageWriting";

export interface PromptContext {
  artStyles?: ArtStylesConfig | null;
  ageWriting?: AgeWritingConfig | null;
}
