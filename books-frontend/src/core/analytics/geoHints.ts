/**
 * Browser locale + timezone, for the backend's coarse country guess.
 *
 * Only the client can read these. They are hints, never identity — see
 * `functions/src/geo.ts` for how the server turns them into a market.
 */
export function browserGeoHints(): { locale: string; tz: string } {
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    // Ancient / locked-down environment. The backend still has locale.
  }
  const locale = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return { locale, tz };
}
