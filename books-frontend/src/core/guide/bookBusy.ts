/**
 * Whether the book is being drawn right now, and what.
 *
 * A book that is mid-redraw is not ready to print: the order is rendered from
 * the saved book, so a picture that is about to change could print as it was.
 * One answer, read by every screen that shows progress or offers to print:
 * the book pane, the chat, the tabs and the order screen. Pure: the live job
 * state goes in, a description of the work comes out.
 */
import { COVER_BACK_ID, COVER_FRONT_ID, type Project } from "../types";
import { briefOf, namedCast } from "../story/brief";
import { pageNumberOf } from "../book/pageRefs";

export type BusyKind = "page" | "cover" | "person" | "thing" | "plan";

export interface BusyItem {
  kind: BusyKind;
  /** The unit to bring into view: a page, a cover, a person or a thing. */
  id: string;
  /** Inside page number, for a page. */
  page?: number;
  /** A person's or thing's name. */
  name?: string;
}

export interface BookBusy {
  busy: boolean;
  /** What is being drawn, pages and covers first in book order, then people and things. */
  items: BusyItem[];
  /** The part of the book the reader sees (pages and covers), when any. */
  pages: BusyItem[];
}

export interface BusySignals {
  /** Ids a live job is working on (`jobsStore.activeUnitIds`), plus people just started. */
  activeUnitIds?: ReadonlySet<string>;
  /** The page plan is being made. */
  planRunning?: boolean;
  /** Pages the chat is about to redraw (`redrawHold`): busy before the job exists. */
  held?: readonly string[];
}

const IDLE: BookBusy = { busy: false, items: [], pages: [] };

export function bookBusyOf(project: Project | null | undefined, signals: BusySignals = {}): BookBusy {
  if (!project) return IDLE;
  const ids = new Set<string>([...(signals.activeUnitIds ?? []), ...(signals.held ?? [])]);
  const items: BusyItem[] = [];
  if (signals.planRunning) items.push({ kind: "plan", id: "plan" });
  if (ids.size > 0) {
    const cast = new Map(namedCast(briefOf(project.config)).map((member) => [member.id, member.name.trim()]));
    const things = new Map((project.anchors ?? []).map((anchor) => [anchor.id, anchor.name]));
    const pages: BusyItem[] = [];
    const others: BusyItem[] = [];
    for (const id of ids) {
      if (id === COVER_FRONT_ID || id === COVER_BACK_ID) {
        pages.push({ kind: "cover", id });
        continue;
      }
      const page = pageNumberOf(project, id);
      if (page !== null) {
        pages.push({ kind: "page", id, page });
        continue;
      }
      const person = cast.get(id);
      if (person !== undefined) others.push({ kind: "person", id, name: person });
      else if (things.has(id)) others.push({ kind: "thing", id, name: things.get(id)! });
      // A unit the book no longer has (a page that was deleted mid-draw) is nothing to wait for.
    }
    pages.sort((a, b) => (a.kind === "cover" ? -1 : 0) - (b.kind === "cover" ? -1 : 0) || (a.page ?? 0) - (b.page ?? 0));
    items.push(...pages, ...others);
  }
  if (items.length === 0) return IDLE;
  return { busy: true, items, pages: items.filter((item) => item.kind === "page" || item.kind === "cover") };
}

/** Why the book cannot be printed yet, in plain English: "Still drawing page 3. You can order when it finishes." */
export function busyReason(busy: BookBusy): string {
  if (!busy.busy) return "";
  const names = busy.items.map((item) =>
    item.kind === "page"
      ? `page ${item.page}`
      : item.kind === "cover"
        ? item.id === COVER_BACK_ID
          ? "the back cover"
          : "the front cover"
        : item.kind === "plan"
          ? "the page plan"
          : (item.name ?? "a picture"),
  );
  const shown = names.length > 3 ? `${names.length} pictures` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]!;
  return `Still drawing ${shown}. You can order when it finishes.`;
}
