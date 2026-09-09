/**
 * Browser-side character-artwork intake.
 *
 * Drawings live in the regular project blob store (not the likeness lane):
 * they are the author's illustrations, not a child's photograph, and they
 * stay available after the first sheet is generated.
 */
import { SOURCE_ART_MAX, type SourceArtRef } from "../core/types";
import { putBlob } from "../state/blobs";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 1600;

function isPictureFile(file: File): boolean {
  if (file.size > MAX_FILE_BYTES) return false;
  if (file.type.toLowerCase().startsWith("image/")) return true;
  return /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name);
}

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
      reject(new Error("This picture format could not be opened. Try JPEG, PNG or WebP."));
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
  if (!context) throw new Error("This browser could not prepare the picture.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, outWidth, outHeight);
  context.drawImage(source, 0, 0, outWidth, outHeight);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This picture could not be prepared."))),
      "image/jpeg",
      0.88,
    );
  });
}

async function prepareSourceArt(file: File): Promise<Blob> {
  if (!isPictureFile(file)) {
    throw new Error("Choose a picture up to 15 MB.");
  }
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width < 200 || bitmap.height < 200) {
        bitmap.close();
        throw new Error("Choose a picture that is at least 200 × 200 pixels.");
      }
      const prepared = await canvasJpeg(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      return prepared;
    } catch (err) {
      if ((err as Error)?.message?.startsWith("Choose a picture")) throw err;
    }
  }
  const image = await imageElement(file);
  if (image.naturalWidth < 200 || image.naturalHeight < 200) {
    throw new Error("Choose a picture that is at least 200 × 200 pixels.");
  }
  return canvasJpeg(image, image.naturalWidth, image.naturalHeight);
}

export async function uploadSourceArt(file: File): Promise<{ ref: SourceArtRef; preview: Blob }> {
  const preview = await prepareSourceArt(file);
  const blobId = await putBlob(preview);
  return {
    ref: {
      blobId,
      mimeType: preview.type || "image/jpeg",
      createdAt: Date.now(),
    },
    preview,
  };
}

export function canAddSourceArt(current: SourceArtRef[] | undefined): boolean {
  return (current?.length ?? 0) < SOURCE_ART_MAX;
}
