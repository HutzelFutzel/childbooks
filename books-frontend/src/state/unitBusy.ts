/**
 * Whether something else already owns a picture's redraw.
 *
 * A picture is "out of date" from the moment a change is saved until the new one
 * lands, which is much longer than the moment the reader needs a "Redraw"
 * button. Every surface that would offer its own redraw for a stale picture asks
 * here first, so one change is never answered by two buttons (or by a button
 * beside a redraw that is already running):
 *
 * - a live job is drawing it, or it was just started and its task hasn't arrived;
 * - the chat is about to offer or start its redraw (`redrawHold`), or a start is
 *   deciding right now;
 * - the chat is already showing its priced redraw card for it.
 *
 * When none of these holds and the picture is still stale, the redraw never
 * started (the cap, too few Sparks, a failure) and the button is the way forward.
 */
import { useChatStudio } from "./chatStudio";
import { useJobsStore } from "./jobsStore";
import { usePortraitStartStore } from "./portraitAutoStart";
import { useRedrawHold } from "./redrawHold";

export function useRedrawOwned(unitId: string): boolean {
  const active = useJobsStore((s) => s.activeUnitIds.has(unitId));
  const started = usePortraitStartStore((s) => unitId in s.started);
  const deciding = usePortraitStartStore((s) => s.deciding > 0);
  const held = useRedrawHold((s) => s.units.includes(unitId));
  const offered = useChatStudio((s) => {
    const target = s.redraw?.target;
    if (!target) return false;
    return target.kind === "person" ? target.castId === unitId : target.unitId === unitId;
  });
  return active || started || deciding || held || offered;
}
