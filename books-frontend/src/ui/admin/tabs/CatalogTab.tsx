"use client";

import { useAdminTab } from "../adminTabStore";
import { ProductsTab } from "./ProductsTab";
import { EbookTab } from "./EbookTab";
import { PacksTab } from "./PacksTab";

/**
 * The Catalog: everything a customer can buy once. Segment is chosen in the
 * sidebar (Print / Digital edition / Spark packs); this panel just renders
 * the matching editor.
 */
export function CatalogTab() {
  const segment = useAdminTab((s) => s.catalogSegment);

  if (segment === "ebook") return <EbookTab />;
  if (segment === "packs") return <PacksTab />;
  return <ProductsTab />;
}
