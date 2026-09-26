import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useProjectsStore } from "../../state/projectsStore";
import { StudioWorkspace } from "../studio/StudioWorkspace";
import type { StudioDestination } from "../studio/studioRoutes";

/**
 * The guided studio is loaded on demand.
 *
 * It ships to everyone but is reachable by nobody until the rollout says so, so
 * bundling it into the studio's first load would make every reader pay for a flow
 * they can't open. `ssr: false` because it is a stateful conversation over the
 * signed-in user's own storage — there is nothing meaningful to render on the server.
 */
const GuideStudio = dynamic(() => import("../guide/GuideStudio").then((m) => m.GuideStudio), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-7 animate-spin text-brand-400" />
    </div>
  ),
});

export function ProjectWorkspace({
  destination,
  onNavigate,
  guided = false,
}: {
  destination: StudioDestination;
  onNavigate: (destination: StudioDestination) => void;
  /** True only for a reader the rollout has put on the Chat studio. */
  guided?: boolean;
}) {
  const project = useProjectsStore((s) => s.current());
  if (!project) return null;

  // The Chat studio derives where the book is from the book itself; the route
  // only follows it.
  if (guided) {
    return <GuideStudio key={project.id} onNavigate={onNavigate} />;
  }

  // Keyed by id so the studio's local state resets when switching books.
  return (
    <StudioWorkspace
      key={project.id}
      project={project}
      destination={destination}
      onNavigate={onNavigate}
    />
  );
}
