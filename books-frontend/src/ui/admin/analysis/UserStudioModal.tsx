"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { backendFetch } from "../../../platform/backend";
import { describeFlowArm } from "../../../core/guide/flow";
import type {
  StudioTimelineEntry,
  StudioTimelineKind,
  UserStudioReport,
} from "../../../core/analytics/types";
import { useAdminAccess } from "../../../state/adminAccessStore";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { MILESTONES } from "./milestones";
import { fmtDateTime, fmtNumber, fmtRelative, fmtSparks, fmtUsd } from "./format";

const KIND_LABEL: Record<StudioTimelineKind, string> = {
  signup: "Account",
  login: "Account",
  milestone: "Milestone",
  turn: "Typed",
  event: "Tapped",
  run: "AI run",
};

const KIND_TONE: Record<StudioTimelineKind, string> = {
  signup: "bg-ink-100 text-ink-600",
  login: "bg-ink-100 text-ink-600",
  milestone: "bg-emerald-50 text-emerald-700",
  turn: "bg-brand-50 text-brand-700",
  event: "bg-sky-50 text-sky-700",
  run: "bg-violet-50 text-violet-700",
};

const FILTERS: { id: "all" | StudioTimelineKind | "flagged"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "flagged", label: "Needs a look" },
  { id: "turn", label: "Typed" },
  { id: "event", label: "Tapped" },
  { id: "milestone", label: "Milestones" },
  { id: "run", label: "AI runs" },
];

/**
 * One account's studio history: where each of its books stopped, what it did in
 * the guided studio, and everything in order.
 *
 * The aggregate Studio-flows page says which flow works better; this answers "what
 * did this particular person do" — the question behind a support message and
 * behind every "why did this book die" hunch.
 *
 * What the reader typed is NOT loaded by default. It is personal data, so showing
 * it is a separate, explicit step that needs the personal-data permission and is
 * audit-logged server-side; without it the timeline still shows that they typed
 * something, when, and what became of it.
 */
export function UserStudioModal({ uid, onClose }: { uid: string | null; onClose: () => void }) {
  const canReadWords = useAdminAccess((s) => s.canRead("analysis.users.pii"));
  const [report, setReport] = useState<UserStudioReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [bookKey, setBookKey] = useState<string>("");

  const load = useCallback(
    async (words: boolean) => {
      if (!uid) return;
      setLoading(true);
      setError(null);
      try {
        const res = await backendFetch(
          `/admin/analytics/users/${encodeURIComponent(uid)}/studio${words ? "?words=true" : ""}`,
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? "Could not load this account's studio history.");
        }
        setReport((await res.json()) as UserStudioReport);
      } catch (err) {
        setError((err as Error)?.message ?? "Could not load this account's studio history.");
      } finally {
        setLoading(false);
      }
    },
    [uid],
  );

  useEffect(() => {
    setReport(null);
    setFilter("all");
    setBookKey("");
    if (uid) void load(false);
  }, [uid, load]);

  const timeline = useMemo(() => {
    if (!report) return [];
    return report.timeline.filter((entry) => {
      if (bookKey && entry.projectId !== bookKey) return false;
      if (filter === "all") return true;
      if (filter === "flagged") return Boolean(entry.flag);
      return entry.kind === filter;
    });
  }, [report, filter, bookKey]);

  const showWords = async () => {
    await load(true);
    toast.message("Showing what they typed. This access is logged.");
  };

  return (
    <Modal
      open={uid !== null}
      onClose={onClose}
      size="max-w-5xl"
      title="Studio history"
    >
      {loading && !report ? (
        <div className="flex items-center justify-center py-16 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : error && !report ? (
        <p className="py-10 text-center text-sm text-red-600">{error}</p>
      ) : !report ? null : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-ink-500">{report.uid}</span>
            <span className="rounded-full bg-ink-50 px-2 py-0.5 font-medium text-ink-700 ring-1 ring-inset ring-ink-100">
              {describeFlowArm(report.arm)}
            </span>
            {report.excluded && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-100">
                On the exclusion list — not counted in dashboards
              </span>
            )}
            {report.truncated && (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <AlertTriangle className="size-3" />
                Heavy account: showing the newest records, so counts are a lower bound.
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Books" value={fmtNumber(report.totals.books)} />
            <Tile label="Typed turns" value={fmtNumber(report.totals.turns)} />
            <Tile label="Taps & similar" value={fmtNumber(report.totals.events)} />
            <Tile
              label="Didn't land"
              value={fmtNumber(report.totals.admittedFailures)}
              tone={report.totals.admittedFailures > 0 ? "warn" : undefined}
            />
            <Tile
              label="Refused"
              value={fmtNumber(report.totals.refusals)}
              tone={report.totals.refusals > 0 ? "warn" : undefined}
            />
            <Tile
              label="Last seen"
              value={report.totals.lastActiveAt ? fmtRelative(report.totals.lastActiveAt) : "—"}
              title={report.totals.lastActiveAt ? fmtDateTime(report.totals.lastActiveAt) : undefined}
            />
          </div>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-ink-700">Books — and where each one stopped</h3>
            {report.books.length === 0 ? (
              <p className="text-xs text-ink-400">No books recorded for this account.</p>
            ) : (
              <div className="overflow-hidden rounded-xl ring-1 ring-ink-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-ink-500">
                      <th className="px-3 py-2 font-medium">Book</th>
                      <th className="px-3 py-2 font-medium">Studio</th>
                      <th className="px-3 py-2 font-medium">Stopped after</th>
                      <th className="px-3 py-2 text-right font-medium">Turns</th>
                      <th className="px-3 py-2 text-right font-medium">Taps</th>
                      <th className="px-3 py-2 text-right font-medium">Images</th>
                      <th className="px-3 py-2 text-right font-medium">Sparks</th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 font-medium">Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.books.map((book) => {
                      const stopped = MILESTONES.find((m) => m.key === book.stoppedAfter)?.label ?? "—";
                      const active = bookKey === book.projectId;
                      return (
                        <tr
                          key={book.key}
                          onClick={() => setBookKey(active ? "" : book.projectId)}
                          title={active ? "Show every book again" : "Show only this book on the timeline"}
                          className={`cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50/40 ${
                            active ? "bg-brand-50/50" : ""
                          }`}
                        >
                          <td className="px-3 py-2 text-ink-800">{book.title ?? "Untitled"}</td>
                          <td className="px-3 py-2 text-ink-600">{describeFlowArm(book.arm)}</td>
                          <td className="px-3 py-2 text-ink-600">
                            {stopped}
                            {book.lastComponent && (
                              <span className="ml-1 text-ink-400">· last answered {book.lastComponent}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(book.turns)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(book.events)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(book.images)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtSparks(book.sparksCharged)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(book.costUsd)}</td>
                          <td className="px-3 py-2 text-ink-500" title={fmtDateTime(book.lastActionAt)}>
                            {fmtRelative(book.lastActionAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-ink-700">
                Timeline
                {bookKey && <span className="ml-1 font-normal text-ink-400">· one book</span>}
              </h3>
              <div className="flex flex-wrap items-center gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] ring-1 ring-inset transition ${
                      filter === f.id
                        ? "bg-ink-900 text-white ring-ink-900"
                        : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
                {canReadWords && !report.wordsRevealed && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Eye className="size-3.5" />}
                    onClick={() => void showWords()}
                    loading={loading}
                    title="Show the messages this person typed. Needs the personal-data permission and is logged."
                  >
                    Show what they typed
                  </Button>
                )}
              </div>
            </div>

            {timeline.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-400">Nothing recorded for this selection.</p>
            ) : (
              <ol className="max-h-96 overflow-auto rounded-xl ring-1 ring-ink-100">
                {timeline.map((entry, index) => (
                  <TimelineRow key={`${entry.at}-${index}`} entry={entry} books={report.books} />
                ))}
              </ol>
            )}
            <p className="mt-1.5 text-[11px] text-ink-400">
              Showing the newest {fmtNumber(report.timeline.length)} lines. The reader&apos;s own words are{" "}
              {report.wordsRevealed ? "shown (this view was logged)" : "hidden"}; everything else here is
              written by the system.
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
}

function TimelineRow({
  entry,
  books,
}: {
  entry: StudioTimelineEntry;
  books: UserStudioReport["books"];
}) {
  const book = entry.projectId ? books.find((b) => b.projectId === entry.projectId) : null;
  return (
    <li className="flex items-start gap-3 border-b border-ink-50 px-3 py-2 text-xs last:border-0">
      <span className="w-36 shrink-0 tabular-nums text-ink-400" title={fmtDateTime(entry.at)}>
        {fmtDateTime(entry.at)}
      </span>
      <span
        className={`mt-px w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-medium ${KIND_TONE[entry.kind]}`}
      >
        {KIND_LABEL[entry.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={
            entry.flag === "bad" ? "font-medium text-red-600" : entry.flag === "warn" ? "font-medium text-amber-700" : "text-ink-800"
          }
        >
          {entry.label}
          {book && <span className="ml-1.5 font-normal text-ink-400">· {book.title ?? "Untitled"}</span>}
        </div>
        {entry.detail && <div className="text-ink-500">{entry.detail}</div>}
        {entry.text && (
          <blockquote className="mt-1 rounded-lg bg-ink-50 px-2.5 py-1.5 text-ink-700">{entry.text}</blockquote>
        )}
      </div>
    </li>
  );
}

function Tile({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone?: "warn";
  title?: string;
}) {
  return (
    <div className="rounded-xl bg-ink-50/60 p-3 ring-1 ring-inset ring-ink-100" title={title}>
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === "warn" ? "text-amber-600" : "text-ink-900"}`}
      >
        {value}
      </div>
    </div>
  );
}
