"use client";

/**
 * The page headless Chrome photographs.
 *
 * This is the browser half of server-side rendering: it mounts the very same
 * `PrintBook` the editor draws with, at print resolution, and then does
 * nothing. No canvas, no serialization, no `html-to-image` — the renderer on
 * the other side takes ordinary screenshots of ordinary painted DOM, which is
 * why the illustrations survive the trip (WebKit dropping images inside the
 * SVG that `html-to-image` builds is what shipped books with no pictures in
 * them, and no error to say so).
 *
 * It talks to the backend with the job's single-use token instead of a user
 * session, because a screenshot has no business holding real credentials.
 *
 * The contract with the renderer is one object on `window`:
 *   `{ ready: true, captures: [...], viewport }` — laid out, here's what to
 *   photograph and how big a page is; or
 *   `{ error }` — this book can't be rendered, and why.
 * Anything else means still working, so the renderer waits.
 */
import { useEffect, useRef, useState } from "react";
import { EXPORT_DPI } from "../../core/config/options";
import { renderFingerprint } from "../../core/print/fingerprint";
import { getCursor } from "../../core/versioning";
import { COVER_BACK_ID, COVER_FRONT_ID, type BookDesign, type Project } from "../../core/types";
import { backendUrl } from "../../platform/backend";
import { fontStack } from "../typography/fonts";
import { loadArtworkFromUrls, spineColorsFrom, type LoadedArtwork } from "./artwork";
import { waitForStageReady } from "./bookExport";
import { buildDesignPages } from "./designInit";
import { PrintBook, PrintSpine } from "./PrintBook";
import {
  artworkBlobIds,
  buildCoverPlan,
  buildEbookTargets,
  buildInteriorPlan,
  expectedImageCount,
  SPINE_CAPTURE_ID,
  type PlannedTarget,
} from "./printTargets";

/** What the renderer asked for. Mirrors `DocumentRequest` on the backend. */
type DocumentRequest =
  | { kind: "ebook" }
  | { kind: "interior"; padToPages: number }
  | {
      kind: "cover";
      sku?: string;
      padToPages?: number;
      cover: { widthIn: number; heightIn: number; panelWidthIn: number };
    };

/** One page for the renderer to photograph, and where it belongs. */
interface CaptureSpec {
  id: string;
  role: "interior" | "ebook" | "cover-front" | "cover-back" | "spine";
  index: number;
  label: string;
  widthIn: number;
  heightIn: number;
  /** Whether coming out blank means a failed render rather than a blank page. */
  mustHaveInk: boolean;
}

interface RenderState {
  targets: PlannedTarget[];
  captures: CaptureSpec[];
  design: BookDesign;
  artwork: LoadedArtwork;
  /** The admin-configured backcover logo's public URL, or null if unset. */
  backCoverLogoUrl: string | null;
  /** Intrinsic height÷width of the backcover logo (drives the 2 cm edge rule). */
  backCoverLogoAspect: number | null;
  spine?: {
    widthPx: number;
    heightPx: number;
    text: string;
    fontFamily: string;
    background: string;
    color: string;
  };
}

declare global {
  interface Window {
    __bookRender?: {
      ready?: boolean;
      error?: string;
      captures?: CaptureSpec[];
      viewport?: { width: number; height: number };
    };
  }
}

const MIN_TITLED_SPINE_IN = 0.25;

export function ServerRenderStage() {
  const [state, setState] = useState<RenderState | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // Phase 1 — fetch the job, plan the pages, pull the artwork in. Nothing is
  // mounted until every illustration is in hand: a stage that mounts first and
  // fetches after is a stage that can be photographed while it's still empty.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        setState(await prepare());
      } catch (err) {
        window.__bookRender = { error: (err as Error)?.message ?? "The book could not be prepared." };
      }
    })();
  }, []);

  // Phase 2 — once it's mounted and settled, tell the renderer to start.
  useEffect(() => {
    if (!state) return;
    void (async () => {
      try {
        const stage = stageRef.current;
        if (!stage) throw new Error("The render stage did not mount.");
        await waitForStageReady(stage, {
          expectedImages: expectedImageCount(state.targets, state.design, state.artwork.artwork),
        });
        window.__bookRender = {
          ready: true,
          captures: state.captures,
          viewport: viewportFor(state),
        };
      } catch (err) {
        window.__bookRender = { error: (err as Error)?.message ?? "The book could not be laid out." };
      }
    })();
  }, [state]);

  if (!state) return null;

  return (
    <div ref={stageRef} data-render-stage>
      <PrintBook
        targets={state.targets}
        design={state.design}
        artwork={state.artwork.artwork}
        forExport
        backCoverLogoUrl={state.backCoverLogoUrl}
        backCoverLogoAspect={state.backCoverLogoAspect}
      />
      {state.spine && (
        <PrintSpine
          id={SPINE_CAPTURE_ID}
          widthPx={state.spine.widthPx}
          heightPx={state.spine.heightPx}
          text={state.spine.text}
          fontFamily={state.spine.fontFamily}
          background={state.spine.background}
          color={state.spine.color}
        />
      )}
    </div>
  );
}

/** The largest single page, so the renderer's viewport can hold one whole. */
function viewportFor(state: RenderState): { width: number; height: number } {
  let width = 1;
  let height = 1;
  for (const t of state.targets) {
    width = Math.max(width, t.clip ? t.clip.widthPx : t.surfaceWidthPx);
    height = Math.max(height, t.surfaceHeightPx);
  }
  if (state.spine) {
    width = Math.max(width, state.spine.widthPx);
    height = Math.max(height, state.spine.heightPx);
  }
  return { width, height };
}

/** Job credentials, straight off the URL the renderer opened. */
function credentials(): { uid: string; job: string; token: string } {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("uid") ?? "";
  const job = params.get("job") ?? "";
  const token = params.get("token") ?? "";
  if (!uid || !job || !token) throw new Error("This render link is incomplete.");
  return { uid, job, token };
}

async function prepare(): Promise<RenderState> {
  const { uid, job, token } = credentials();
  const base = `/internal/render/${encodeURIComponent(uid)}/${encodeURIComponent(job)}`;
  const res = await fetch(backendUrl(`${base}?token=${encodeURIComponent(token)}`));
  if (!res.ok) throw new Error("This render link is no longer valid.");
  const payload = (await res.json()) as {
    fingerprint: string;
    documents: DocumentRequest[];
    project: Project;
    backCoverLogoUrl: string | null;
    backCoverLogoAspect: number | null;
  };

  const project = payload.project;
  const design = project.design;
  if (!design) throw new Error("This book hasn't been designed yet.");

  // The fingerprint the buyer was quoted against has to be the book we're
  // about to render. If the project moved on in between, rendering it anyway
  // would file a different book under the version they were promised.
  if (renderFingerprint(project, design) !== payload.fingerprint) {
    throw new Error("This book changed while we were getting ready. Please try again.");
  }

  const pages = buildDesignPages(project);
  const targets: PlannedTarget[] = [];
  const captures: CaptureSpec[] = [];
  let spineRequest: RenderState["spine"] | undefined;
  let spineFromBlobId: string | undefined;

  for (const doc of payload.documents) {
    if (doc.kind === "ebook") {
      const ebook = buildEbookTargets(project, pages, EXPORT_DPI);
      targets.push(...ebook);
      ebook.forEach((t, index) => captures.push(spec(t, "ebook", index, design)));
    } else if (doc.kind === "interior") {
      const interior = buildInteriorPlan(project, pages, EXPORT_DPI);
      targets.push(...interior.targets);
      interior.targets.forEach((t, index) => captures.push(spec(t, "interior", index, design)));
    } else {
      const cover = buildCoverPlan(project, pages, EXPORT_DPI);
      targets.push(...cover.targets);
      for (const t of cover.targets) {
        captures.push(spec(t, t.id === COVER_BACK_ID ? "cover-back" : "cover-front", 0, design));
      }

      // The spine is ours to draw: it isn't a design page, it's the band
      // between the two panels, sized by how thick this order's book is.
      const spineWidthIn = Math.max(0, doc.cover.widthIn - doc.cover.panelWidthIn * 2);
      if (spineWidthIn > 0) {
        const text =
          spineWidthIn >= MIN_TITLED_SPINE_IN
            ? (project.screenplay
                ? getCursor(project.screenplay).content.spine?.text
                : ""
              )?.trim() || project.title
            : "";
        spineRequest = {
          widthPx: Math.max(1, Math.round(spineWidthIn * EXPORT_DPI)),
          heightPx: Math.round(doc.cover.heightIn * EXPORT_DPI),
          text,
          fontFamily: fontStack(design.defaultFontFamily),
          background: "#e8e2d6",
          color: "#1f2933",
        };
        spineFromBlobId = pages.find((p) => p.id === COVER_FRONT_ID)?.blobId;
        captures.push({
          id: SPINE_CAPTURE_ID,
          role: "spine",
          index: 0,
          label: "Spine",
          widthIn: spineWidthIn,
          heightIn: doc.cover.heightIn,
          mustHaveInk: false,
        });
      }
    }
  }

  if (targets.length === 0) throw new Error("This book has no pages to render.");

  const blobIds = artworkBlobIds(targets, design);
  const sources: Record<string, string> = {};
  for (const id of blobIds) {
    sources[id] = backendUrl(
      `${base}/blob/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
    );
  }
  const artwork = await loadArtworkFromUrls(sources);

  if (spineRequest && spineFromBlobId) {
    const colors = await spineColorsFrom(artwork.artwork[spineFromBlobId]);
    spineRequest = { ...spineRequest, background: colors.background, color: colors.text };
  }

  return {
    targets,
    captures,
    design,
    artwork,
    backCoverLogoUrl: payload.backCoverLogoUrl,
    backCoverLogoAspect: payload.backCoverLogoAspect,
    spine: spineRequest,
  };
}

/** Describe one target for the renderer. */
function spec(
  target: PlannedTarget,
  role: CaptureSpec["role"],
  index: number,
  design: BookDesign,
): CaptureSpec {
  return {
    id: target.id,
    role,
    index,
    label: target.label,
    widthIn: target.widthIn,
    heightIn: target.heightIn,
    mustHaveInk: expectsInk(design, target),
  };
}

/**
 * Whether this page's design still expects its illustration to show up as ink.
 *
 * Mirrors the call `PrintPage` makes when it decides what to draw: a page with
 * artwork draws it full-bleed unless "Adjust art" turned it into a placed
 * element — and a placed element the user hid is a page that's SUPPOSED to be
 * without it, not a render that failed.
 */
function expectsInk(design: BookDesign, target: PlannedTarget): boolean {
  if (!target.page.blobId) return false;
  const illustrations = (design.pages[target.page.id]?.images ?? []).filter(
    (im) => im.kind === "illustration",
  );
  if (illustrations.length === 0) return true;
  return illustrations.some((im) => !im.hidden);
}
