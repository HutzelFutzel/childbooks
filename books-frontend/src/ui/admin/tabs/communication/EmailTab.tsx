"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eye, Send } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input, Textarea } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { backendFetch } from "../../../../platform/backend";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import type { EmailConfig, EmailTemplateSettings } from "../../../../core/config/emailConfig";
import { sumRecentDays, zeroCounts } from "../../../../core/config/emailStats";
import { EMAIL_TEMPLATES, renderSample } from "../../../../core/email/registry";
import type {
  BrandContext,
  EmailSenderKey,
  EmailTemplateId,
  RenderContext,
} from "../../../../core/email/types";
import { Grid, NumberField, Section, TextField } from "../products/parts";

const SENDER_OPTIONS: { value: EmailSenderKey; label: string }[] = [
  { value: "default", label: "Default (noreply)" },
  { value: "support", label: "Support" },
  { value: "marketing", label: "Marketing" },
];

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/**
 * Communication → Transactional emails. Edits the world-readable
 * `appConfig/emailConfig` (senders, master switch, per-template toggles +
 * subject overrides + send delay, footer, daily cap), shows live ZeptoMail
 * delivery statistics from `appConfig/emailStats`, previews each code template
 * with the live brand kit, and sends test emails.
 */
export function EmailTab() {
  const stored = useAppConfigStore((s) => s.emailConfig);
  const stats = useAppConfigStore((s) => s.emailStats);
  const branding = useAppConfigStore((s) => s.branding);
  const seo = useAppConfigStore((s) => s.seo);
  const save = useAppConfigStore((s) => s.saveEmailConfig);
  const sendTest = useAppConfigStore((s) => s.sendTestEmail);

  const [draft, setDraft] = useState<EmailConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState<EmailTemplateId | null>(null);
  const [testing, setTesting] = useState<EmailTemplateId | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  // One-off: learn whether the ZeptoMail token secret is present.
  useEffect(() => {
    let alive = true;
    backendFetch("/admin/config/email")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) setConfigured(Boolean((j as { configured?: boolean }).configured));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const set = (patch: Partial<EmailConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setGlobal = (patch: Partial<EmailConfig["global"]>) =>
    set({ global: { ...draft.global, ...patch } });
  const setSenders = (patch: Partial<EmailConfig["senders"]>) =>
    set({ senders: { ...draft.senders, ...patch } });
  const setTemplate = (id: EmailTemplateId, patch: Partial<EmailTemplateSettings>) =>
    set({ templates: { ...draft.templates, [id]: { ...draft.templates[id], ...patch } } });

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Email settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save email settings.");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (id: EmailTemplateId) => {
    setTesting(id);
    try {
      await sendTest(id);
      toast.success("Test email sent — check your inbox.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test send failed.");
    } finally {
      setTesting(null);
    }
  };

  // Brand context for previews, projected from the live brand kit + SEO site URL.
  const previewCtx = useMemo<Omit<RenderContext, "category">>(() => {
    const brand: BrandContext = {
      brandName: branding.brandName || seo.siteName || "Childbook Studio",
      tagline: branding.tagline || "",
      logoUrl: branding.logo?.imageUrl ?? null,
      logoDarkUrl: branding.logoDark?.imageUrl ?? null,
      iconUrl: branding.icon?.imageUrl ?? null,
      primaryColor: branding.colors.primary,
      accentColor: branding.colors.accent,
      siteUrl: seo.siteUrl || "https://childbook.studio",
    };
    return {
      brand,
      footer: {
        footerText: draft.global.footerText,
        supportEmail: draft.global.supportEmail,
        supportUrl: draft.global.supportUrl,
        unsubscribeUrl: draft.global.unsubscribeUrl || null,
        physicalAddress: draft.global.physicalAddress,
      },
    };
  }, [branding, seo, draft.global]);

  const previewHtml = useMemo(() => {
    if (!previewId) return "";
    const meta = EMAIL_TEMPLATES.find((t) => t.id === previewId);
    return renderSample(previewId, { ...previewCtx, category: meta?.category ?? "transactional" }).html;
  }, [previewId, previewCtx]);

  const recent = useMemo(() => sumRecentDays(stats, 30), [stats]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Transactional email, sent via ZeptoMail. Toggles, senders, subject
          overrides and the footer are stored in Firebase and applied immediately —
          no deploy. The API token + webhook secret live in Cloud Secret Manager.
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(stored);
                setDirty(false);
              }}
            >
              Discard
            </Button>
          )}
          <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
            Save email settings
          </Button>
        </div>
      </div>

      {configured === false && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Email isn&apos;t fully configured yet — set the <code>ZEPTOMAIL_TOKEN</code>{" "}
            secret and deploy the functions before sending will work. You can still edit
            settings and preview templates here.
          </span>
        </div>
      )}

      {/* ---- Delivery snapshot (last 30 days) ---- */}
      <Section title="Delivery (last 30 days)" hint="Aggregate outcomes reported by ZeptoMail webhooks.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Sent" value={recent.sent} />
          <Stat label="Delivered" value={recent.delivered} sub={pct(recent.delivered, recent.sent)} />
          <Stat label="Opened" value={recent.opened} sub={pct(recent.opened, recent.delivered)} />
          <Stat label="Clicked" value={recent.clicked} sub={pct(recent.clicked, recent.delivered)} />
          <Stat label="Bounced" value={recent.bounced} sub={pct(recent.bounced, recent.sent)} tone="warn" />
          <Stat label="Complaints" value={recent.complained} sub={pct(recent.complained, recent.sent)} tone="warn" />
        </div>
      </Section>

      {/* ---- Master switch + footer ---- */}
      <Section title="Global" hint="Master switch, contact footer, and a daily safety cap.">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <Toggle
            checked={draft.global.enabled}
            onChange={(v) => setGlobal({ enabled: v })}
            label="Sending enabled"
          />
          Sending enabled {draft.global.enabled ? "" : "— all email is paused"}
        </label>
        <Grid cols={2}>
          <TextField
            label="Support email (footer + reply target)"
            value={draft.global.supportEmail}
            onChange={(v) => setGlobal({ supportEmail: v })}
          />
          <TextField
            label="Help / contact URL"
            value={draft.global.supportUrl}
            onChange={(v) => setGlobal({ supportUrl: v })}
          />
        </Grid>
        <Grid cols={2}>
          <TextField
            label="Unsubscribe URL (marketing only)"
            value={draft.global.unsubscribeUrl}
            onChange={(v) => setGlobal({ unsubscribeUrl: v })}
          />
          <NumberField
            label="Daily send cap (0 = unlimited)"
            value={draft.global.maxDailySends}
            onChange={(n) => setGlobal({ maxDailySends: n })}
          />
        </Grid>
        <TextField
          label="Footer legal line"
          value={draft.global.footerText}
          onChange={(v) => setGlobal({ footerText: v })}
        />
        <Field label="Postal address (shown in footer; recommended for marketing)">
          <Textarea
            rows={2}
            value={draft.global.physicalAddress}
            onChange={(e) => setGlobal({ physicalAddress: e.target.value })}
          />
        </Field>
      </Section>

      {/* ---- Sender identities ---- */}
      <Section
        title="Sender identities"
        hint={`Format: Name <address@domain>. The address domain must be verified in ZeptoMail.`}
      >
        <Grid cols={2}>
          <TextField
            label="Default sender"
            value={draft.senders.default}
            placeholder="Childbook Studio <noreply@childbook.studio>"
            onChange={(v) => setSenders({ default: v })}
          />
          <TextField
            label="Reply-to (a monitored inbox)"
            value={draft.senders.replyTo}
            placeholder="hello@childbook.studio"
            onChange={(v) => setSenders({ replyTo: v })}
          />
          <TextField
            label="Support sender"
            value={draft.senders.support}
            onChange={(v) => setSenders({ support: v })}
          />
          <TextField
            label="Marketing sender"
            value={draft.senders.marketing}
            onChange={(v) => setSenders({ marketing: v })}
          />
        </Grid>
      </Section>

      {/* ---- Per-template controls ---- */}
      <Section title="Templates" hint="Toggle each email, pick its sender, override the subject, preview it, and send a test.">
        <div className="space-y-2">
          {EMAIL_TEMPLATES.map((meta) => {
            const t = draft.templates[meta.id];
            const s = stats.templates[meta.id] ?? zeroCounts();
            const lastSent = stats.lastSentAt[meta.id];
            return (
              <div
                key={meta.id}
                className="space-y-2.5 rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink-800">{meta.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          meta.category === "marketing"
                            ? "bg-accent-100 text-accent-700"
                            : "bg-ink-100 text-ink-500"
                        }`}
                      >
                        {meta.category}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{meta.description}</p>
                  </div>
                  <Toggle
                    checked={t.enabled}
                    onChange={(v) => setTemplate(meta.id, { enabled: v })}
                    label={`${meta.label} enabled`}
                  />
                </div>

                <Grid cols={3}>
                  <Field label="Sender">
                    <Select
                      value={t.senderKey}
                      options={SENDER_OPTIONS}
                      onChange={(e) => setTemplate(meta.id, { senderKey: e.target.value as EmailSenderKey })}
                    />
                  </Field>
                  <Field label="Subject override (optional)" className="sm:col-span-2">
                    <Input
                      value={t.subjectOverride}
                      placeholder="Leave blank to use the template default"
                      onChange={(e) => setTemplate(meta.id, { subjectOverride: e.target.value })}
                    />
                  </Field>
                </Grid>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-400">
                    <span>Sent {s.sent}</span>
                    <span>Delivered {pct(s.delivered, s.sent)}</span>
                    <span>Open {pct(s.opened, s.delivered)}</span>
                    <span>Click {pct(s.clicked, s.delivered)}</span>
                    {lastSent && <span>Last {new Date(lastSent).toLocaleDateString()}</span>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Eye className="size-3.5" />}
                      onClick={() => setPreviewId(previewId === meta.id ? null : meta.id)}
                    >
                      {previewId === meta.id ? "Hide" : "Preview"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Send className="size-3.5" />}
                      loading={testing === meta.id}
                      onClick={() => onTest(meta.id)}
                    >
                      Send test
                    </Button>
                  </div>
                </div>

                {previewId === meta.id && (
                  <iframe
                    title={`${meta.label} preview`}
                    srcDoc={previewHtml}
                    className="h-[520px] w-full rounded-lg border border-ink-100 bg-white"
                  />
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-lg bg-white p-2.5 ring-1 ring-inset ring-ink-100">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`text-lg font-semibold ${tone === "warn" && value > 0 ? "text-amber-600" : "text-ink-800"}`}>
        {value.toLocaleString()}
      </div>
      {sub && <div className="text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}
