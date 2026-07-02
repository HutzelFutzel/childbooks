import type { BrandAsset } from "@/core/config/branding";
import type { SiteImageSlot } from "@/core/config/siteImages";

/** SSR-resolved landing illustrations, keyed by slot (from `appConfig/siteImages`). */
export type SiteImagesMap = Partial<Record<SiteImageSlot, BrandAsset>>;

/** SSR-resolved copy overrides, keyed by slot (from `appConfig/siteContent`). */
export type SiteTextMap = Record<string, string>;
