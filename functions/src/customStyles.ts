/**
 * Custom art styles: a look read from a reader's own drawings, saved once per
 * account so any book (now or later) can point at it.
 *
 *   users/{uid}/artStyles/{styleId}                  the style
 *   users/{uid}/artStyles/{styleId}/revisions/{n}    immutable wording + pictures
 *
 * Identity is the drawings, not the words a vision model gave them: the id is
 * a digest of the sorted sha256 of every drawing that defined the look, so
 * reading the same drawings again finds the saved style (and skips the model
 * call) instead of storing a second copy. Pictures the style owns are copied
 * into the reader's blob space under the reserved `styleasset-` prefix, which
 * no project clean-up may remove.
 *
 * Only the backend writes these documents (Firestore rules deny client
 * writes); the owner may read them.
 */
import { createHash } from "node:crypto";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { logger } from "firebase-functions/v2";
import sharp from "sharp";
import { ensureAdmin, uploadBlobAs } from "./storage";
import {
  customStyleIdFor,
  isCustomStyleId,
  styleAssetBlobId,
  styleFingerprintInput,
  type CustomArtStyle,
  type CustomArtStyleRevision,
  type CustomStyleRef,
  type StyleExtractionRecord,
  type StyleReferenceImage,
} from "../../books-frontend/src/core/config/customArtStyles";
import { clampDerivedStylePrompt } from "../../books-frontend/src/core/book/sourceArt";
import { SOURCE_ART_MAX, type Project, type SourceArtRef } from "../../books-frontend/src/core/types";

/** Bumped when the style-extraction prompt changes enough to matter when comparing runs. */
export const STYLE_EXTRACTION_PROMPT_VERSION = "1";

/** Books a style remembers, newest last. */
const PROJECT_IDS_MAX = 50;
/** An unused candidate (the reader never drew with it) is removed after this long. */
export const CANDIDATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A style already marked used for a book is not rewritten more often than this. */
const USE_TOUCH_MS = 60 * 60 * 1000;

function db() {
  ensureAdmin();
  return getFirestore();
}

export function stylesPath(uid: string): string {
  return `users/${uid}/artStyles`;
}

function styleRef(uid: string, styleId: string): DocumentReference {
  return db().doc(`${stylesPath(uid)}/${styleId}`);
}

function revisionRef(uid: string, styleId: string, revision: number): DocumentReference {
  return db().doc(`${stylesPath(uid)}/${styleId}/revisions/${revision}`);
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A drawing loaded from the reader's blob space, with the hash that gives it identity. */
export interface LoadedDrawing {
  blobId: string;
  mimeType: string;
  base64: string;
  sha256: string;
  createdAt: number;
}

export function hashDrawing(base64: string): string {
  return sha256Hex(Buffer.from(base64, "base64"));
}

/** The drawings a style keeps: the one that sets the look first, then the rest by age. */
export function orderDrawings(drawings: readonly LoadedDrawing[], firstBlobId?: string): LoadedDrawing[] {
  const seen = new Set<string>();
  const unique = drawings.filter((drawing) => !seen.has(drawing.sha256) && seen.add(drawing.sha256));
  const sorted = unique.slice().sort((a, b) => a.createdAt - b.createdAt);
  const first = sorted.find((drawing) => drawing.blobId === firstBlobId) ?? sorted[0];
  return first ? [first, ...sorted.filter((drawing) => drawing !== first)].slice(0, SOURCE_ART_MAX) : [];
}

/** The style a set of drawings stands for. Stable across runs, orders and repeats. */
export function styleIdForHashes(hashes: readonly string[]): string {
  return customStyleIdFor(sha256Hex(styleFingerprintInput(hashes)));
}

export interface StoredCustomStyle {
  style: CustomArtStyle;
  revision: CustomArtStyleRevision;
}

export function refOf(stored: StoredCustomStyle): CustomStyleRef {
  return { id: stored.style.id, revision: stored.revision.revision };
}

/** A saved style by pointer, or null when it (or that revision) does not exist. */
export async function loadCustomStyle(uid: string, ref: CustomStyleRef): Promise<StoredCustomStyle | null> {
  if (!isCustomStyleId(ref.id)) return null;
  const [style, revision] = await Promise.all([
    styleRef(uid, ref.id).get(),
    revisionRef(uid, ref.id, ref.revision).get(),
  ]);
  if (!style.exists || !revision.exists) return null;
  return { style: style.data() as CustomArtStyle, revision: revision.data() as CustomArtStyleRevision };
}

/** The saved style these drawings define, at its current revision. */
export async function findCustomStyle(uid: string, hashes: readonly string[]): Promise<StoredCustomStyle | null> {
  if (hashes.length === 0) return null;
  const id = styleIdForHashes(hashes);
  const snap = await styleRef(uid, id).get();
  if (!snap.exists) return null;
  const style = snap.data() as CustomArtStyle;
  const revision = await revisionRef(uid, id, style.currentRevision).get();
  if (!revision.exists) return null;
  return { style, revision: revision.data() as CustomArtStyleRevision };
}

async function dimensionsOf(buf: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const meta = await sharp(buf).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return {};
  }
}

/** Copy bytes into the style's own blob and describe the copy. */
export async function storeStyleAsset(args: {
  uid: string;
  styleId: string;
  kind: string;
  suffix: string | number;
  bytes: Buffer;
  mimeType: string;
}): Promise<StyleReferenceImage> {
  const blobId = styleAssetBlobId(args.styleId, args.kind, args.suffix);
  await uploadBlobAs(args.uid, blobId, args.bytes, args.mimeType);
  return {
    blobId,
    mimeType: args.mimeType,
    sha256: sha256Hex(args.bytes),
    ...(await dimensionsOf(args.bytes)),
    createdAt: Date.now(),
  };
}

function labelFor(names: readonly string[]): string {
  const list = names.map((name) => name.trim()).filter(Boolean);
  if (list.length === 0) return "Your artwork";
  if (list.length === 1) return `${list[0]}’s drawing`;
  return `${list.slice(0, 2).join(" & ")}’s drawings`;
}

export interface SaveCustomStyleArgs {
  uid: string;
  /** sha256 of EVERY drawing that was read to make this look. */
  hashes: readonly string[];
  /** The drawings to keep, the one that sets the look first. */
  drawings: readonly LoadedDrawing[];
  promptDescription: string;
  derivedFromNames: readonly string[];
  projectId: string;
  extraction: Pick<StyleExtractionRecord, "model"> & { promptVersion?: string };
}

/**
 * Save the look, or return the one already saved for these drawings. Safe to
 * call twice at once: pictures are stored under ids derived from the style, and
 * the documents are written in a transaction that only creates what is missing.
 */
export async function saveCustomStyle(args: SaveCustomStyleArgs): Promise<StoredCustomStyle & { created: boolean }> {
  const { uid } = args;
  const id = styleIdForHashes(args.hashes);
  const existing = await findCustomStyle(uid, args.hashes);
  if (existing) return { ...existing, created: false };

  const now = Date.now();
  const revisionNumber = 1;
  const sourceArt: StyleReferenceImage[] = [];
  for (const [index, drawing] of args.drawings.slice(0, SOURCE_ART_MAX).entries()) {
    sourceArt.push(
      await storeStyleAsset({
        uid,
        styleId: id,
        kind: "src",
        suffix: `${revisionNumber}-${index}`,
        bytes: Buffer.from(drawing.base64, "base64"),
        mimeType: drawing.mimeType,
      }),
    );
  }
  const names = [...new Set(args.derivedFromNames.map((name) => name.trim()).filter(Boolean))].slice(0, 8);
  const revision: CustomArtStyleRevision = {
    revision: revisionNumber,
    promptDescription: clampDerivedStylePrompt(args.promptDescription),
    sourceArt,
    sourceArtHashes: [...new Set(args.hashes.map((hash) => hash.toLowerCase()))].sort(),
    derivedFromNames: names,
    extraction: {
      model: args.extraction.model,
      promptVersion: args.extraction.promptVersion ?? STYLE_EXTRACTION_PROMPT_VERSION,
      at: now,
    },
    generationHints: {},
    createdAt: now,
  };
  const style: CustomArtStyle = {
    id,
    uid,
    origin: "derived",
    status: "candidate",
    fingerprint: sha256Hex(styleFingerprintInput(args.hashes)),
    label: labelFor(names),
    currentRevision: revisionNumber,
    createdFromProjectId: args.projectId,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    projectIds: [],
  };

  const result = await db().runTransaction(async (tx) => {
    const [styleSnap, revisionSnap] = await Promise.all([
      tx.get(styleRef(uid, id)),
      tx.get(revisionRef(uid, id, revisionNumber)),
    ]);
    const current = styleSnap.exists ? (styleSnap.data() as CustomArtStyle) : style;
    if (!styleSnap.exists) tx.set(styleRef(uid, id), style);
    else if (current.status === "archived") {
      tx.update(styleRef(uid, id), { status: "candidate", updatedAt: now });
      current.status = "candidate";
    }
    const currentRevision = revisionSnap.exists ? (revisionSnap.data() as CustomArtStyleRevision) : revision;
    if (!revisionSnap.exists) tx.set(revisionRef(uid, id, revisionNumber), revision);
    return { style: current, revision: currentRevision, created: !styleSnap.exists };
  });
  return result;
}

/** How long a started sample-portrait job may go unfinished before another is queued. */
const SAMPLE_RETRY_MS = 15 * 60 * 1000;

/** The Cloud Tasks queue behind `runStyleReference` (see styleReference.ts); a queue is named after its function. */
export const STYLE_REFERENCE_QUEUE = "runStyleReference";

/**
 * Record that a book draws in this style: a candidate becomes active, and the
 * book joins the style's list. The first real use also asks for the style's
 * neutral sample portrait (once). Cheap when nothing changed.
 */
export async function markStyleUsed(uid: string, ref: CustomStyleRef, projectId: string | undefined): Promise<void> {
  let queueSample = false;
  try {
    const doc = styleRef(uid, ref.id);
    await db().runTransaction(async (tx) => {
      queueSample = false;
      const snap = await tx.get(doc);
      if (!snap.exists) return;
      const style = snap.data() as CustomArtStyle;
      const now = Date.now();
      const known = !projectId || style.projectIds.includes(projectId);
      const needsSample =
        !style.portraitReference &&
        (!style.portraitReferenceStartedAt || now - style.portraitReferenceStartedAt > SAMPLE_RETRY_MS);
      if (style.status === "active" && known && !needsSample && now - style.lastUsedAt < USE_TOUCH_MS) return;
      const projectIds =
        projectId && !style.projectIds.includes(projectId)
          ? [...style.projectIds, projectId].slice(-PROJECT_IDS_MAX)
          : style.projectIds;
      tx.update(doc, {
        status: "active",
        lastUsedAt: now,
        updatedAt: now,
        projectIds,
        ...(needsSample ? { portraitReferenceStartedAt: now } : {}),
      });
      queueSample = needsSample;
    });
  } catch (error) {
    logger.warn("[styles] could not record a style's use", { styleId: ref.id, error: String(error) });
    return;
  }
  if (!queueSample) return;
  try {
    await getFunctions().taskQueue(STYLE_REFERENCE_QUEUE).enqueue({ uid, styleId: ref.id, revision: ref.revision });
  } catch (error) {
    // The mark stays; the next use after SAMPLE_RETRY_MS asks again.
    logger.warn("[styles] could not queue the sample portrait", { styleId: ref.id, error: String(error) });
  }
}

/**
 * Make a book's art style say what the saved style says. The wording and the
 * look's pictures come from the record, never from what the client sent next to
 * the pointer. A pointer to a style that does not exist is dropped, leaving the
 * book's own description and drawings to carry the look.
 *
 * Mutates `project` (a request body or a job snapshot nobody else holds).
 */
export async function applyCustomStyleToProject(
  uid: string,
  project: Project | undefined,
): Promise<StoredCustomStyle | null> {
  const style = project?.config?.artStyle;
  const pointer = style?.customStyle;
  if (!project || !style || !pointer) return null;
  // A failed read throws: dropping the look because Firestore hiccuped would
  // draw the book in a different style without anyone knowing.
  const stored = await loadCustomStyle(uid, pointer);
  if (!stored) {
    // A pointer to nothing (never saved, or removed) is not a style: forget it,
    // and let the book's own wording and drawing carry the look.
    const { customStyle: _gone, ...rest } = style;
    void _gone;
    project.config.artStyle = rest;
    return null;
  }
  const art: SourceArtRef[] = style.referenceArt?.length
    ? style.referenceArt
    : stored.revision.sourceArt.slice(0, 1).map((image) => ({
        blobId: image.blobId,
        mimeType: image.mimeType,
        createdAt: image.createdAt,
      }));
  project.config.artStyle = {
    ...style,
    presetId: null,
    origin: "derived",
    customDescription: clampDerivedStylePrompt(stored.revision.promptDescription),
    ...(stored.revision.derivedFromNames.length > 0
      ? { derivedFromNames: stored.revision.derivedFromNames }
      : {}),
    referenceArt: art,
    customStyle: refOf(stored),
  };
  await markStyleUsed(uid, pointer, project.id);
  return stored;
}
