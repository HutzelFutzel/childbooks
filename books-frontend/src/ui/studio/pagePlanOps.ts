/**
 * The page editor's edits to one page's plan, each one studio undo step.
 *
 * They call the same pure functions the assistant's skills call
 * (`core/book/pagePlan.ts`), so a change typed in the chat and a change made on
 * the page's card come out the same. Editing is free: nothing here draws, and
 * nothing here can change the book's look (a scene has any style request taken out).
 */
import { insertPage, setPageCast, setPageHasPicture, setPageScene, setPageWords } from "../../core/book/pagePlan";
import type { PageSceneRequest } from "../../core/book/pageScene";
import { pageLabel } from "../../core/book/pageRefs";
import { ageBandLabel } from "../../core/config/storyCraftCatalog";
import type { Project } from "../../core/types";
import { getCursor } from "../../core/versioning";
import { pageSceneRemote } from "../../platform/aiClient";
import { useProjectsStore } from "../../state/projectsStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { ensureStoryBox } from "../design/designInit";
import { commitStudioProject } from "./studioUndo";

const layouts = () => useAppConfigStore.getState().layouts;

/** "Edited the words on page 4": the history names the page, so Undo says what it will take back. */
function onPage(what: string, pageId: string): string {
  const project = useProjectsStore.getState().current();
  return `${what} on ${project ? pageLabel(project, pageId) : "the page"}`;
}

/** The page's words, shown on the page and kept in its plan. */
export function editPageWords(pageId: string, words: string): void {
  commitStudioProject((p) => ensureStoryBox(setPageWords(p, pageId, words), pageId, layouts()), {
    label: onPage("Edited the words", pageId),
    plan: true,
  });
}

/** What is happening on the page. Anything in it that asks for another art style is taken out. */
export function editPageScene(pageId: string, scene: string): void {
  commitStudioProject((p) => setPageScene(p, pageId, scene), { label: onPage("Changed what's happening", pageId), plan: true });
}

/** Who is on the page. */
export function editPageCast(pageId: string, anchorIds: readonly string[]): void {
  commitStudioProject((p) => setPageCast(p, pageId, anchorIds), { label: onPage("Changed who is here", pageId), plan: true });
}

/** Put a picture on the page or take it off. The picture is kept either way, so this is free to undo. */
export function editPagePicture(pageId: string, on: boolean): void {
  commitStudioProject((p) => setPageHasPicture(p, pageId, on), {
    label: on ? onPage("Put a picture", pageId) : onPage("Took the picture off", pageId),
    plan: true,
  });
}

/** A new picture page, waiting to be described. Returns its id. */
export function addPicturePage(docIndex: number): string {
  let id = "";
  commitStudioProject(
    (p) => {
      const out = insertPage(p, docIndex, {});
      id = out.id;
      return out.project;
    },
    { label: "New page" },
  );
  return id;
}

/** What a neighboring page shows, in its own words: its description, else its words. */
function neighbourSays(project: Project, index: number): string {
  const spread = project.screenplay ? getCursor(project.screenplay).content.spreads[index] : undefined;
  return (spread?.illustration.trim() || spread?.text.trim() || "").slice(0, 400);
}

/** The request for a description of one page: its words, what is around it, and who is in the book. */
export function pageSceneRequestFor(
  project: Project,
  pageId: string,
  mode: PageSceneRequest["mode"],
  instruction = "",
): PageSceneRequest {
  const spreads = project.screenplay ? getCursor(project.screenplay).content.spreads : [];
  const at = spreads.findIndex((spread) => spread.id === pageId);
  const spread = at >= 0 ? spreads[at] : undefined;
  return {
    mode,
    words: spread?.text ?? "",
    scene: spread?.illustration ?? "",
    instruction,
    before: at > 0 ? neighbourSays(project, at - 1) : "",
    after: at >= 0 && at < spreads.length - 1 ? neighbourSays(project, at + 1) : "",
    people: (project.anchors ?? [])
      .filter((anchor) => anchor.type === "character" && anchor.include !== false && anchor.name.trim())
      .map((anchor) => ({ id: anchor.id, name: anchor.name.trim() })),
    audience: ageBandLabel(project.config.ageRangeId),
  };
}

/**
 * Ask for a description of the page and put it on the page. Free. When nobody is on the
 * page yet, the people the description names are put on it too. Returns false when
 * nothing came back, after saying why.
 */
export async function suggestPageScene(pageId: string, mode: PageSceneRequest["mode"], instruction = ""): Promise<boolean> {
  const project = useProjectsStore.getState().current();
  if (!project) return false;
  const result = await pageSceneRemote(project.id, pageSceneRequestFor(project, pageId, mode, instruction));
  commitStudioProject(
    (p) => {
      const withScene = setPageScene(p, pageId, result.scene);
      const spread = p.screenplay ? getCursor(p.screenplay).content.spreads.find((s) => s.id === pageId) : undefined;
      const nobodyYet = (spread?.anchorIds ?? []).length === 0;
      return nobodyYet && result.peopleIds.length > 0 ? setPageCast(withScene, pageId, result.peopleIds) : withScene;
    },
    { label: onPage("Suggested a description", pageId), plan: true },
  );
  return true;
}
