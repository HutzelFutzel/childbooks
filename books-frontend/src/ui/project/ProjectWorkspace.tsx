import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useProjectsStore } from "../../state/projectsStore";
/**
 * The Chat studio is loaded on demand so the studio's first load stays small.
 * `ssr: false` because it is a stateful conversation over the signed-in user's
 * own storage — there is nothing meaningful to render on the server.
 */
const GuideStudio = dynamic(() => import("../guide/GuideStudio").then((m) => m.GuideStudio), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-7 animate-spin text-brand-400" />
    </div>
  ),
});

export function ProjectWorkspace() {
  const currentId = useProjectsStore((s) => s.currentId);
  const hasProject = useProjectsStore((s) =>
    s.currentId !== null && s.projects.some((p) => p.id === s.currentId),
  );
  if (!currentId || !hasProject) return null;

  // The Chat studio derives where the book is from the book itself. Keyed by id
  // so its local state resets when switching books.
  return <GuideStudio key={currentId} />;
}
