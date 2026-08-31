/**
 * Languages a reader can use for the CONTENT of a book.
 *
 * This is deliberately separate from `core/i18n/locales`: the Studio may stay
 * in English while the reader creates a Polish or Brazilian Portuguese book.
 * Definitions are a code-owned capability ceiling; admins only decide which
 * certified languages and fonts are currently offered.
 */
import { z } from "zod";

export type FontCoverageProfile = "western-latin" | "extended-latin";

export type LanguageFamilyGroup = "english" | "romance" | "germanic" | "slavic-turkic";

export const BOOK_LANGUAGE_IDS = [
  "en-US",
  "en-GB",
  "en-CA",
  "en-AU",
  "de-DE",
  "fr-FR",
  "fr-CA",
  "nl-NL",
  "tr-TR",
  "pl-PL",
  "es-ES",
  "es-419",
  "it-IT",
  "pt-PT",
  "pt-BR",
] as const;

export type BookLanguageId = (typeof BOOK_LANGUAGE_IDS)[number];

export interface BookLanguageDefinition {
  id: BookLanguageId;
  /** Regional flag emoji or symbol for immediate visual recognition. */
  flag: string;
  /** Name in the Studio's current UI language. */
  englishName: string;
  /** Name shown in the language itself. */
  endonym: string;
  region: string;
  /** Short 2-4 letter country/region code (e.g. US, UK, CA, AU, DE, FR, NL, TR, PL, ES, LATAM, IT, PT, BR). */
  regionShort: string;
  direction: "ltr";
  script: "Latn";
  fontProfile: FontCoverageProfile;
  familyGroup: LanguageFamilyGroup;
  /** Classic picture-book opening phrase in this language. */
  storyGreeting: string;
  /** Sample sentence with diacritics for typography previews in this language. */
  samplePhrase: string;
  /** Short regional nuance summary for badges. */
  tagline: string;
  /** Exact instruction included in every text-producing or evaluating prompt. */
  promptInstruction: string;
  /** Starting calibration against the English story-craft word bounds. */
  wordCountFactor: number;
  /** Representative non-ASCII glyphs which every offered font must cover. */
  requiredGlyphs: string;
  /** Ship only the proven baseline until an admin explicitly enables the rest. */
  defaultEnabled: boolean;
}

export const BOOK_LANGUAGES = [
  {
    id: "en-US",
    flag: "🇺🇸",
    englishName: "English (United States)",
    endonym: "English",
    region: "United States",
    regionShort: "US",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "english",
    storyGreeting: "Once upon a time…",
    samplePhrase: "The friendly dragon soared across the starry sky.",
    tagline: "American spelling & idiom",
    promptInstruction:
      "Write all reader-facing prose in natural American English. Use American spelling, vocabulary, punctuation and idiom.",
    wordCountFactor: 1,
    requiredGlyphs: "’“”–—…",
    defaultEnabled: true,
  },
  {
    id: "en-GB",
    flag: "🇬🇧",
    englishName: "English (United Kingdom)",
    endonym: "English",
    region: "United Kingdom",
    regionShort: "UK",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "english",
    storyGreeting: "Once upon a time…",
    samplePhrase: "The little badger wandered through the autumn colour.",
    tagline: "British spelling & cadence",
    promptInstruction:
      "Write all reader-facing prose in natural British English. Use British spelling, vocabulary, punctuation and idiom.",
    wordCountFactor: 1,
    requiredGlyphs: "’“”–—…",
    defaultEnabled: false,
  },
  {
    id: "en-CA",
    flag: "🇨🇦",
    englishName: "English (Canada)",
    endonym: "English",
    region: "Canada",
    regionShort: "CA",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "english",
    storyGreeting: "Once upon a time…",
    samplePhrase: "A sleepy beaver built a cabin by the peaceful harbour.",
    tagline: "Canadian spelling & tone",
    promptInstruction:
      "Write all reader-facing prose in natural Canadian English. Use Canadian spelling, vocabulary, punctuation and idiom rather than defaulting to US English.",
    wordCountFactor: 1,
    requiredGlyphs: "’“”–—…",
    defaultEnabled: false,
  },
  {
    id: "en-AU",
    flag: "🇦🇺",
    englishName: "English (Australia)",
    endonym: "English",
    region: "Australia",
    regionShort: "AU",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "english",
    storyGreeting: "Once upon a time…",
    samplePhrase: "A joyful kangaroo leaped across the sunny valley.",
    tagline: "Australian spelling & warmth",
    promptInstruction:
      "Write all reader-facing prose in natural Australian English. Use Australian spelling, vocabulary, punctuation and idiom.",
    wordCountFactor: 1,
    requiredGlyphs: "’“”–—…",
    defaultEnabled: false,
  },
  {
    id: "de-DE",
    flag: "🇩🇪",
    englishName: "German",
    endonym: "Deutsch",
    region: "Deutschland",
    regionShort: "DE",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "germanic",
    storyGreeting: "Es war einmal…",
    samplePhrase: "Über den grünen Hügeln träumt ein kleiner Bär.",
    tagline: "Standard Hochdeutsch",
    promptInstruction:
      "Write all reader-facing prose in natural German as used in Germany. Do not translate supplied names.",
    wordCountFactor: 0.88,
    requiredGlyphs: "ÄÖÜäöüßẞ’„“–—…",
    defaultEnabled: false,
  },
  {
    id: "fr-FR",
    flag: "🇫🇷",
    englishName: "French (France)",
    endonym: "Français",
    region: "France",
    regionShort: "FR",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "romance",
    storyGreeting: "Il était une fois…",
    samplePhrase: "Le petit renard découvrit un château enchanté.",
    tagline: "French for France",
    promptInstruction:
      "Write all reader-facing prose in natural French as used in France, with appropriate French punctuation and idiom. Do not translate supplied names.",
    wordCountFactor: 1.15,
    requiredGlyphs: "ÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸàâæçéèêëîïôœùûüÿ’«»–—…",
    defaultEnabled: false,
  },
  {
    id: "fr-CA",
    flag: "🇨🇦",
    englishName: "French (Canada)",
    endonym: "Français",
    region: "Canada",
    regionShort: "CA",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "romance",
    storyGreeting: "Il était une fois…",
    samplePhrase: "Sous les étoiles boréales, un oiseau chantait.",
    tagline: "Canadian French & idiom",
    promptInstruction:
      "Write all reader-facing prose in natural Canadian French. Use vocabulary and idiom appropriate to Canada rather than France French. Do not translate supplied names.",
    wordCountFactor: 1.15,
    requiredGlyphs: "ÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸàâæçéèêëîïôœùûüÿ’«»–—…",
    defaultEnabled: false,
  },
  {
    id: "nl-NL",
    flag: "🇳🇱",
    englishName: "Dutch",
    endonym: "Nederlands",
    region: "Nederland",
    regionShort: "NL",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "germanic",
    storyGreeting: "Er was eens…",
    samplePhrase: "Het kleine eendje zwom vrolijk door de brede gracht.",
    tagline: "Standard Dutch (Nederland)",
    promptInstruction:
      "Write all reader-facing prose in natural Dutch as used in the Netherlands. Do not translate supplied names.",
    wordCountFactor: 0.95,
    requiredGlyphs: "ÁÉÍÓÚÄËÏÖÜáéíóúäëïöüĲĳ’„“–—…",
    defaultEnabled: false,
  },
  {
    id: "tr-TR",
    flag: "🇹🇷",
    englishName: "Turkish",
    endonym: "Türkçe",
    region: "Türkiye",
    regionShort: "TR",
    direction: "ltr",
    script: "Latn",
    fontProfile: "extended-latin",
    familyGroup: "slavic-turkic",
    storyGreeting: "Bir varmış, bir yokmuş…",
    samplePhrase: "Güneşli tepelerde sevimli bir sincap koşuyordu.",
    tagline: "Turkish with dotted & dotless I",
    promptInstruction:
      "Write all reader-facing prose in natural Turkish as used in Türkiye. Preserve Turkish dotted and dotless I correctly, and do not translate supplied names.",
    wordCountFactor: 0.88,
    requiredGlyphs: "ÇĞİÖŞÜçğıöşüÂÎÛâîû’“”–—…",
    defaultEnabled: false,
  },
  {
    id: "pl-PL",
    flag: "🇵🇱",
    englishName: "Polish",
    endonym: "Polski",
    region: "Polska",
    regionShort: "PL",
    direction: "ltr",
    script: "Latn",
    fontProfile: "extended-latin",
    familyGroup: "slavic-turkic",
    storyGreeting: "Dawno, dawno temu…",
    samplePhrase: "W zaczarowanym borze mieszkał mały, dzielny jeżyk.",
    tagline: "Polish with full diacritics",
    promptInstruction:
      "Write all reader-facing prose in natural Polish as used in Poland. Do not translate supplied names.",
    wordCountFactor: 0.92,
    requiredGlyphs: "ĄĆĘŁŃÓŚŹŻąćęłńóśźż’„”–—…",
    defaultEnabled: false,
  },
  {
    id: "es-ES",
    flag: "🇪🇸",
    englishName: "Spanish (Spain)",
    endonym: "Español",
    region: "España",
    regionShort: "ES",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "romance",
    storyGreeting: "Había una vez…",
    samplePhrase: "En un bosque mágico vivía un dragón bondadoso.",
    tagline: "European Spanish (vosotros)",
    promptInstruction:
      "Write all reader-facing prose in natural Spanish as used in Spain. Use Spain vocabulary and forms such as vosotros where appropriate. Do not translate supplied names.",
    wordCountFactor: 1.1,
    requiredGlyphs: "ÁÉÍÑÓÚÜ¿¡áéíñóúü’«»–—…",
    defaultEnabled: false,
  },
  {
    id: "es-419",
    flag: "🌎",
    englishName: "Spanish (Latin America)",
    endonym: "Español",
    region: "Latinoamérica",
    regionShort: "LATAM",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "romance",
    storyGreeting: "Había una vez…",
    samplePhrase: "Bajo el cielo estrellado, una luciérnaga brillaba.",
    tagline: "Neutral Latin American Spanish",
    promptInstruction:
      "Write all reader-facing prose in neutral, natural Latin American Spanish. Avoid Spain-specific vosotros forms and strongly country-specific slang. Do not translate supplied names.",
    wordCountFactor: 1.1,
    requiredGlyphs: "ÁÉÍÑÓÚÜ¿¡áéíñóúü’«»–—…",
    defaultEnabled: false,
  },
  {
    id: "it-IT",
    flag: "🇮🇹",
    englishName: "Italian",
    endonym: "Italiano",
    region: "Italia",
    regionShort: "IT",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "romance",
    storyGreeting: "C'era una volta…",
    samplePhrase: "Nel fitto del bosco splendeva una luna d'argento.",
    tagline: "Standard Italian",
    promptInstruction:
      "Write all reader-facing prose in natural Italian as used in Italy. Do not translate supplied names.",
    wordCountFactor: 1.08,
    requiredGlyphs: "ÀÈÉÌÒÓÙàèéìòóù’«»–—…",
    defaultEnabled: false,
  },
  {
    id: "pt-PT",
    flag: "🇵🇹",
    englishName: "Portuguese (Portugal)",
    endonym: "Português",
    region: "Portugal",
    regionShort: "PT",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "romance",
    storyGreeting: "Era uma vez…",
    samplePhrase: "No cimo da montanha morava um pequeno esquilo.",
    tagline: "European Portuguese",
    promptInstruction:
      "Write all reader-facing prose in natural European Portuguese as used in Portugal. Do not use Brazilian vocabulary or grammar, and do not translate supplied names.",
    wordCountFactor: 1.08,
    requiredGlyphs: "ÁÂÃÀÇÉÊÍÓÔÕÚáâãàçéêíóôõú’«»–—…",
    defaultEnabled: false,
  },
  {
    id: "pt-BR",
    flag: "🇧🇷",
    englishName: "Portuguese (Brazil)",
    endonym: "Português",
    region: "Brasil",
    regionShort: "BR",
    direction: "ltr",
    script: "Latn",
    fontProfile: "western-latin",
    familyGroup: "romance",
    storyGreeting: "Era uma vez…",
    samplePhrase: "Na floresta colorida, um tucano cantava alegremente.",
    tagline: "Brazilian Portuguese",
    promptInstruction:
      "Write all reader-facing prose in natural Brazilian Portuguese. Use Brazilian vocabulary, grammar and idiom rather than European Portuguese, and do not translate supplied names.",
    wordCountFactor: 1.08,
    requiredGlyphs: "ÁÂÃÀÇÉÊÍÓÔÕÚáâãàçéêíóôõú’“”–—…",
    defaultEnabled: false,
  },
] as const satisfies readonly BookLanguageDefinition[];

export const DEFAULT_BOOK_LANGUAGE_ID: BookLanguageId = "en-US";

const languageById = new Map<string, BookLanguageDefinition>(
  BOOK_LANGUAGES.map((language) => [language.id, language]),
);

export function isBookLanguageId(value: unknown): value is BookLanguageId {
  return typeof value === "string" && languageById.has(value);
}

export function getBookLanguage(id?: string | null): BookLanguageDefinition {
  return languageById.get(id ?? "") ?? languageById.get(DEFAULT_BOOK_LANGUAGE_ID)!;
}

export interface BookLanguageOverride {
  enabled?: boolean;
  /** Admin-curated subset of fonts already certified for this language. */
  fontIds?: string[];
  defaultBodyFontId?: string;
  defaultTitleFontId?: string;
}

export interface BookLanguagesConfig {
  version: 1;
  /** Normalization removes keys which are not part of the code-owned registry. */
  overrides: Record<string, BookLanguageOverride>;
}

export function createDefaultBookLanguagesConfig(): BookLanguagesConfig {
  return { version: 1, overrides: {} };
}

export function normalizeBookLanguagesConfig(input: unknown): BookLanguagesConfig {
  const source = (input ?? {}) as Partial<BookLanguagesConfig>;
  const overrides: BookLanguagesConfig["overrides"] = {};
  for (const [id, value] of Object.entries(source.overrides ?? {})) {
    if (!isBookLanguageId(id) || !value || typeof value !== "object") continue;
    const override = value as BookLanguageOverride;
    overrides[id] = {
      ...(typeof override.enabled === "boolean" ? { enabled: override.enabled } : {}),
      ...(Array.isArray(override.fontIds)
        ? { fontIds: [...new Set(override.fontIds.filter((font): font is string => typeof font === "string"))] }
        : {}),
      ...(typeof override.defaultBodyFontId === "string"
        ? { defaultBodyFontId: override.defaultBodyFontId }
        : {}),
      ...(typeof override.defaultTitleFontId === "string"
        ? { defaultTitleFontId: override.defaultTitleFontId }
        : {}),
    };
  }
  return { version: 1, overrides };
}

export function isBookLanguageEnabled(
  id: string,
  config?: BookLanguagesConfig | null,
): boolean {
  const language = languageById.get(id);
  if (!language) return false;
  return config?.overrides[id]?.enabled ?? language.defaultEnabled;
}

export function enabledBookLanguages(
  config?: BookLanguagesConfig | null,
): BookLanguageDefinition[] {
  return BOOK_LANGUAGES.filter((language) => isBookLanguageEnabled(language.id, config));
}

const COUNTRY_CODE_MAP: Record<string, BookLanguageId> = {
  US: "en-US",
  GB: "en-GB",
  UK: "en-GB",
  AU: "en-AU",
  NZ: "en-AU",
  DE: "de-DE",
  AT: "de-DE",
  CH: "de-DE",
  FR: "fr-FR",
  NL: "nl-NL",
  TR: "tr-TR",
  PL: "pl-PL",
  ES: "es-ES",
  IT: "it-IT",
  PT: "pt-PT",
  BR: "pt-BR",
  MX: "es-419",
  AR: "es-419",
  CO: "es-419",
  CL: "es-419",
  PE: "es-419",
  VE: "es-419",
  EC: "es-419",
  GT: "es-419",
  CU: "es-419",
  BO: "es-419",
  DO: "es-419",
  HN: "es-419",
  PY: "es-419",
  SV: "es-419",
  NI: "es-419",
  CR: "es-419",
  PR: "es-419",
  PA: "es-419",
  UY: "es-419",
};

/**
 * Resolves the best default book language for a new project based on
 * geo country detection, browser locales, and timezone, constrained by
 * admin-enabled languages.
 */
export function detectDefaultBookLanguage(
  config?: BookLanguagesConfig | null,
  countryHint?: string | null,
): BookLanguageId {
  // 1. Check country hint (e.g. from geo ip detection / shipping country store)
  const normalizedCountry = countryHint?.trim().toUpperCase();
  if (normalizedCountry) {
    if (normalizedCountry === "CA") {
      const browserLang = typeof navigator !== "undefined" ? navigator.language?.toLowerCase() : "";
      const caCandidate: BookLanguageId = browserLang.startsWith("fr") ? "fr-CA" : "en-CA";
      if (isBookLanguageEnabled(caCandidate, config)) return caCandidate;
    } else if (normalizedCountry === "BE") {
      const browserLang = typeof navigator !== "undefined" ? navigator.language?.toLowerCase() : "";
      const beCandidate: BookLanguageId = browserLang.startsWith("fr") ? "fr-FR" : "nl-NL";
      if (isBookLanguageEnabled(beCandidate, config)) return beCandidate;
    } else if (COUNTRY_CODE_MAP[normalizedCountry]) {
      const candidate = COUNTRY_CODE_MAP[normalizedCountry];
      if (isBookLanguageEnabled(candidate, config)) return candidate;
    }
  }

  // 2. Check browser navigator languages / locale
  if (typeof navigator !== "undefined") {
    const rawLocales = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
    ].filter((l): l is string => Boolean(l));

    for (const raw of rawLocales) {
      const norm = raw.trim().toLowerCase();
      if (norm.startsWith("en-gb") && isBookLanguageEnabled("en-GB", config)) return "en-GB";
      if (norm.startsWith("en-ca") && isBookLanguageEnabled("en-CA", config)) return "en-CA";
      if (norm.startsWith("en-au") && isBookLanguageEnabled("en-AU", config)) return "en-AU";
      if (norm.startsWith("en-us") && isBookLanguageEnabled("en-US", config)) return "en-US";
      if (norm.startsWith("fr-ca") && isBookLanguageEnabled("fr-CA", config)) return "fr-CA";
      if (norm.startsWith("fr") && isBookLanguageEnabled("fr-FR", config)) return "fr-FR";
      if (norm.startsWith("de") && isBookLanguageEnabled("de-DE", config)) return "de-DE";
      if (norm.startsWith("nl") && isBookLanguageEnabled("nl-NL", config)) return "nl-NL";
      if (norm.startsWith("tr") && isBookLanguageEnabled("tr-TR", config)) return "tr-TR";
      if (norm.startsWith("pl") && isBookLanguageEnabled("pl-PL", config)) return "pl-PL";
      if (norm.startsWith("it") && isBookLanguageEnabled("it-IT", config)) return "it-IT";
      if (norm.startsWith("pt-br") && isBookLanguageEnabled("pt-BR", config)) return "pt-BR";
      if (norm.startsWith("pt") && isBookLanguageEnabled("pt-PT", config)) return "pt-PT";
      if ((norm.startsWith("es-419") || norm.includes("latam")) && isBookLanguageEnabled("es-419", config)) return "es-419";
      if (norm.startsWith("es") && isBookLanguageEnabled("es-ES", config)) return "es-ES";
      if (norm.startsWith("en") && isBookLanguageEnabled("en-US", config)) return "en-US";
    }
  }

  // 3. Check timezone hint
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) {
      if (tz.startsWith("Europe/Berlin") || tz.startsWith("Europe/Vienna") || tz.startsWith("Europe/Zurich")) {
        if (isBookLanguageEnabled("de-DE", config)) return "de-DE";
      }
      if (tz.startsWith("Europe/Paris") || tz.startsWith("Europe/Brussels")) {
        if (isBookLanguageEnabled("fr-FR", config)) return "fr-FR";
      }
      if (tz.startsWith("Europe/London")) {
        if (isBookLanguageEnabled("en-GB", config)) return "en-GB";
      }
      if (tz.startsWith("Australia/")) {
        if (isBookLanguageEnabled("en-AU", config)) return "en-AU";
      }
      if (tz.startsWith("America/Sao_Paulo")) {
        if (isBookLanguageEnabled("pt-BR", config)) return "pt-BR";
      }
      if (
        tz.startsWith("America/Mexico_City") ||
        tz.startsWith("America/Bogota") ||
        tz.startsWith("America/Santiago") ||
        tz.startsWith("America/Buenos_Aires") ||
        tz.startsWith("America/Lima")
      ) {
        if (isBookLanguageEnabled("es-419", config)) return "es-419";
      }
      if (tz.startsWith("Europe/Madrid")) {
        if (isBookLanguageEnabled("es-ES", config)) return "es-ES";
      }
      if (tz.startsWith("Europe/Rome")) {
        if (isBookLanguageEnabled("it-IT", config)) return "it-IT";
      }
      if (tz.startsWith("Europe/Warsaw")) {
        if (isBookLanguageEnabled("pl-PL", config)) return "pl-PL";
      }
      if (tz.startsWith("Europe/Istanbul")) {
        if (isBookLanguageEnabled("tr-TR", config)) return "tr-TR";
      }
      if (tz.startsWith("Europe/Amsterdam")) {
        if (isBookLanguageEnabled("nl-NL", config)) return "nl-NL";
      }
      if (tz.startsWith("Europe/Lisbon")) {
        if (isBookLanguageEnabled("pt-PT", config)) return "pt-PT";
      }
    }
  } catch {
    // Non-fatal
  }

  // 4. Fallback: en-US if enabled, else first enabled language
  if (isBookLanguageEnabled(DEFAULT_BOOK_LANGUAGE_ID, config)) {
    return DEFAULT_BOOK_LANGUAGE_ID;
  }
  const enabled = enabledBookLanguages(config);
  return enabled[0]?.id ?? DEFAULT_BOOK_LANGUAGE_ID;
}

const bookLanguageOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  fontIds: z.array(z.string().min(1)).optional(),
  defaultBodyFontId: z.string().min(1).optional(),
  defaultTitleFontId: z.string().min(1).optional(),
});

export const bookLanguagesConfigSchema = z.object({
  version: z.literal(1),
  overrides: z.record(z.string(), bookLanguageOverrideSchema).default({}),
});
