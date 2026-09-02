/** Portal host for the Pages filmstrip inside the Design chapter accordion. */
import { createContext, useContext, type ReactNode } from "react";

export type DesignChapterHostsValue = {
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
