import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

/**
 * On-demand ISR revalidation, called best-effort by the backend after a blog
 * save/delete so published edits appear immediately (time-based ISR is the
 * fallback). Guarded by a shared secret; no-ops safely if unconfigured.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || req.headers.get("x-revalidate-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let paths: string[] = [];
  try {
    const body = (await req.json()) as { paths?: unknown };
    if (Array.isArray(body.paths)) {
      paths = body.paths.filter((p): p is string => typeof p === "string");
    }
  } catch {
    // ignore malformed body
  }
  for (const path of paths) revalidatePath(path);
  return NextResponse.json({ revalidated: true, paths });
}
