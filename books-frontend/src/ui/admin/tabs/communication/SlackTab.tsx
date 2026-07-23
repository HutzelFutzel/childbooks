"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Send } from "lucide-react";
import { Button } from "../../../components/Button";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import type { SlackConfig } from "../../../../core/config/slackConfig";
import {
  SLACK_MESSAGES,
  type SlackChannel,
} from "../../../../core/notify/registry";
import { Section } from "../products/parts";

const CHANNEL_LABEL: Record<SlackChannel, string> = {
  growth: "#growth",
  ops: "#ops",
};

/**
 * Communication → Admin Slack. Edits the world-readable `appConfig/slackConfig`:
 * one on/off toggle per Slack message the product can send (all default ON), and
 * a "Send Test Notification" button that posts a real message to a channel to
 * verify the webhook. The webhook URLs themselves live in Cloud Secret Manager
 * (`SLACK_WEBHOOK_URL`, `SLACK_OPS_WEBHOOK_URL`).
 */
export function SlackTab() {
  const stored = useAppConfigStore((s) => s.slackConfig);
  const save = useAppConfigStore((s) => s.saveSlackConfig);
  const sendTest = useAppConfigStore((s) => s.sendTestSlack);

  const [draft, setDraft] = useState<SlackConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<SlackChannel | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const setMessage = (id: string, enabled: boolean) => {
    setDraft((d) => ({ ...d, messages: { ...d.messages, [id]: enabled } }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Slack settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save Slack settings.");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (channel: SlackChannel) => {
    setTesting(channel);
    try {
      await sendTest(channel);
      toast.success(`Test notification posted to ${CHANNEL_LABEL[channel]} — check Slack.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Slack test failed.");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Slack notifications for growth + operational events. Each message can be
          turned off individually (all default on); the change is stored in Firebase
          and applied immediately — no deploy. The webhook URLs live in Cloud Secret
          Manager (<code>SLACK_WEBHOOK_URL</code> for #growth,{" "}
          <code>SLACK_OPS_WEBHOOK_URL</code> for #ops).
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
            Save Slack settings
          </Button>
        </div>
      </div>

      {/* ---- Test the webhooks ---- */}
      <Section
        title="Send a test notification"
        hint="Posts a real message to the channel to confirm the webhook is wired up. Ignores the toggles below."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Send className="size-3.5" />}
            loading={testing === "growth"}
            onClick={() => onTest("growth")}
          >
            Test #growth
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Send className="size-3.5" />}
            loading={testing === "ops"}
            onClick={() => onTest("ops")}
          >
            Test #ops
          </Button>
        </div>
      </Section>

      {/* ---- Per-message toggles ---- */}
      <Section title="Messages" hint="Turn individual Slack notifications on or off.">
        <div className="space-y-2">
          {SLACK_MESSAGES.map((meta) => {
            const enabled = draft.messages[meta.id] !== false;
            return (
              <div
                key={meta.id}
                className="flex items-start justify-between gap-3 rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-800">{meta.label}</span>
                    <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
                      {CHANNEL_LABEL[meta.channel]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{meta.description}</p>
                  {meta.id === "admin_alert" && enabled === false && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-600">
                      <AlertTriangle className="size-3" />
                      Operational alerts are off — you won&apos;t be pinged about failures.
                    </p>
                  )}
                </div>
                <Toggle
                  checked={enabled}
                  onChange={(v) => setMessage(meta.id, v)}
                  label={`${meta.label} enabled`}
                />
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
