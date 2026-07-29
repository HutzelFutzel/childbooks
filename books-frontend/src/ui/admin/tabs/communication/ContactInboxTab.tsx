"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, RotateCcw } from "lucide-react";
import { Button } from "../../../components/Button";
import { backendFetch } from "../../../../platform/backend";
import { contactTopic } from "../../../../core/contact/topics";
import type { ContactMessage, ContactMessageStatus } from "../../../../core/contact/message";
import { fmtDateTime, fmtRelative } from "../../analysis/format";

const FILTERS: { id: ContactMessageStatus | "all"; label: string }[] = [
  { id: "new", label: "New" },
  { id: "handled", label: "Handled" },
  { id: "all", label: "All" },
];

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? null;
  } catch {
    return null;
  }
}

/**
 * Communication → Contact inbox. The admin-facing view of `contactMessages` —
 * the system of record for the public `/contact` form. There is no public
 * inbox address to fall back to, so this list (plus the Slack ping at submit
 * time) is the only way a submission is ever seen.
 *
 * Reads/writes go through the admin-gated backend
 * (`/admin/contact/messages*`) — the collection itself is deny-all in
 * `firestore.rules`.
 */
export function ContactInboxTab() {
  const [filter, setFilter] = useState<ContactMessageStatus | "all">("new");
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRef, setPendingRef] = useState<string | null>(null);

  const load = useCallback(async (status: ContactMessageStatus | "all") => {
    setLoading(true);
    try {
      const qs = status === "all" ? "" : `?status=${status}`;
      const res = await backendFetch(`/admin/contact/messages${qs}`);
      if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load messages.");
      const json = (await res.json()) as { messages?: ContactMessage[] };
      setMessages(json.messages ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const setHandled = async (ref: string, handled: boolean) => {
    setPendingRef(ref);
    try {
      const res = await backendFetch(`/admin/contact/messages/${encodeURIComponent(ref)}/handled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handled }),
      });
      if (!res.ok) throw new Error((await safeError(res)) ?? "Could not update this message.");
      const json = (await res.json()) as { message: ContactMessage };
      // Optimistic-ish: drop it from the current filter's list rather than
      // re-fetching, unless we're looking at "all" (where it just changes status).
      setMessages((prev) =>
        filter === "all"
          ? prev.map((m) => (m.ref === ref ? json.message : m))
          : prev.filter((m) => m.ref !== ref),
      );
      toast.success(handled ? "Marked handled." : "Reopened.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this message.");
    } finally {
      setPendingRef(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Submissions from the public /contact form. The site publishes no email
          address, so this list — and the Slack ping sent at submit time — is the
          only way these are seen. Reply from your own mail client; the sender's
          address is right there.
        </p>
        <div className="flex gap-1 rounded-xl bg-ink-50 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.id ? "bg-white text-ink-900 shadow-soft" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-ink-100 bg-white p-10 text-sm text-ink-400">
          <Loader2 className="size-4 animate-spin" /> Loading messages…
        </div>
      ) : messages.length === 0 ? (
        <div className="rounded-2xl border border-ink-100 bg-white p-10 text-center text-sm text-ink-400">
          {filter === "new" ? "No new messages — the inbox is clear." : "Nothing here."}
        </div>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white">
          {messages.map((m) => (
            <MessageRow
              key={m.ref}
              message={m}
              busy={pendingRef === m.ref}
              onToggleHandled={() => setHandled(m.ref, m.status !== "handled")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageRow({
  message,
  busy,
  onToggleHandled,
}: {
  message: ContactMessage;
  busy: boolean;
  onToggleHandled: () => void;
}) {
  const meta = contactTopic(message.topic);
  const handled = message.status === "handled";
  const mailto = `mailto:${message.email}?subject=${encodeURIComponent(`Re: ${meta.label} (${message.ref})`)}`;

  return (
    <li className={`flex flex-col gap-2 p-4 ${handled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-lg bg-ink-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-ink-700">
              {message.ref}
            </span>
            <span className="font-medium text-ink-800">{meta.label}</span>
            {meta.timeSensitive && !handled && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                <Clock className="size-3" /> time-sensitive
              </span>
            )}
          </div>
          <p className="text-xs text-ink-500">
            <a href={mailto} className="font-medium text-ink-700 underline-offset-2 hover:underline">
              {message.name}
            </a>{" "}
            &lt;{message.email}&gt;
            {message.uid && <span className="ml-1 text-ink-400">· uid {message.uid}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-right text-xs text-ink-400">
          <span title={fmtDateTime(message.createdAt)}>{fmtRelative(message.createdAt)}</span>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm text-ink-700">{message.message}</p>

      <div className="flex items-center justify-between gap-2 pt-1">
        <a
          href={mailto}
          className="text-xs font-medium text-brand-600 underline-offset-2 hover:underline"
        >
          Reply by email
        </a>
        <Button
          variant={handled ? "ghost" : "secondary"}
          size="sm"
          loading={busy}
          onClick={onToggleHandled}
          leftIcon={
            handled ? <RotateCcw className="size-3.5" /> : <CheckCircle2 className="size-3.5" />
          }
        >
          {handled ? "Reopen" : "Mark handled"}
        </Button>
      </div>
    </li>
  );
}

