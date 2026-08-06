"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";
import { Button } from "../components/Button";
import { Field, Input, Textarea } from "../components/Input";
import { Select } from "../components/Select";
import { backendFetch } from "../../platform/backend";
import { useAuthStore } from "../../state/authStore";
import {
  AFFILIATE_AUDIENCE_IDS,
  AFFILIATE_AUDIENCE_LABELS,
  AFFILIATE_CHANNEL_IDS,
  AFFILIATE_CHANNEL_LABELS,
  type AffiliateAudienceId,
  type AffiliateChannelId,
} from "../../core/affiliates/application";

/**
 * Public affiliate application form. Posts to the tokenless
 * `/affiliate-applications` endpoint (Firestore + Slack + ack email). Approval
 * is manual — this never creates a Rewardful partner on its own.
 */
export function AffiliateApplyForm({ privacyUrl }: { privacyUrl?: string }) {
  const user = useAuthStore((s) => s.user);
  const signedIn = Boolean(user && !user.isAnonymous);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState<AffiliateChannelId>("instagram");
  const [channelUrl, setChannelUrl] = useState("");
  const [audience, setAudience] = useState<AffiliateAudienceId>("1k_10k");
  const [pitch, setPitch] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openedAt = useRef(typeof performance !== "undefined" ? performance.now() : Date.now());
  const elapsedMs = () =>
    Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - openedAt.current);

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
      const res = await backendFetch("/affiliate-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          channel,
          channelUrl,
          audience,
          pitch,
          company,
          elapsedMs: elapsedMs(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not submit your application.");
      }
      const body = (await res.json().catch(() => null)) as { ref?: string } | null;
      setRef(body?.ref ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your application.");
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
        <h2 className="text-lg font-semibold text-ink-900">Application received</h2>
        <p className="max-w-sm text-sm text-ink-500">
          Thanks — we&apos;ll review your application and email{" "}
          <span className="font-medium text-ink-700">{email}</span> with next steps,
          usually within a few business days.
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
      className="relative space-y-4 rounded-2xl border border-ink-100 bg-white p-6 sm:p-8"
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
        <Field
          label="Email"
          required
          hint={signedIn ? "From your account — edit if you'd rather we replied elsewhere." : undefined}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Primary channel" required>
          <Select
            value={channel}
            onChange={(e) => setChannel(e.target.value as AffiliateChannelId)}
            options={AFFILIATE_CHANNEL_IDS.map((id) => ({
              value: id,
              label: AFFILIATE_CHANNEL_LABELS[id],
            }))}
          />
        </Field>
        <Field label="Audience size" required>
          <Select
            value={audience}
            onChange={(e) => setAudience(e.target.value as AffiliateAudienceId)}
            options={AFFILIATE_AUDIENCE_IDS.map((id) => ({
              value: id,
              label: AFFILIATE_AUDIENCE_LABELS[id],
            }))}
          />
        </Field>
      </div>

      <Field label="Channel or website URL" required hint="Your main profile, site, or newsletter page.">
        <Input
          type="url"
          value={channelUrl}
          onChange={(e) => setChannelUrl(e.target.value)}
          required
          autoComplete="url"
          placeholder="https://"
        />
      </Field>

      <Field
        label="Tell us about yourself"
        required
        hint="Who you reach and how you'd share Childbook Studio — a few sentences is plenty."
      >
        <Textarea
          rows={5}
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          required
          minLength={20}
          placeholder="I create content for parents of young kids and would love to recommend personalized books…"
        />
      </Field>

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
          We use your details only to review your application and reply.
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
          Submit application
        </Button>
      </div>
    </form>
  );
}
