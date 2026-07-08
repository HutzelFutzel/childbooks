/**
 * Editor element-type registry.
 *
 * The edit phase is intentionally lean for the MVP: the only element a user can
 * add is a **text box** (with size + color styling). This registry is the seam
 * that keeps it *extensible* — adding a new element type later (sticker, shape,
 * image, …) is a matter of registering another entry here and handling its
 * `dragItem` payload in the canvas drop logic, with no changes to the palette
 * UI itself.
 */
import { Type, type LucideIcon } from "lucide-react";
import type { DragItem } from "../studio/StudioDnd";

/** The subset of studio actions an element type needs to add itself to a page. */
export interface ElementAddApi {
  addBox: (pageId: string) => void;
}

export interface EditorElementType {
  id: string;
  label: string;
  /** One-line hint shown under the palette. */
  hint?: string;
  icon: LucideIcon;
  /** Payload used when dragging this element from the palette onto a page. */
  dragItem: () => DragItem;
  /** Add this element to the given page via the studio API (click-to-add). */
  add: (api: ElementAddApi, pageId: string) => void;
}

export const EDITOR_ELEMENT_TYPES: EditorElementType[] = [
  {
    id: "text",
    label: "Text box",
    hint: "Click to add to this page, or drag onto any page.",
    icon: Type,
    dragItem: () => ({ type: "text", label: "Text" }),
    add: (api, pageId) => api.addBox(pageId),
  },
];
