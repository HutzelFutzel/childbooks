"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bug,
  Check,
  Copy,
  CreditCard,
  HelpCircle,
  Newspaper,
  Package,
  Send,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/Button";
import { Field, Input, Textarea } from "../components/Input";
import { cn } from "../lib/cn";
import { backendFetch } from "../../platform/backend";
import { useAuthStore } from "../../state/authStore";
import { CONTACT_TOPICS, type ContactTopicId } from "../../core/contact/topics";
import { ContactMascot } from "./ContactMascot";

const TOPIC_META: Record<
  ContactTopicId,
  { shortLabel: string; icon: ReactNode; hint?: string }
> = {
  order: {
    shortLabel: "Order & print",
    icon: <Package className="size-3.5" />,
    hint: "Include your order number or book title so we can pull it up right away.",
  },
  billing: {
    shortLabel: "Billing & refunds",
    icon: <CreditCard className="size-3.5" />,
    hint: "For refund or receipt questions, use the email address from your checkout.",
  },
  bug: {
    shortLabel: "Something broke",
    icon: <Bug className="size-3.5" />,
    hint: "Mentioning which page or step got stuck helps us fix it much faster.",
  },
  privacy: {
    shortLabel: "Privacy & data",
    icon: <ShieldAlert className="size-3.5" />,
    hint: "Data-access and deletion requests are prioritized by our privacy team.",
  },
  press: {
    shortLabel: "Press & partners",
    icon: <Newspaper className="size-3.5" />,
  },
  other: {
    shortLabel: "Something else",
    icon: <HelpCircle className="size-3.5" />,
  },
};

/**
 * Editorial "Reader's Correspondence" contact form. Posts to the tokenless
 * backend `/contact` endpoint, which stores the message, announces it on Slack,
 * and replies with a ticket reference.
 *
 * Used both inside `ContactDialog` (`bare={true}`) and as the primary
 * stationery card on `/contact` (`bare={false}`).
 */
export function ContactForm({
  privacyUrl,
  bare = false,
  mascotUrl,
  onSuccess,
}: {
  privacyUrl?: string;
  bare?: boolean;
  mascotUrl?: string | null;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message.");
    } finally {
      setBusy(false);
    }
  };

  if (ref !== null) {
    return (
      <div
        className={cn(
          "flex flex-col items-center text-center",
          bare
            ? "gap-4 py-3"
            : "overflow-hidden rounded-2xl border border-ink-900/12 bg-canvas shadow-lifted",
        )}
      >
        {!bare && <div aria-hidden className="h-[3px] w-full bg-brand-600" />}
        <div className={cn("flex flex-col items-center gap-3.5", !bare && "p-7 sm:p-9")}>
          <div className="relative flex items-center justify-center">
            <ContactMascot mascotUrl={mascotUrl} size="xl" />
            <span className="absolute bottom-0.5 right-0.5 flex size-6 items-center justify-center rounded-full bg-brand-600 text-(--color-brand-foreground) shadow-2xs ring-2 ring-canvas">
              <Check className="size-3.5" />
            </span>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-600">
              Dispatched to the studio desk
            </p>
            <h2 className="mt-1 font-display text-xl font-medium tracking-[-0.01em] text-ink-900">
              We&apos;ve got your note
            </h2>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-600 sm:text-sm">
              We sent a copy to <span className="font-medium text-ink-900">{email}</span> and a real person on our team will write back shortly.
            </p>
          </div>

          {ref && (
            <div className="mt-1 flex items-center gap-2.5 rounded-xl border border-dashed border-ink-900/18 bg-white/80 px-3.5 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                Ref. No
              </span>
              <span className="font-mono text-xs font-semibold text-ink-900">{ref}</span>
              <button
                type="button"
                onClick={copyRef}
                title="Copy reference"
                aria-label="Copy reference"
                className="ml-0.5 rounded-md p-1 text-ink-400 transition hover:bg-ink-900/[0.06] hover:text-ink-800"
              >
                {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {onSuccess && (
              <Button variant="primary" size="sm" onClick={onSuccess}>
                Back to workspace
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Write another note
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const activeTopicHint = TOPIC_META[topic]?.hint;

  return (
    <div
      className={cn(
        !bare &&
          "overflow-hidden rounded-2xl border border-ink-900/12 bg-canvas shadow-lifted",
      )}
    >
      {!bare && (
        <>
          <div aria-hidden className="h-[3px] w-full bg-brand-600" />
          <div className="relative flex items-end justify-between gap-4 border-b border-ink-900/[0.08] px-6 pb-4 pt-5 sm:px-8">
            <div className="min-w-0 pb-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-600">
                Studio Correspondence
              </p>
              <h2 className="mt-0.5 font-display text-lg font-medium tracking-[-0.01em] text-ink-900 sm:text-xl">
                Write to Hugo &amp; the team
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Every note goes straight to a human on our bookmaking team.
              </p>
            </div>
            <ContactMascot
              mascotUrl={mascotUrl}
              size="lg"
              className="-mb-4 translate-y-[2px]"
            />
          </div>
        </>
      )}

      <form
        onSubmit={submit}
        className={cn("space-y-4", !bare && "p-6 sm:p-8")}
      >
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/90 px-3.5 py-2.5 text-xs text-red-700 sm:text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Topic chips — one-tap postcard subject selector */}
        <div className="space-y-1.5">
          <span className="block text-xs font-semibold uppercase tracking-[0.06em] text-ink-500">
            What is your note about?
          </span>
          <div
            role="radiogroup"
            aria-label="What is your note about?"
            className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
          >
            {CONTACT_TOPICS.map((t) => {
              const selected = topic === t.id;
              const meta = TOPIC_META[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTopic(t.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-left font-display text-xs font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
                    selected
                      ? "border-brand-600 bg-brand-50/90 text-brand-700 shadow-2xs"
                      : "border-ink-900/10 bg-white/80 text-ink-700 hover:border-ink-900/20 hover:bg-white hover:text-ink-900",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 transition-colors",
                      selected ? "text-brand-600" : "text-ink-400",
                    )}
                  >
                    {meta?.icon}
                  </span>
                  <span className="truncate">{meta?.shortLabel ?? t.label}</span>
                </button>
              );
            })}
          </div>
          {activeTopicHint && (
            <p className="pt-0.5 text-[11px] leading-relaxed text-ink-500">
              {activeTopicHint}
            </p>
          )}
        </div>

        {/* Sender row ("From:") */}
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Your name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              placeholder="Your name"
              className="bg-white/90 ring-ink-900/12 focus:bg-white"
            />
          </Field>
          <Field
            label="Reply-to email"
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
              className="bg-white/90 ring-ink-900/12 focus:bg-white"
            />
          </Field>
        </div>

        <Field label="Your message" required>
          <Textarea
            rows={bare ? 4 : 5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            placeholder="Tell us what's on your mind — a book title, a question about printing, or anything we can help with…"
            className="bg-white/90 ring-ink-900/12 focus:bg-white"
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

        <div className="flex flex-col-reverse gap-3 border-t border-ink-900/[0.08] pt-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-ink-400">
            Read by our team · Never shared.
            {privacyUrl && (
              <>
                {" "}
                <a
                  href={privacyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-ink-300 underline-offset-2 transition hover:text-ink-700"
                >
                  Privacy Policy
                </a>
              </>
            )}
          </p>
          <Button
            type="submit"
            size="sm"
            loading={busy}
            leftIcon={<Send className="size-3.5" />}
            className="w-full shrink-0 font-display sm:w-auto"
          >
            Send note
          </Button>
        </div>
      </form>
    </div>
  );
}
