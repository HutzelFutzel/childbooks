/**
 * Browser-side likeness intake.
 *
 * The canvas pass gives instant, bandwidth-friendly uploads and strips EXIF
 * (including location) before bytes leave the device. The backend repeats the
 * validation and re-encoding; client processing is a speed optimization, never
 * the security boundary.
 */
import {
  LIKENESS_CONSENT_VERSION,
  type LikenessPhotoRef,
  type Project,
} from "../core/types";
import { backendFetch } from "./backend";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 1600;

function imageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo format could not be opened. Try JPEG, PNG or WebP."));
    };
    image.src = url;
  });
}

function canvasJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob> {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser could not prepare the photo.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, outWidth, outHeight);
  context.drawImage(source, 0, 0, outWidth, outHeight);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This photo could not be prepared."))),
      "image/jpeg",
      0.84,
    );
  });
}

/** Resize and strip all source metadata before upload. */
export async function prepareLikenessPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size > MAX_FILE_BYTES) {
    throw new Error("Choose a photo up to 15 MB.");
  }
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width < 200 || bitmap.height < 200) {
        bitmap.close();
        throw new Error("Choose a photo that is at least 200 × 200 pixels.");
      }
      const prepared = await canvasJpeg(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      return prepared;
    } catch (err) {
      if ((err as Error)?.message?.startsWith("Choose a photo")) throw err;
      // Safari/HEIC support varies; the image-element decoder is a useful
      // fallback and still passes through canvas before upload.
    }
  }
  const image = await imageElement(file);
  if (image.naturalWidth < 200 || image.naturalHeight < 200) {
    throw new Error("Choose a photo that is at least 200 × 200 pixels.");
  }
  return canvasJpeg(image, image.naturalWidth, image.naturalHeight);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("This photo could not be prepared."));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("This photo could not be read."));
    reader.readAsDataURL(blob);
  });
}

export async function uploadLikenessPhoto(args: {
  projectId: string;
  subjectId: string;
  file: File;
}): Promise<{ ref: LikenessPhotoRef; preview: Blob }> {
  const preview = await prepareLikenessPhoto(args.file);
  const res = await backendFetch("/likeness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base64: await blobToBase64(preview),
      mimeType: preview.type,
      projectId: args.projectId,
      subjectId: args.subjectId,
      consentVersion: LIKENESS_CONSENT_VERSION,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? "The photo could not be uploaded.");
  }
  return { ref: (await res.json()) as LikenessPhotoRef, preview };
}

function photoQuery(args: {
  projectId: string;
  subjectId: string;
  createdAt?: number;
}): string {
  const query = new URLSearchParams({
    projectId: args.projectId,
    subjectId: args.subjectId,
  });
  if (args.createdAt !== undefined) query.set("createdAt", String(args.createdAt));
  return query.toString();
}

export async function deleteLikenessPhoto(args: {
  projectId: string;
  subjectId: string;
  createdAt?: number;
}): Promise<void> {
  const res = await backendFetch(`/likeness?${photoQuery(args)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error("The photo could not be removed.");
  }
}

/** Add the analyzed anchor id to a backend-only photo binding. */
export async function bindLikenessPhoto(args: {
  projectId: string;
  fromSubjectId: string;
  toSubjectId: string;
  createdAt: number;
}): Promise<void> {
  const res = await backendFetch("/likeness/bind", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error("The photo could not be linked to this character.");
  }
}

/** Ensure queued/interactive workers can resolve photos without job-held ids. */
export async function bindProjectLikenessPhotos(
  project: Project,
  anchorIds: string[],
): Promise<void> {
  const wanted = new Set(anchorIds);
  const cast = project.config.storyBrief?.cast ?? [];
  await Promise.all(
    (project.anchors ?? []).flatMap((anchor) => {
      const photo = anchor.likenessPhoto;
      if (!wanted.has(anchor.id) || !photo) return [];
      const source = cast.find(
        (member) => member.likenessPhoto?.createdAt === photo.createdAt,
      );
      if (!source || source.id === anchor.id) return [];
      return [
        bindLikenessPhoto({
          projectId: project.id,
          fromSubjectId: source.id,
          toSubjectId: anchor.id,
          createdAt: photo.createdAt,
        }),
      ];
    }),
  );
}

/** Preview through the authenticated API; Storage remains server-only. */
export async function getLikenessPhotoBlob(args: {
  projectId: string;
  subjectId: string;
  createdAt: number;
}): Promise<Blob | null> {
  const res = await backendFetch(`/likeness?${photoQuery(args)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("The photo could not be loaded.");
  return res.blob();
}

export function likenessPhotoExpired(photo: LikenessPhotoRef | undefined): boolean {
  return Boolean(photo && photo.expiresAt <= Date.now());
}
