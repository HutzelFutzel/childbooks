"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";
import { Button } from "../components/Button";
import { Field, Input, Textarea } from "../components/Input";
import { Select } from "../components/Select";
import { backendFetch } from "../../platform/backend";
import { useAuthStore } from "../../state/authStore";
import { CONTACT_TOPICS, type ContactTopicId } from "../../core/contact/topics";

/**
 * Public contact form. Posts to the tokenless backend `/contact` endpoint, which
 * stores the message, announces it on Slack, and replies with a ticket reference.
 *
 * This is the ONLY published way to reach support — the site deliberately shows
 * no email address — so the form has to earn the trust a `mailto:` link gets for
 * free. That's what the reference on the success screen is for: something the
 * visitor can quote, as proof the message landed somewhere real.
 *
 * Anti-spam pieces that need the form's cooperation: an off-screen honeypot field
 * (`company`) and `elapsedMs`, which lets the backend reject submissions completed
 * impossibly fast. Both are speed bumps — App Check is the real gate.
 */
export function ContactForm({ privacyUrl, bare = false }: { privacyUrl?: string; bare?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const signedIn = Boolean(user && !user.isAnonymous);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<ContactTopicId>("other");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // How long the form has been open, sent as a DURATION so the backend never has
  // to compare our clock to its own. Monotonic where available, so a system clock
  // change mid-session can't distort it either.
  const openedAt = useRef(typeof performance !== "undefined" ? performance.now() : Date.now());
  const elapsedMs = () =>
    Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - openedAt.current);

  // Prefill from the account so a signed-in user doesn't retype what we know.
  // Their message is still tied to their uid server-side via the ID token.
  useEffect(() => {
    if (!signedIn || !user) return;
    setName((n) => n || user.displayName || "");
    setEmail((e) => e || user.email || "");
  }, [signedIn, user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await backendFetch("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, topic, message, company, elapsedMs: elapsedMs() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not send your message.");
      }
      const body = (await res.json().catch(() => null)) as { ref?: string } | null;
      setRef(body?.ref ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message.");
    } finally {
      setBusy(false);
    }
  };

  if (ref !== null) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink-100 bg-white p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-green-100 text-green-600">
          <CheckCircle2 className="size-6" />
        </span>
        <h2 className="text-lg font-semibold text-ink-900">Message received</h2>
        <p className="max-w-sm text-sm text-ink-500">
          We try to reply to <span className="font-medium text-ink-700">{email}</span> within 24
          hours, but it can occasionally take a little longer.
        </p>
        {ref && (
          <p className="mt-1 text-sm text-ink-500">
            Your reference:{" "}
            <span className="rounded-lg bg-ink-50 px-2 py-1 font-mono text-sm font-semibold text-ink-800">
              {ref}
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={bare ? "space-y-4" : "space-y-4 rounded-2xl border border-ink-100 bg-white p-6 sm:p-8"}
    >
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </Field>
        <Field label="Email" required hint={signedIn ? "From your account — edit if you'd rather we replied elsewhere." : undefined}>
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

      <Field label="What's this about?" required>
        <Select
          value={topic}
          onChange={(e) => setTopic(e.target.value as ContactTopicId)}
          options={CONTACT_TOPICS.map((t) => ({ value: t.id, label: t.label }))}
        />
      </Field>

      <Field label="Message" required>
        <Textarea
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          placeholder="How can we help?"
        />
      </Field>

      {/*
        Honeypot: positioned off-screen rather than `display:none`, because the
        scripts worth catching skip hidden inputs specifically as a trap check.
        Kept out of the tab order and hidden from assistive tech.
      */}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-sm text-xs text-ink-400">
          We use your details only to respond to your enquiry.
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
        <Button type="submit" loading={busy} leftIcon={<Send className="size-4" />}>
          Send message
        </Button>
      </div>
    </form>
  );
}
