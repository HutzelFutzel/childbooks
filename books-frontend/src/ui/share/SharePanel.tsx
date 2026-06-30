"use client";
import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { BookDesign, Project } from "../../core/types";
import type { PublishedBook } from "../../core/share/types";
import { newShareId } from "../../platform/share";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { notify } from "../lib/notify";
import type { DesignPage } from "../design/designInit";
import { ShareRunner } from "./ShareRunner";

type Phase = "idle" | "working" | "done";

/**
 * Publish the book for a public, shareable, SEO-friendly preview page. Re-runs
 * overwrite the same share id so the URL is stable. The heavy rasterize/upload
 * work is delegated to {@link ShareRunner}; this dialog owns the flow + result.
 */
export function SharePanel({
  open,
  onClose,
  project,
  pages,
  design,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  pages: DesignPage[];
  design: BookDesign;
}) {
  const setShare = useProjectsStore((s) => s.setShare);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [activeShareId, setActiveShareId] = useState<string | null>(null);

  const published = project.share;
  const shareId = phase === "working" ? activeShareId : published?.id ?? null;
  const url = shareId ? publicUrl(shareId) : null;

  function startPublish() {
    setActiveShareId(published?.id ?? newShareId());
    setStatus("Preparing pages…");
    setPhase("working");
  }

  async function handleDone(book: PublishedBook) {
    await setShare({ id: book.shareId, publishedAt: book.updatedAt });
    setPhase("done");
    notify.success("Your book is live", "Anyone with the link can read the preview.");
  }

  function handleError(err: unknown) {
    setPhase("idle");
    setActiveShareId(null);
    notify.error(err);
  }

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify.success("Link copied");
    } catch {
      notify.error("Couldn't copy the link.");
    }
  }

  const isLive = published || phase === "done";

  return (
    <Modal
      open={open}
      onClose={phase === "working" ? () => {} : onClose}
      title="Share your book"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={phase === "working"}>
            {isLive ? "Done" : "Cancel"}
          </Button>
          <Button
            onClick={startPublish}
            loading={phase === "working"}
            leftIcon={
              phase === "working" ? undefined : isLive ? (
                <RefreshCw className="size-4" />
              ) : (
                <Globe className="size-4" />
              )
            }
          >
            {phase === "working"
              ? "Publishing…"
              : isLive
                ? "Re-publish latest"
                : "Publish preview"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Publish a public, read-only preview of your book. The link works on any device and shows a
          rich preview when shared on social media — great for gathering feedback before you print.
        </p>

        {phase === "working" && (
          <div className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2.5 text-sm text-brand-700">
            <Loader2 className="size-4 animate-spin" />
            <span className="truncate" title={status}>
              {status}
            </span>
          </div>
        )}

        {url && phase !== "working" && (
          <div className="space-y-2">
            {phase === "done" && (
              <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="size-4" /> Published
              </div>
            )}
            <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{url}</span>
              <button
                onClick={copyLink}
                title="Copy link"
                className="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
              >
                <Copy className="size-4" />
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title="Open preview"
                className="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
              >
                <ExternalLink className="size-4" />
              </a>
            </div>
            {published && phase !== "done" && (
              <p className="text-xs text-ink-400">
                Last published {new Date(published.publishedAt).toLocaleString()}. Re-publish to push
                your latest edits.
              </p>
            )}
          </div>
        )}
      </div>

      {phase === "working" && activeShareId && (
        <ShareRunner
          pages={pages}
          design={design}
          project={project}
          shareId={activeShareId}
          onProgress={setStatus}
          onDone={handleDone}
          onError={handleError}
        />
      )}
    </Modal>
  );
}

function publicUrl(shareId: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
  return `${origin}/book/${shareId}`;
}
