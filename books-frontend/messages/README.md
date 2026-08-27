# Message catalogues

One JSON file per locale, named for the locale id in
`src/core/i18n/locales.ts`. `en.json` is the source of truth: every other
catalogue is compared against it by `yarn check:locales`, which fails on a
missing key, an orphan key, a blank message or a dropped ICU placeholder.

A locale having a file here does **not** make it public. Serving a language is
gated separately by `PUBLISHED_LOCALE_IDS` in `src/core/i18n/publish.ts` — see
that file for why the two are deliberately different lists.

## Translation status

| Locale | Status |
| --- | --- |
| `en.json` | Source of truth. |
| `de.json` | **Unreviewed draft — not approved for publication.** Written in one pass to exercise the routing and fallback machinery, and never seen by a German speaker. Read it before `de` goes anywhere near `PUBLISHED_LOCALE_IDS`. |

## Conventions

- **Brand terms stay in English**: `Childbook Studio`, `Studio`, `Sparks`,
  `Lulu`, `PDF`, `FAQ`. "Sparks" is the product's own currency name, so
  translating it invents a second word for one thing.
- **ICU placeholders are copied exactly**, including the format:
  `{count, number}` is not the same as `{count}` — the bare form skips locale
  number formatting and renders `1500` where German wants `1.500`.
- **A missing key is not an error.** It falls back through the locale's
  `fallback` chain (see `i18n/request.ts`), so partial translation is a normal
  state during rollout. `check:locales` reports what's outstanding.
