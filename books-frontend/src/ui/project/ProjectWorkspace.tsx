import { useProjectsStore } from "../../state/projectsStore";
import { StudioWorkspace } from "../studio/StudioWorkspace";
import type { StudioDestination } from "../studio/studioRoutes";

export function ProjectWorkspace({
  destination,
  onNavigate,
}: {
  destination: StudioDestination;
  onNavigate: (destination: StudioDestination) => void;
}) {
  const project = useProjectsStore((s) => s.current());
  if (!project) return null;

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
