"use client";

import { EndpaperMenu } from "../components/UserMenu";

/**
 * Marketing account control — delegates to the unified `EndpaperMenu` with
 * the marketing item set.
 */
export function AccountMenu() {
  return <EndpaperMenu surface="marketing" />;
}
