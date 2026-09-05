"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Copy, Send } from "lucide-react";
import { Button } from "../components/Button";
import { Field, Input, Textarea } from "../components/Input";
import { Select } from "../components/Select";
import { backendFetch } from "../../platform/backend";
import { useAuthStore } from "../../state/authStore";
import { CONTACT_TOPICS, type ContactTopicId } from "../../core/contact/topics";

const TOPIC_HINTS: Partial<Record<ContactTopicId, string>> = {
  order: "Tip: Including your order number or the book's title helps us look it up immediately.",
  billing: "Tip: For refund requests, please ensure the email matches your receipt or invoice.",
  bug: "Tip: Mentioning what device, browser, or step had an issue helps us resolve it quickly.",
};

/**
 * Public contact form. Posts to the tokenless backend `/contact` endpoint, which
 * stores the message, announces it on Slack, and replies with a ticket reference.
 *
 * This is the primary way to reach support — the site deliberately shows
 * no raw email address to prevent scraping/spam — so the form is crafted to provide
 * maximum clarity, reassurance, and trust.
 */
export function ContactForm({
  privacyUrl,
  bare = false,
  onSuccess,
}: {
  privacyUrl?: string;
  bare?: boolean;
  onSuccess?: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const signedIn = Boolean(user && !user.isAnonymous);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<ContactTopicId>("order");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openedAt = useRef(typeof performance !== "undefined" ? performance.now() : Date.now());
  const elapsedMs = () =>
    Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - openedAt.current);

  // Prefill from the account so a signed-in user doesn't retype what we know.
  useEffect(() => {
    if (!signedIn || !user) return;
    setName((n) => n || user.displayName || "");
    setEmail((e) => e || user.email || "");
  }, [signedIn, user]);

  const copyRef = () => {
    if (!ref) return;
    navigator.clipboard.writeText(ref);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetForm = () => {
    setMessage("");
    setRef(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const payload = JSON.stringify({ name, email, topic, message, company, elapsedMs: elapsedMs() });
    try {
      let res: Response | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await backendFetch("/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
        }
      }
      if (!res) throw lastErr instanceof Error ? lastErr : new Error("Could not send your message.");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not send your message.");
      }
      const body = (await res.json().catch(() => null)) as { ref?: string } | null;
      setRef(body?.ref ?? "");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message.");
    } finally {
      setBusy(false);
    }
  };

  if (ref !== null) {
    return (
      <div
        className={
          bare
            ? "flex flex-col items-center gap-4 py-4 text-center"
            : "flex flex-col items-center gap-4 rounded-3xl border border-ink-100 bg-white p-8 text-center shadow-soft"
        }
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
          <CheckCircle2 className="size-7" />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold text-ink-900">Message received</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-600">
            Thank you! We received your message and sent a confirmation to{" "}
            <span className="font-medium text-ink-900">{email}</span>. A team member will reply directly to your inbox.
          </p>
        </div>

        {ref && (
          <div className="mt-1 flex items-center gap-2 rounded-2xl border border-ink-100 bg-ink-50/70 px-3.5 py-2">
            <span className="text-xs text-ink-500">Ticket reference:</span>
            <span className="font-mono text-xs font-semibold text-ink-800">{ref}</span>
            <button
              type="button"
              onClick={copyRef}
              title="Copy reference"
              aria-label="Copy reference"
              className="ml-1 rounded-md p-1 text-ink-400 transition hover:bg-ink-200/60 hover:text-ink-700"
            >
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {onSuccess && (
            <Button variant="primary" size="sm" onClick={onSuccess}>
              Done
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={resetForm}>
            Send another note
          </Button>
        </div>
      </div>
    );
  }

  const activeTopicHint = TOPIC_HINTS[topic];

  return (
    <form
      onSubmit={submit}
      className={bare ? "space-y-4" : "space-y-5 rounded-3xl border border-ink-100 bg-white p-6 sm:p-8 shadow-soft"}
    >
      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            placeholder="Your name"
          />
        </Field>
        <Field
          label="Email address"
          required
          hint={signedIn ? "From your account (we'll reply here)" : undefined}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Field>
      </div>

      <Field label="What can we help you with?" required>
        <Select
          value={topic}
          onChange={(e) => setTopic(e.target.value as ContactTopicId)}
          options={CONTACT_TOPICS.map((t) => ({ value: t.id, label: t.label }))}
        />
      </Field>

      <Field
        label="Message"
        required
        hint={activeTopicHint}
      >
        <Textarea
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          placeholder="How can we help? Tell us as much detail as you'd like..."
        />
      </Field>

      {/* Honeypot for automated spam bots */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Company
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-col-reverse gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-400">
          We protect your privacy and only use your details to respond.
          {privacyUrl && (
            <>
              {" "}
              See our{" "}
              <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-600">
                Privacy Policy
              </a>
              .
            </>
          )}
        </p>
        <Button type="submit" loading={busy} leftIcon={<Send className="size-4" />} className="w-full sm:w-auto">
          Send message
        </Button>
      </div>
    </form>
  );
}
