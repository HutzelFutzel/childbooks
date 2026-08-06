/**
 * Portal hosts for Cast / Pages filmstrips inside the Design chapter accordion.
 * Workspaces render their own filmstrip data but mount it into the open chapter body.
 */
import { createContext, useContext, type ReactNode } from "react";

export type DesignChapterHostsValue = {
  castHost: HTMLElement | null;
  pagesHost: HTMLElement | null;
};

const DesignChapterHostsContext = createContext<DesignChapterHostsValue | null>(null);

export function DesignChapterHostsProvider({
  value,
  children,
}: {
  value: DesignChapterHostsValue;
  children: ReactNode;
}) {
  return (
    <DesignChapterHostsContext.Provider value={value}>
      {children}
    </DesignChapterHostsContext.Provider>
  );
}

export function useDesignChapterHosts(): DesignChapterHostsValue | null {
  return useContext(DesignChapterHostsContext);
}
