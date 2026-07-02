# Landing page & branding graphics — to add later

Two kinds of graphics:

1. **Brand assets** (logo, favicon, icon, social image, watermark) are uploaded
   at runtime in **Admin → Marketing → Branding** and stored in
   `appConfig/branding`. No code change needed — upload and they appear
   everywhere (nav, footer, top bar, favicon, OG tags, JSON-LD).
2. **Illustrative art** on the landing page is now admin-editable **inline**:
   sign in as an admin, open the landing page, click **“Edit page”** (bottom-right,
   only visible to admins), then **drag an image onto any illustration** (or click
   it) → preview → **Accept** to upload. Files go to public storage
   (`public/site/…`) and are recorded in `appConfig/siteImages`; previous uploads
   are kept as restorable versions. Text is editable the same way — click any
   headline/paragraph to edit in place (stored in `appConfig/siteContent`).

## Brand assets (upload in Admin → Marketing → Branding)

| Slot | Where it's used | Suggested asset | Dimensions / format |
|------|-----------------|-----------------|---------------------|
| `logo` | Landing nav & footer, studio top bar | Horizontal logo, on light | SVG or transparent PNG, ~200×80 |
| `logoDark` | Reserved for dark surfaces (CTA band) | Horizontal logo, on dark | SVG or transparent PNG |
| `icon` | App icon / Apple touch icon, JSON-LD logo | Square mark | 512×512 PNG or SVG |
| `favicon` | Browser tab (site-wide, via metadata) | Simplified square mark | SVG or 512×512 PNG |
| `ogImage` | Open Graph / Twitter share card | Branded card w/ tagline | 1200×630 PNG |
| `watermark` | Overlay on public shared books | Subtle mark | SVG preferred |

## Landing illustrations (edit inline via “Edit page”)

| Slot id | Component | Suggested asset | Dimensions |
|---------|-----------|-----------------|------------|
| `hero.main` | `Hero.tsx` | Illustrated open storybook / sample spread | ~1200×900, transparent |
| `hero.card1`, `hero.card2` | `Hero.tsx` | Sample page thumbnails | ~400×500 each |
| `how.step1`, `how.step2`, `how.step3` | `HowItWorks.tsx` | Spot illustrations: writing / illustrating / printing | ~600×400 each |

## Notes
- Until an image is uploaded, each slot still renders a labeled
  `GraphicPlaceholder` (encodes the target ratio, so uploading real art won't
  shift the layout). Uploaded art renders via `next/image`.
- New editable slots live in `core/config/siteImages.ts` (`SITE_IMAGE_SLOTS`)
  and editable copy in `core/config/siteContent.ts` (`SITE_TEXT_SLOTS`).
