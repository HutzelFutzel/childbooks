import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { pageTrimForConfig } from "../../core/book";
import { COVER_FRONT_ID, type BookDesign, type Project } from "../../core/types";
import type { PublishedBook, PublishedPage } from "../../core/share/types";
import { canRemoveWatermark, entitlementsForSubscription } from "../../core/config/entitlements";
import { activeSubscription } from "../../platform/subscriptions";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSubscriptionStore } from "../../state/subscriptionStore";
import { getFirebaseAuth } from "../../lib/firebase";
import { savePublishedBook, uploadPreviewImage } from "../../platform/share";
import {
  capturePageElement,
  computeFontEmbedCss,
  waitForStageReady,
} from "../design/bookExport";
import type { DesignPage } from "../design/designInit";
import { PrintBook } from "../design/PrintBook";

/** Render resolution for preview images — plenty for screens, light to upload. */
const PREVIEW_DPI = 150;

/**
 * Renders the whole book offscreen (the same path the export uses), rasterizes
 * each page to a PNG, uploads them to public Storage, and writes the
 * `publishedBooks/{shareId}` document. Reports progress and returns the saved
 * {@link PublishedBook}. Renders only the hidden capture stage — the hosting
 * dialog owns the visible UI.
 */
export function ShareRunner({
  pages,
  design,
  project,
  shareId,
  onProgress,
  onDone,
  onError,
}: {
  pages: DesignPage[];
  design: BookDesign;
  project: Project;
  shareId: string;
  onProgress: (status: string) => void;
  onDone: (book: PublishedBook) => void;
  onError: (err: unknown) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // Make sure the publisher's subscription is being watched so we can read its
  // latest value when we build the published doc (below).
  const watchSubscriptions = useSubscriptionStore((s) => s.watch);
  useEffect(() => {
    watchSubscriptions();
  }, [watchSubscriptions]);

  const trim = pageTrimForConfig(project.config);
  const pageHeightPx = Math.round(trim.heightIn * PREVIEW_DPI);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const stage = stageRef.current;
      if (!stage) {
        onError(new Error("Could not prepare the publish stage."));
        return;
      }
      try {
        const ownerUid = getFirebaseAuth().currentUser?.uid;
        if (!ownerUid) throw new Error("You need to be signed in to publish.");

        onProgress("Loading fonts & artwork…");
        await waitForStageReady(stage);
        onProgress("Embedding fonts…");
        const fontEmbedCSS = await computeFontEmbedCss(stage);

        const published: PublishedPage[] = [];
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          onProgress(`Publishing page ${i + 1} of ${pages.length}…`);
          const el = stage.querySelector<HTMLElement>(
            `[data-export-page="${cssEscape(page.id)}"]`,
          );
          if (!el) continue;
          const blob = await capturePageElement(el, { fontEmbedCSS });
          const url = await uploadPreviewImage(ownerUid, shareId, page.id, blob);
          published.push({
            id: page.id,
            label: page.label,
            url,
            aspect: page.aspect,
            isCover: page.isCover,
          });
        }

        if (published.length === 0) throw new Error("No finished pages to publish yet.");

        // Resolve "remove watermark" from the publisher's plan at publish time,
        // reading the latest store snapshots (subscriptions may load post-mount).
        const subscriptions = useSubscriptionStore.getState().subscriptions;
        const publicPlans = useAppConfigStore.getState().plans.plans;
        const watermarkRemoved = canRemoveWatermark(
          entitlementsForSubscription(
            activeSubscription(subscriptions)?.priceId ?? null,
            publicPlans,
          ),
        );

        const now = Date.now();
        const book: PublishedBook = {
          shareId,
          ownerUid,
          projectId: project.id,
          title: project.title,
          summary: project.analysis?.summary,
          coverUrl: published.find((p) => p.id === COVER_FRONT_ID)?.url,
          pages: published,
          pageCount: published.filter((p) => !p.isCover).length,
          watermarkRemoved,
          createdAt: now,
          updatedAt: now,
        };
        onProgress("Finalizing…");
        await savePublishedBook(book);
        onDone(book);
      } catch (err) {
        onError(err);
      }
    }

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={stageRef} aria-hidden>
      <PrintBook pages={pages} design={design} pageHeightPx={pageHeightPx} forExport />
    </div>,
    document.body,
  );
}

/** Minimal CSS.escape fallback for attribute selectors. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}
