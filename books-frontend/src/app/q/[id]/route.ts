/**
 * Public QR scan hop: `{site}/q/{id}` → the code's current destination.
 *
 * Tracked codes encode this path, not the destination. The Cloud Function at
 * `GET /q/:id` is what counts the scan and attaches `?qr=`. This handler exists
 * so that URL is served on the marketing origin (App Hosting has no rewrite to
 * Functions); without it a printed code 404s on Next and never reaches the
 * destination or the coupon token.
 */
import { NextResponse } from "next/server";
import { backendBase, backendUrl } from "@/platform/backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const home = new URL("/", req.url);
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.redirect(home, 302);
    const upstream = await fetch(backendUrl(`/q/${encodeURIComponent(id)}`), {
      redirect: "manual",
      cache: "no-store",
    });
    const location = upstream.headers.get("location");
    if (!location) return NextResponse.redirect(home, 302);
    return NextResponse.redirect(siteBoundLocation(location, req.url), 302);
  } catch {
    // Same fallback as the function: a dead hop lands on the homepage, not a 404.
    return NextResponse.redirect(home, 302);
  }
}

/**
 * Resolve the function's Location against the site origin.
 *
 * Relative paths (`/studio?qr=x`) are fine. Absolute URLs to our own site or
 * an off-site destination pass through. A Location that points at the Functions
 * host itself — Express sometimes absolutizes `/` against the incoming request —
 * is rewritten onto this origin so a fallback never dumps a scanner on
 * `cloudfunctions.net`.
 */
function siteBoundLocation(location: string, requestUrl: string): URL {
  const target = new URL(location, requestUrl);
  try {
    const backend = new URL(backendBase());
    if (target.host === backend.host) {
      return new URL(`${target.pathname}${target.search}${target.hash}`, new URL(requestUrl).origin);
    }
  } catch {
    /* keep the resolved target */
  }
  return target;
}
