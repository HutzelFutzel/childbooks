"use client";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  Clock,
  Download,
  Globe,
  Loader2,
  Monitor,
  Tablet,
} from "lucide-react";
import {
  fetchDownloadEvents,
  fetchDownloadLink,
  markDownloadsSeen,
  type DownloadEntitlement,
  type DownloadEvent,
} from "../../platform/downloads";
import { useDownloadsStore } from "../../state/downloadsStore";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { notify } from "../lib/notify";
import { cn } from "../lib/cn";

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(ms),
    );
  } catch {
    return new Date(ms).toLocaleString();
  }
}

const TYPE_LABEL: Record<string, string> = {
  ebook: "Digital edition (PDF)",
};

export function DownloadsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const downloads = useDownloadsStore((s) => s.downloads);
  const loading = useDownloadsStore((s) => s.loading);

  // Clear the "new" badge when the user actually looks at the list. The backend
  // stamps seenAt; the live subscription reflects it back into the store.
  useEffect(() => {
    if (open) void markDownloadsSeen();
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Your downloads" size="max-w-2xl">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-ink-500">
          <Loader2 className="size-5 animate-spin" /> Loading your downloads…
        </div>
      ) : downloads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
            <Download className="size-6" />
          </span>
          <p className="text-sm font-medium text-ink-700">No downloads yet</p>
          <p className="max-w-sm text-sm text-ink-500">
            When you buy the digital edition of a book it'll appear here to download anytime, on any
            device.
          </p>
        </div>
      ) : (
        <div className="-mx-1 max-h-[68vh] space-y-3 overflow-y-auto px-1 py-1">
          {downloads.map((d) => (
            <DownloadCard key={d.id} download={d} />
          ))}
        </div>
      )}
    </Modal>
  );
}

function DownloadCard({ download }: { download: DownloadEntitlement }) {
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [events, setEvents] = useState<DownloadEvent[] | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const isNew = download.seenAt == null;

  const start = async () => {
    // Open a tab synchronously so the async link fetch isn't blocked as a popup.
    const win = window.open("", "_blank");
    setBusy(true);
    try {
      const url = await fetchDownloadLink(download.id);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && events === null && !loadingEvents) {
      setLoadingEvents(true);
      try {
        setEvents(await fetchDownloadEvents(download.id));
      } finally {
        setLoadingEvents(false);
      }
    }
  };

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink-800">
              {download.title || "Your book"}
            </p>
            {isNew && (
              <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                New
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            {TYPE_LABEL[download.type] ?? "Download"} · bought {formatDate(download.purchasedAt)}
          </p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500">
          {download.type === "ebook" ? <Tablet className="size-4" /> : <Download className="size-4" />}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
        <span>
          Downloaded <span className="font-medium text-ink-700">{download.downloadCount}</span>{" "}
          {download.downloadCount === 1 ? "time" : "times"}
        </span>
        {download.lastDownloadedAt && <span>Last: {formatDate(download.lastDownloadedAt)}</span>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" leftIcon={<Download className="size-4" />} loading={busy} onClick={() => void start()}>
          Download
        </Button>
      </div>

      <div className="mt-3 border-t border-ink-100 pt-2">
        <button
          onClick={() => void toggleHistory()}
          className="flex w-full items-center justify-between text-xs font-medium text-ink-500 hover:text-ink-700"
        >
          <span>Download history{download.downloadCount > 0 ? ` (${download.downloadCount})` : ""}</span>
          <ChevronDown className={cn("size-4 transition-transform", showHistory && "rotate-180")} />
        </button>
        {showHistory && (
          <div className="mt-2">
            {loadingEvents ? (
              <div className="flex items-center gap-2 py-2 text-xs text-ink-500">
                <Loader2 className="size-3.5 animate-spin" /> Loading history…
              </div>
            ) : events && events.length > 0 ? (
              <ol className="space-y-2">
                {events.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {/Mobile|Android|iPhone|iPad/i.test(e.userAgent ?? "") ? (
                      <Tablet className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
                    ) : (
                      <Monitor className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
                    )}
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 text-ink-700">
                        <Clock className="size-3" /> {formatDate(e.at)}
                      </p>
                      {e.ip && (
                        <p className="flex items-center gap-1 text-ink-400">
                          <Globe className="size-3" /> {e.ip}
                        </p>
                      )}
                      {e.userAgent && <p className="truncate text-ink-400">{e.userAgent}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-2 text-xs text-ink-400">No downloads recorded yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
