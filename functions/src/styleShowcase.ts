/**
 * Covers drawn in a look, kept so the look can be shown with the reader's own
 * pictures when it has no curated example.
 *
 *   users/{uid}/styleShowcase/{styleKey}
 *
 * `styleKey` is a custom style id or an admin preset id. Each entry is a small
 * COPY of the cover, owned by the look (`styleasset-` blob), so deleting the
 * book does not take its preview with it. Only the reader's own covers are ever
 * filed here, and the document sits under their own account: nothing is shared.
 */
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import sharp from "sharp";
import { downloadBlob, ensureAdmin, uploadBlobAs } from "./storage";
import { sha256Hex } from "./customStyles";
import {
  SHOWCASE_COVERS_STORED,
  styleAssetBlobId,
  type StyleCoverExample,
  type StyleShowcase,
} from "../../books-frontend/src/core/config/customArtStyles";
import type { ArtStyleSelection } from "../../books-frontend/src/core/types";

/** Longest side of a stored preview. They are shown at card size, never printed. */
const PREVIEW_MAX_PX = 768;

function showcasePath(uid: string, key: string): string {
  return `users/${uid}/styleShowcase/${key}`;
}

/** The key a look's covers are filed under, or null for a look with no stable identity. */
export function showcaseKeyOf(style: ArtStyleSelection | undefined): string | null {
  if (!style) return null;
  if (style.customStyle) return style.customStyle.id;
  return style.presetId ?? null;
}

/**
 * File a finished front cover under its look. The first covers stay: a book's
 * cover is added once, until the look holds {@link SHOWCASE_COVERS_STORED}.
 * Never throws; a missing preview is a cosmetic loss.
 */
export async function captureStyleCover(
  uid: string,
  args: { style: ArtStyleSelection | undefined; projectId: string; blobId: string },
): Promise<void> {
  try {
    const key = showcaseKeyOf(args.style);
    if (!key || !args.projectId) return;
    ensureAdmin();
    const ref = getFirestore().doc(showcasePath(uid, key));
    const before = await ref.get();
    const existing = before.exists ? (before.data() as StyleShowcase).covers ?? [] : [];
    if (existing.length >= SHOWCASE_COVERS_STORED) return;
    if (existing.some((cover) => cover.projectId === args.projectId)) return;

    const source = await downloadBlob(uid, args.blobId);
    const preview = await sharp(source)
      .rotate()
      .resize({ width: PREVIEW_MAX_PX, height: PREVIEW_MAX_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const info = await sharp(preview).metadata();
    const blobId = styleAssetBlobId(key, "cover", sha256Hex(args.projectId).slice(0, 12));
    await uploadBlobAs(uid, blobId, preview, "image/webp");

    const now = Date.now();
    const cover: StyleCoverExample = {
      projectId: args.projectId,
      sourceBlobId: args.blobId,
      image: {
        blobId,
        mimeType: "image/webp",
        sha256: sha256Hex(preview),
        ...(info.width ? { width: info.width } : {}),
        ...(info.height ? { height: info.height } : {}),
        createdAt: now,
      },
      ...(args.style?.customStyle ? { styleRevision: args.style.customStyle.revision } : {}),
      capturedAt: now,
    };
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const covers = snap.exists ? ((snap.data() as StyleShowcase).covers ?? []) : [];
      if (covers.length >= SHOWCASE_COVERS_STORED || covers.some((c) => c.projectId === args.projectId)) return;
      const showcase: StyleShowcase = { key, covers: [...covers, cover], updatedAt: now };
      tx.set(ref, showcase);
    });
  } catch (error) {
    logger.warn("[styles] could not file a cover under its look", { error: String(error) });
  }
}

/** The blob ids a showcase's copies live in, for removing them with the style. */
export async function showcaseBlobIds(uid: string, key: string): Promise<string[]> {
  ensureAdmin();
  const snap = await getFirestore().doc(showcasePath(uid, key)).get();
  if (!snap.exists) return [];
  return ((snap.data() as StyleShowcase).covers ?? []).map((cover) => cover.image.blobId);
}

export async function deleteShowcase(uid: string, key: string): Promise<void> {
  ensureAdmin();
  await getFirestore().doc(showcasePath(uid, key)).delete();
}
