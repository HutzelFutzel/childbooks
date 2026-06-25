import { useProjectsStore } from "../../state/projectsStore";
import { StudioWorkspace } from "../studio/StudioWorkspace";

export function ProjectWorkspace() {
  const project = useProjectsStore((s) => s.current());
  if (!project) return null;

  // Keyed by id so the studio's local state resets when switching books.
  return <StudioWorkspace key={project.id} project={project} />;
}
