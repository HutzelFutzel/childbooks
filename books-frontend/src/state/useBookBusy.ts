/** The live "is the book being drawn" answer for the open book: see `core/guide/bookBusy`. */
import { useMemo } from "react";
import { bookBusyOf, type BookBusy } from "../core/guide/bookBusy";
import type { Project } from "../core/types";
import { useJobsStore } from "./jobsStore";
import { usePortraitStartStore } from "./portraitAutoStart";
import { useRedrawHold } from "./redrawHold";

export function useBookBusy(project: Project | null | undefined): BookBusy {
  const active = useJobsStore((s) => s.activeUnitIds);
  const planning = useJobsStore((s) => s.screenplayJob?.status === "pending" || s.screenplayJob?.status === "running");
  const started = usePortraitStartStore((s) => s.started);
  const held = useRedrawHold((s) => s.units);
  return useMemo(() => {
    const ids = new Set([...active, ...Object.keys(started)]);
    return bookBusyOf(project, { activeUnitIds: ids, planRunning: planning, held });
  }, [project, active, planning, started, held]);
}
