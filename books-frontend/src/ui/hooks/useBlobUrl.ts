import { useEffect, useState } from "react";
import { getBlobUrl } from "../../state/blobs";

/**
 * How a blob resolved. Tiles need this to tell "still fetching" apart from
 * "there is nothing to fetch" and "the fetch failed" — collapsing those into a
 * null URL is what turns a bucket misconfiguration (CORS, rules) into an
 * infinite shimmer instead of a visible problem.
 */
export type BlobStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface BlobUrlState {
  url: string | null;
  status: BlobStatus;
}

/** Resolve a stored blob id into an object URL plus its load status. */
export function useBlobUrlState(blobId: string | undefined): BlobUrlState {
  const [state, setState] = useState<BlobUrlState>({ url: null, status: "idle" });

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    if (!blobId) {
      setState({ url: null, status: "idle" });
      return;
    }
    setState({ url: null, status: "loading" });
    void getBlobUrl(blobId)
      .then((u) => {
        if (!active) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
        created = u;
        // A null here means the object genuinely isn't in the bucket; the store
        // throws for every other failure.
        setState({ url: u, status: u ? "ready" : "missing" });
      })
      .catch((err) => {
        // A rejection here (e.g. a CORS/permission failure fetching the blob)
        // would otherwise be swallowed, leaving the thumbnail silently empty.
        console.error(`useBlobUrl: failed to load blob ${blobId}`, err);
        if (active) setState({ url: null, status: "error" });
      });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [blobId]);

  return state;
}

/** Object URL for a stored blob, or null while loading/missing/failed. */
export function useBlobUrl(blobId: string | undefined): string | null {
  return useBlobUrlState(blobId).url;
}
