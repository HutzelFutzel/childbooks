/**
 * Invariants for saved custom art styles: identity, keys, previews and the
 * record kept on every generated picture.
 *
 * Offline and deterministic: pure functions only. What needs Firestore or the
 * image provider (saving a style, the sample portrait) is covered where it
 * runs; here we hold the rules those rely on.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { derivedStyleSelection } from "../books-frontend/src/core/book/sourceArt";
import {
  customStyleIdFor,
  customStyleKeyOf,
  isCustomStyleId,
  isStyleAssetBlobId,
  parseCustomStyleRef,
  resolveStylePreview,
  resolveStylePreviewStrip,
  showcaseCoversOf,
  styleAssetBlobId,
  styleFingerprintInput,
  type StyleCoverExample,
  type StyleShowcase,
} from "../books-frontend/src/core/config/customArtStyles";
import { splitBillableUsage } from "../books-frontend/src/core/billing/usageBilling";
import { normalizeStudioAuthoringState } from "../books-frontend/src/core/guide/projectState";
import { buildRenderRecord } from "../books-frontend/src/core/pipeline/imageProvenance";
import { artStyleKey, styleStampOf } from "../books-frontend/src/core/prompts/style";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

// --- Identity: the drawings, nothing else ---------------------------------

const a = digest("drawing-a");
const b = digest("drawing-b");
assert.equal(
  styleFingerprintInput([a, b]),
  styleFingerprintInput([b, a, a, b.toUpperCase()]),
  "The same drawings in another order, repeated or in capitals are a different style.",
);
assert.notEqual(
  styleFingerprintInput([a]),
  styleFingerprintInput([a, b]),
  "One more drawing is not a new look; the fingerprint ignored it.",
);
const id = customStyleIdFor(digest(styleFingerprintInput([a, b])));
assert.ok(isCustomStyleId(id), "A custom style id doesn't read as one.");
assert.ok(!isCustomStyleId("watercolor") && !isCustomStyleId(null), "A preset id reads as a custom style.");
assert.ok(/^[a-zA-Z0-9_]+$/.test(id), "A custom style id is not safe as a Firestore document id.");

// --- Keys: one revision is one look ---------------------------------------

const pointer = { id, revision: 1 };
const withPointer = derivedStyleSelection({
  stylePrompt: "soft crayon on cream paper, wobbly outlines",
  derivedFromNames: ["Maya"],
  customStyle: pointer,
});
assert.deepEqual(withPointer.customStyle, pointer, "derivedStyleSelection dropped the style pointer.");
assert.equal(artStyleKey(withPointer), customStyleKeyOf(pointer));
assert.ok(artStyleKey(withPointer).startsWith("custom|"), "A custom look's key must keep the 'custom' first segment.");
assert.equal(
  artStyleKey({ ...withPointer, customDescription: "something the client rewrote" }),
  artStyleKey(withPointer),
  "The wording next to a pointer changed the art-style key.",
);
assert.notEqual(
  artStyleKey({ ...withPointer, customStyle: { id, revision: 2 } }),
  artStyleKey(withPointer),
  "A new revision is the same look.",
);
const legacy = derivedStyleSelection({ stylePrompt: "soft crayon on cream paper, wobbly outlines" });
assert.equal(legacy.customStyle, undefined, "A look without a saved style invented a pointer.");
assert.equal(artStyleKey(legacy), "custom|soft crayon on cream paper, wobbly outlines");

assert.deepEqual(parseCustomStyleRef({ id, revision: 3 }), { id, revision: 3 });
assert.equal(parseCustomStyleRef({ id: "watercolor", revision: 1 }), undefined, "A preset id parsed as a pointer.");
assert.equal(parseCustomStyleRef({ id, revision: 0 }), undefined);
assert.equal(parseCustomStyleRef({ id, revision: 1.5 }), undefined);
assert.equal(parseCustomStyleRef("cs_x"), undefined);

const repaired = normalizeStudioAuthoringState({ version: 1, styleBefore: withPointer });
assert.deepEqual(repaired.styleBefore?.customStyle, pointer, "A stored style pointer was lost when the book was read back.");
const forged = normalizeStudioAuthoringState({
  version: 1,
  styleBefore: { ...withPointer, customStyle: { id: "../../x", revision: -1 } },
});
assert.equal(forged.styleBefore?.customStyle, undefined, "A malformed pointer survived reading the book back.");

// --- What a picture remembers -----------------------------------------------

const stamp = styleStampOf(withPointer);
assert.equal(stamp.customStyleId, id);
assert.equal(stamp.customStyleRevision, 1);
assert.equal(stamp.origin, "derived");
assert.equal(stamp.key, artStyleKey(withPointer));
const presetStamp = styleStampOf({ presetId: "watercolor", origin: "preset" });
assert.equal(presetStamp.customStyleId, undefined);
assert.equal(presetStamp.presetId, "watercolor");

const record = buildRenderRecord({
  artStyle: withPointer,
  action: "portrait",
  outputSize: "1024x1536",
  prompt: "p",
  inputReferences: [
    { role: "likeness", label: "Maya (photo)" },
    { role: "style", storagePath: "public/artStyles/x/generation-1.png" },
    { role: "sourceArt", blobId: "blob-1" },
  ],
  renderedAt: 5,
});
assert.equal(record.action, "portrait");
assert.equal(record.renderedAt, 5);
assert.equal(record.inputReferences?.length, 3);
assert.ok(
  !JSON.stringify(record.inputReferences?.filter((reference) => reference.role === "likeness")).includes("blobId"),
  "A one-use photo's id was written into a picture's record.",
);
assert.equal(buildRenderRecord({ artStyle: undefined, action: "x" }).inputReferences, undefined);

// --- Blob ownership: a style's pictures are never a book's ------------------

const assetId = styleAssetBlobId(id, "src", "1-0");
assert.ok(isStyleAssetBlobId(assetId));
assert.ok(!isStyleAssetBlobId("0b0e1b6e-2f51-4b5c-9f0a-3c3d0e2a7e11"), "An ordinary blob id reads as a style asset.");
assert.ok(!/[^a-zA-Z0-9_-]/.test(styleAssetBlobId("a/b c", "co/ver", "../1")), "A style asset id is not safe as a path segment.");
assert.equal(styleAssetBlobId(id, "src", "1-0"), assetId, "A style asset id is not deterministic, so a retry stores a second copy.");

// --- Previews: curated first, then the reader's own covers ------------------

const cover = (projectId: string, capturedAt: number): StyleCoverExample => ({
  projectId,
  sourceBlobId: `src-${projectId}`,
  image: { blobId: `styleasset-${projectId}`, mimeType: "image/webp", sha256: digest(projectId), createdAt: capturedAt },
  capturedAt,
});
const showcase: StyleShowcase = {
  key: id,
  covers: [cover("p4", 40), cover("p1", 10), cover("p3", 30), cover("p2", 20)],
  updatedAt: 40,
};
assert.deepEqual(
  showcaseCoversOf(showcase).map((entry) => entry.projectId),
  ["p1", "p2", "p3"],
  "The first three covers are not the three oldest.",
);
assert.equal(showcaseCoversOf(null).length, 0);
assert.deepEqual(
  showcaseCoversOf(showcase, { existingProjectIds: new Set(["p2", "p3"]) }).map((entry) => entry.projectId),
  ["p2", "p3"],
);

const portraitReference = { blobId: "styleasset-sample" };
assert.equal(
  resolveStylePreview({ adminExamples: [{ imageUrl: "https://x/a.png" }], showcase, portraitReference }).source,
  "admin",
  "A curated example lost to the reader's own cover.",
);
const fromCover = resolveStylePreview({ adminExamples: [], showcase, portraitReference });
assert.equal(fromCover.source, "cover");
assert.equal(fromCover.blobId, "styleasset-p1");
assert.equal(resolveStylePreview({ showcase: null, portraitReference }).source, "portrait");
assert.equal(resolveStylePreview({}).source, "none");

const strip = resolveStylePreviewStrip({ adminExamples: [], showcase });
assert.equal(strip.length, 3, "A look without curated pictures didn't fall back to its first three covers.");
assert.ok(strip.every((entry) => entry.source === "cover"));
assert.equal(
  resolveStylePreviewStrip({ adminExamples: [{ imageUrl: "u1" }, { imageUrl: "u2" }], showcase }).length,
  2,
  "Curated examples were mixed with the reader's covers.",
);
assert.deepEqual(resolveStylePreviewStrip({}), []);

// --- The sample portrait is never charged ----------------------------------

const sample = splitBillableUsage([{ modality: "image", step: "styleReference", stepId: 1 }]);
assert.equal(sample.billable.length, 0, "The neutral sample portrait reached the reader's bill.");
assert.equal(sample.unbilled.length, 1);

console.log("Custom art style invariants hold.");
