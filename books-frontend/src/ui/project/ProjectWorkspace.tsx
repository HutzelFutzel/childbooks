import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { ResolvedGuideComponent } from "../../core/guide/playlist";
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
  guidePlaylist,
}: {
  destination: StudioDestination;
  onNavigate: (destination: StudioDestination) => void;
  /** Non-null only for a reader the rollout has put on the guided studio. */
  guidePlaylist?: readonly ResolvedGuideComponent[] | null;
}) {
  const project = useProjectsStore((s) => s.current());
  if (!project) return null;

  if (guidePlaylist) {
    return (
      <GuideStudio
        key={project.id}
        playlist={guidePlaylist}
        destination={destination}
        onNavigate={onNavigate}
      />
    );
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
