import { AlertTriangle, FlaskConical } from "lucide-react";
import { isDev } from "../../platform/runtime";
import { useEmulators } from "../../lib/firebase";
import { cn } from "../lib/cn";

/**
 * Height of {@link DevEnvironmentBanner}, shared with the chrome that has to
 * make room for it (marketing `Nav`'s fixed offset, the Studio/Admin shells'
 * `h-screen` sizing) so it sits ABOVE the navbar — pushing it down — rather
 * than overlaying/covering part of it. Keep in sync with the banner's `h-6`.
 */
export const DEV_BANNER_HEIGHT_REM = 1.5;

/**
 * An unmissable strip at the very top of the page — genuinely above every
 * navbar in the app (marketing `Nav`, Studio/Admin `TopBar`), not overlapping
 * it — whenever this build is NOT production. Two states, on purpose:
 *   - amber "local emulators": the safe, expected dev setup (Auth/Firestore/
 *     Storage emulators — nothing here can touch real data).
 *   - red "LIVE Firebase project": a dev build talking directly to the real
 *     Firebase project (emulators off). This is the dangerous mismatch —
 *     dev-brain, prod-data — that's easy to fall into (e.g. `next start`
 *     locally with `.env.production`) and easy to miss without this.
 *
 * A plain in-flow block (NOT `sticky`) — `html, body { height: 100% }`
 * (globals.css) pins `<body>`'s own box to exactly one viewport tall, which
 * makes `position: sticky` on a direct body child stop tracking scroll the
 * moment the page has scrolled past that first viewport (its "containing
 * block" has already scrolled out of view). On any page taller than one
 * screen — most marketing pages — that made the banner vanish mid-scroll
 * while `Nav` stayed parked in the `top-6` slot it left behind, opening a
 * visible gap at the top of the screen.
 *
 * So instead this scrolls away naturally with the page (same as everything
 * else here), and `Nav` tracks that: it starts at `top-6`, under the banner,
 * then slides up to `top-0` once scrolled past `DEV_BANNER_HEIGHT_REM` of
 * scroll — see `ui/marketing/Nav`. Renders nothing at all in production
 * builds. No hooks/browser APIs are needed (`isDev`/`useEmulators` just read
 * inlined `NEXT_PUBLIC_*`/`NODE_ENV` values), so this can render as a plain
 * server component.
 */
export function DevEnvironmentBanner() {
  if (!isDev()) return null;
  const emulated = useEmulators();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "childbook-60f89";

  return (
    <div
      role="status"
      className={cn(
        "flex h-6 shrink-0 items-center justify-center gap-1.5",
        "text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm",
        emulated ? "bg-amber-600" : "bg-red-600",
      )}
    >
      {emulated ? <FlaskConical className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
      {emulated ? "Development — local emulators" : `Development — LIVE Firebase project (${projectId})`}
    </div>
  );
}
