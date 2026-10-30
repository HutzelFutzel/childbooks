"use client";

import { createContext, useContext } from "react";

const DevBannerContext = createContext(false);

/**
 * `show` is computed on the server (`isDev()` in the root layout) and passed
 * in as a prop, so client chrome does not re-read `NODE_ENV`. A client-side
 * check can come out true in a production bundle while the server correctly
 * omits {@link DevEnvironmentBanner}, which leaves a 1.5rem gap above the nav.
 */
export function DevBannerProvider({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  return <DevBannerContext.Provider value={show}>{children}</DevBannerContext.Provider>;
}

/** True only when the root layout actually rendered the dev-environment banner. */
export function useDevBanner(): boolean {
  return useContext(DevBannerContext);
}
