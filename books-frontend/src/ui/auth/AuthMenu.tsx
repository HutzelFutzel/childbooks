"use client";

import { EndpaperMenu } from "../components/UserMenu";

/**
 * Workspace account control (Studio, Account, Admin) — delegates to the
 * unified `EndpaperMenu` with the full workspace item set.
 */
export function AuthMenu() {
  return <EndpaperMenu surface="workspace" />;
}
