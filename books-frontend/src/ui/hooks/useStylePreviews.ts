"use client";

/**
 * The pictures a look is shown with.
 *
 * An admin's curated examples always come first. A look without any (a custom
 * look, or a preset nobody has photographed) shows the reader's OWN first covers
 * drawn in it, then a neutral sample portrait for a saved custom look. Covers
 * are never shared between readers: they come from the reader's own account.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../../state/authStore";
import { useCustomStylesStore } from "../../state/customStylesStore";
import { getBlobUrl } from "../../state/blobs";
import {
  resolveStylePreviewStrip,
  SHOWCASE_COVERS_SHOWN,
  type StylePreview,
} from "../../core/config/customArtStyles";

/** Keep the saved-style and cover listeners alive while the caller is on screen. */
export function useStylePreviewData(): void {
  const uid = useAuthStore((state) => state.user?.uid);
  useEffect(() => {
    if (!uid) return;
    return useCustomStylesStore.getState().retain(uid);
  }, [uid]);
}

/**
 * Previews for one look. `key` is a preset id or a custom style id (the same
 * key the cover showcase is filed under).
 */
export function useStyleStrip(args: {
  key: string | null | undefined;
  adminExamples?: readonly { imageUrl: string }[];
  limit?: number;
}): StylePreview[] {
  useStylePreviewData();
  const showcase = useCustomStylesStore((state) => (args.key ? state.showcase[args.key] : undefined));
  const portraitReference = useCustomStylesStore((state) =>
    args.key ? state.styles[args.key]?.portraitReference : undefined,
  );
  const { adminExamples, limit } = args;
  return useMemo(
    () =>
      resolveStylePreviewStrip({
        adminExamples,
        showcase,
        portraitReference,
        limit: limit ?? SHOWCASE_COVERS_SHOWN,
      }),
    [adminExamples, showcase, portraitReference, limit],
  );
}

/** Turn a strip into displayable URLs: public ones as they are, blobs as object URLs. */
export function useStylePreviewUrls(strip: readonly StylePreview[]): string[] {
  const blobKey = strip.map((preview) => preview.blobId ?? "").join(",");
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = [...new Set(blobKey.split(",").filter(Boolean))];
    if (ids.length === 0) {
      setBlobUrls({});
      return;
    }
    let active = true;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const id of ids) {
        const url = await getBlobUrl(id).catch(() => null);
        if (!url) continue;
        if (!active) {
          URL.revokeObjectURL(url);
          continue;
        }
        created.push(url);
        next[id] = url;
      }
      if (active) setBlobUrls(next);
    })();
    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [blobKey]);

  return useMemo(
    () =>
      strip
        .map((preview) => preview.url ?? (preview.blobId ? blobUrls[preview.blobId] : undefined))
        .filter((url): url is string => Boolean(url)),
    [strip, blobUrls],
  );
}
