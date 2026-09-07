/**
 * Privacy-first, one-use likeness photo intake.
 *
 * Sources are server-normalized into a private JPEG, kept outside the durable
 * blob namespace, and deleted after the first successful character render. A
 * scheduled hard expiry catches abandoned stories and failed generations.
 */
import { randomUUID } from "node:crypto";
import express, { type Express, type Response } from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import sharp from "sharp";
import {
  LIKENESS_CONSENT_VERSION,
  type LikenessPhotoRef,
} from "../../books-frontend/src/core/types";
import { appCheckRejects } from "./appCheck";
import type { AuthedRequest } from "./auth";
import { blobBucket, ensureAdmin } from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_SOURCE_BYTES * 4) / 3) + 16;
const MAX_ACTIVE_PHOTOS = 12;
const MAX_DIMENSION = 1280;
const MAX_EXPIRED_PER_RUN = 500;
const PHOTO_ID_RE = /^[a-f0-9-]{36}$/;

interface LikenessPhotoDoc extends LikenessPhotoRef {
  projectId: string;
  /** Story-member id first; analyzed anchor id is bound before generation. */
  subjectIds?: string[];
  /** Read-only compatibility for photos uploaded before backend bindings. */
  subjectId?: string;
  mimeType: "image/jpeg";
  sizeBytes: number;
}

function likenessPath(uid: string, photoId: string): string {
  return `users/${uid}/likeness/${photoId}.jpg`;
}

function likenessDoc(uid: string, photoId: string) {
  return getFirestore().doc(`users/${uid}/likenessPhotos/${photoId}`);
}

/** Permanently remove a source and its expiry record. Safe to repeat. */
async function deleteLikenessPhotoById(uid: string, photoId: string): Promise<void> {
  if (!PHOTO_ID_RE.test(photoId)) return;
  ensureAdmin();
  await blobBucket().file(likenessPath(uid, photoId)).delete({ ignoreNotFound: true });
  await likenessDoc(uid, photoId).delete();
}

async function projectPhotos(
  uid: string,
  projectId: string,
): Promise<{ id: string; data: LikenessPhotoDoc }[]> {
  ensureAdmin();
  const snap = await getFirestore()
    .collection(`users/${uid}/likenessPhotos`)
    .where("projectId", "==", projectId)
    .limit(MAX_ACTIVE_PHOTOS + 10)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as LikenessPhotoDoc }));
}

async function photoForSubject(
  uid: string,
  projectId: string,
  subjectId: string,
  createdAt?: number,
): Promise<{ id: string; data: LikenessPhotoDoc } | null> {
  const photos = await projectPhotos(uid, projectId);
  return (
    photos
      .filter(
        (photo) =>
          [photo.data.subjectId, ...(photo.data.subjectIds ?? [])].includes(subjectId) &&
          (createdAt === undefined || photo.data.createdAt === createdAt),
      )
      .sort((a, b) => b.data.createdAt - a.data.createdAt)[0] ?? null
  );
}

/** Load an unexpired source for the character pipeline without exposing its id. */
export async function loadLikenessPhotoForSubject(
  uid: string,
  projectId: string,
  subjectId: string,
): Promise<{ base64: string; mimeType: string; createdAt: number } | null> {
  const record = await photoForSubject(uid, projectId, subjectId);
  if (!record) return null;
  const { data } = record;
  if (data.expiresAt <= Date.now()) {
    await deleteLikenessPhotoById(uid, record.id).catch(() => {});
    return null;
  }
  try {
    const [buf] = await blobBucket().file(likenessPath(uid, record.id)).download();
    return {
      base64: buf.toString("base64"),
      mimeType: "image/jpeg",
      createdAt: data.createdAt,
    };
  } catch {
    return null;
  }
}

/** Delete the exact source bound to a UI subject or consumed render. */
export async function deleteLikenessPhotoForSubject(
  uid: string,
  projectId: string,
  subjectId: string,
  createdAt?: number,
): Promise<void> {
  const record = await photoForSubject(uid, projectId, subjectId, createdAt);
  if (record) await deleteLikenessPhotoById(uid, record.id);
}

async function normalizePhoto(buf: Buffer): Promise<Buffer> {
  const input = sharp(buf, {
    animated: false,
    failOn: "error",
    limitInputPixels: 40_000_000,
  });
  const metadata = await input.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < 200 ||
    metadata.height < 200
  ) {
    throw new Error("Choose a photo that is at least 200 × 200 pixels.");
  }
  if (!["jpeg", "png", "webp", "heif"].includes(metadata.format ?? "")) {
    throw new Error("Choose a JPEG, PNG, WebP or HEIC photo.");
  }
  // rotate() honors EXIF orientation; JPEG re-encoding strips EXIF/location and
  // all other source metadata. No original bytes are written to Storage.
  return input
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3",
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
}

async function projectExists(uid: string, projectId: string): Promise<boolean> {
  const key = encodeURIComponent(`project:${projectId}`);
  return (await getFirestore().doc(`users/${uid}/store/${key}`).get()).exists;
}

async function enforceActiveLimit(
  uid: string,
  projectId: string,
  subjectId: string,
): Promise<string[]> {
  const photos = await projectPhotos(uid, projectId);
  const now = Date.now();
  const active: { id: string; data: LikenessPhotoDoc }[] = [];
  for (const photo of photos) {
    const { data } = photo;
    if (data.expiresAt <= now) {
      await deleteLikenessPhotoById(uid, photo.id).catch(() => {});
    } else {
      active.push(photo);
    }
  }
  const replacing = active.filter((item) =>
    [item.data.subjectId, ...(item.data.subjectIds ?? [])].includes(subjectId),
  );
  if (active.length >= MAX_ACTIVE_PHOTOS && replacing.length === 0) {
    throw new Error(
      "This book already has the maximum number of pending photos. Remove one or create the character first.",
    );
  }
  return replacing.map((item) => item.id);
}

export function registerLikenessRoutes(app: Express): void {
  const json = express.json({ limit: "18mb" });

  app.post("/likeness", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (await appCheckRejects(req, "likeness-upload")) {
        res.status(403).json({ error: { message: "This upload could not be verified." } });
        return;
      }
      const { base64, mimeType, projectId, subjectId, consentVersion } = (req.body ?? {}) as {
        base64?: string;
        mimeType?: string;
        projectId?: string;
        subjectId?: string;
        consentVersion?: string;
      };
      if (
        !base64 ||
        base64.length > MAX_BASE64_CHARS ||
        !mimeType ||
        !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mimeType)
      ) {
        res.status(400).json({ error: { message: "Choose a photo up to 12 MB." } });
        return;
      }
      if (
        !projectId ||
        projectId.length > 100 ||
        !subjectId ||
        subjectId.length > 100 ||
        consentVersion !== LIKENESS_CONSENT_VERSION
      ) {
        res.status(400).json({ error: { message: "The photo permission or subject is invalid." } });
        return;
      }
      const uid = req.uid!;
      if (!(await projectExists(uid, projectId))) {
        res.status(404).json({ error: { message: "This book could not be found." } });
        return;
      }
      const replacedPhotoIds = await enforceActiveLimit(uid, projectId, subjectId);

      const source = Buffer.from(base64, "base64");
      if (source.length === 0 || source.length > MAX_SOURCE_BYTES) {
        res.status(400).json({ error: { message: "Choose a photo up to 12 MB." } });
        return;
      }
      let normalized: Buffer;
      try {
        normalized = await normalizePhoto(source);
      } catch (err) {
        const message = (err as Error)?.message;
        res.status(400).json({
          error: {
            message: message?.startsWith("Choose a photo")
              ? message
              : "This photo could not be opened. Try JPEG, PNG, WebP or HEIC.",
          },
        });
        return;
      }
      const now = Date.now();
      const photoId = randomUUID();
      const ref: LikenessPhotoRef = {
        createdAt: now,
        expiresAt: now + DAY_MS,
        consentVersion: LIKENESS_CONSENT_VERSION,
      };
      const file = blobBucket().file(likenessPath(uid, photoId));
      try {
        await file.save(normalized, {
          contentType: "image/jpeg",
          resumable: false,
          metadata: {
            cacheControl: "private, max-age=60",
            metadata: {
              expiresAt: String(ref.expiresAt),
              purpose: "one-use-character-likeness",
            },
          },
        });
        await likenessDoc(uid, photoId).set({
          ...ref,
          projectId,
          subjectIds: [subjectId],
          mimeType: "image/jpeg",
          sizeBytes: normalized.length,
        } satisfies LikenessPhotoDoc);
        for (const oldId of replacedPhotoIds) {
          await deleteLikenessPhotoById(uid, oldId).catch(() => {});
        }
      } catch (err) {
        await file.delete({ ignoreNotFound: true }).catch(() => {});
        throw err;
      }
      res.status(201).json(ref);
    } catch (err) {
      const message = (err as Error)?.message || "The photo could not be prepared.";
      const clientError =
        message.startsWith("Choose a photo") ||
        message.startsWith("This book already");
      res.status(clientError ? 400 : 500).json({ error: { message } });
    }
  });

  app.get("/likeness", async (req: AuthedRequest, res: Response) => {
    try {
      const projectId = String(req.query.projectId ?? "");
      const subjectId = String(req.query.subjectId ?? "");
      const createdAt = Number(req.query.createdAt);
      if (!projectId || !subjectId || !Number.isFinite(createdAt)) {
        res.status(400).json({ error: { message: "The photo reference is invalid." } });
        return;
      }
      const photo = await loadLikenessPhotoForSubject(req.uid!, projectId, subjectId);
      if (!photo || photo.createdAt !== createdAt) {
        res.status(404).json({ error: { message: "This photo is no longer available." } });
        return;
      }
      res.set({
        "Cache-Control": "private, no-store",
        "Content-Type": photo.mimeType,
      });
      res.status(200).send(Buffer.from(photo.base64, "base64"));
    } catch {
      res.status(500).json({ error: { message: "The photo could not be loaded." } });
    }
  });

  app.post("/likeness/bind", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { projectId, fromSubjectId, toSubjectId, createdAt } = (req.body ?? {}) as {
        projectId?: string;
        fromSubjectId?: string;
        toSubjectId?: string;
        createdAt?: number;
      };
      if (
        !projectId ||
        !fromSubjectId ||
        !toSubjectId ||
        !Number.isFinite(createdAt) ||
        projectId.length > 100 ||
        fromSubjectId.length > 100 ||
        toSubjectId.length > 100
      ) {
        res.status(400).json({ error: { message: "The character binding is invalid." } });
        return;
      }
      const photo = await photoForSubject(
        req.uid!,
        projectId,
        fromSubjectId,
        createdAt,
      );
      if (!photo || photo.data.expiresAt <= Date.now()) {
        res.status(404).json({ error: { message: "This photo is no longer available." } });
        return;
      }
      await likenessDoc(req.uid!, photo.id).update({
        subjectIds: FieldValue.arrayUnion(toSubjectId),
      });
      res.status(204).end();
    } catch {
      res.status(500).json({ error: { message: "The photo could not be linked." } });
    }
  });

  app.delete("/likeness", async (req: AuthedRequest, res: Response) => {
    try {
      const projectId = String(req.query.projectId ?? "");
      const subjectId = String(req.query.subjectId ?? "");
      const createdAtRaw = req.query.createdAt;
      const createdAt =
        createdAtRaw === undefined ? undefined : Number(createdAtRaw);
      if (
        !projectId ||
        !subjectId ||
        (createdAt !== undefined && !Number.isFinite(createdAt))
      ) {
        res.status(400).json({ error: { message: "The photo reference is invalid." } });
        return;
      }
      await deleteLikenessPhotoForSubject(
        req.uid!,
        projectId,
        subjectId,
        createdAt,
      );
      res.status(204).end();
    } catch {
      res.status(500).json({ error: { message: "The photo could not be removed." } });
    }
  });
}

/** Hard expiry for abandoned stories and generation retries. */
export const cleanupExpiredLikenessPhotos = onSchedule(
  {
    schedule: "every 1 hours",
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    ensureAdmin();
    const snap = await getFirestore()
      .collectionGroup("likenessPhotos")
      .where("expiresAt", "<=", Date.now())
      .limit(MAX_EXPIRED_PER_RUN)
      .get();
    let deleted = 0;
    for (const doc of snap.docs) {
      const uid = doc.ref.parent.parent?.id;
      if (!uid) continue;
      try {
        await deleteLikenessPhotoById(uid, doc.id);
        deleted += 1;
      } catch (err) {
        logger.warn("likeness-cleanup: delete failed", {
          path: doc.ref.path,
          err: String(err),
        });
      }
    }
    if (deleted > 0) logger.info("likeness-cleanup: done", { deleted });
  },
);
