import { useEffect, useState } from "react";
import { getBlobUrl } from "../../state/blobs";

/** Resolve a stored blob id into an object URL, revoking it on cleanup. */
export function useBlobUrl(blobId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    setUrl(null);
    if (blobId) {
      void getBlobUrl(blobId).then((u) => {
        if (active) {
          created = u;
          setUrl(u);
        } else if (u) {
          URL.revokeObjectURL(u);
        }
      });
    }
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [blobId]);

  return url;
}
