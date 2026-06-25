/**
 * Manual asset host — the safe default when no real host is configured.
 *
 * It cannot produce a fetchable URL on its own, so it fails loudly with an
 * actionable message rather than letting an order silently break later. Use it
 * as a placeholder until an object-store (or backend) host is configured.
 */
import { FulfillmentError } from "../errors";
import type { AssetHost } from "../types";

export function createManualAssetHost(): AssetHost {
  return {
    id: "manual",
    async upload(): Promise<never> {
      throw new FulfillmentError(
        "No asset host configured. Set up object-store uploads (or paste public file URLs) " +
          "before placing a print order — print providers fetch your files from a public URL.",
        { kind: "config" },
      );
    },
  };
}
