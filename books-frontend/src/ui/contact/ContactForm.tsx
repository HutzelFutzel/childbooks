"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";
import { Button } from "../components/Button";
import { Field, Input, Textarea } from "../components/Input";
import { backendFetch } from "../../platform/backend";

/**
 * Public contact form. Posts to the tokenless backend `/contact` endpoint, which
 * emails the admin's configured contact inbox (reply-to = the sender). Includes a
 * hidden honeypot field (`company`) that real users leave blank.
 */
export function ContactForm({ privacyUrl, bare = false }: { privacyUrl?: string; bare?: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await backendFetch("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, topic, message, company }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not send your message.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink-100 bg-white p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-green-100 text-green-600">
          <CheckCircle2 className="size-6" />
        </span>
        <h2 className="text-lg font-semibold text-ink-900">Message sent</h2>
        <p className="max-w-sm text-sm text-ink-500">
          Thanks for reaching out — we&apos;ll get back to you by email as soon as we can.
        </p>
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
        <Field label="Email" required>
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

      <Field label="Topic">
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What's this about?"
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

      {/* Honeypot: hidden from users, visible to bots. */}
      <div aria-hidden="true" className="hidden">
        <label>
          Company
          <input
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
