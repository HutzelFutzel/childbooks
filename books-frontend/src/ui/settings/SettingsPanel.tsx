import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, XCircle } from "lucide-react";
import type { ProviderId } from "../../core/config/options";
import { useSettingsStore } from "../../state/settingsStore";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Drawer } from "../components/Drawer";
import { Field, Input } from "../components/Input";
import { notify } from "../lib/notify";

const PROVIDER_META: Record<ProviderId, { label: string; help: string; link: string }> = {
  openai: {
    label: "OpenAI",
    help: "Used for GPT text models and GPT Image generation.",
    link: "https://platform.openai.com/api-keys",
  },
  google: {
    label: "Google Gemini",
    help: "Used for Gemini text models and Nano Banana image generation.",
    link: "https://aistudio.google.com/app/apikey",
  },
};

function ProviderRow({ provider }: { provider: ProviderId }) {
  const meta = PROVIDER_META[provider];
  const settings = useSettingsStore((s) => s.settings);
  const connection = useSettingsStore((s) => s.connections[provider]);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const saveKey = useSettingsStore((s) => s.saveKey);
  const testConnection = useSettingsStore((s) => s.testConnection);
  const [reveal, setReveal] = useState(false);

  const value = settings.apiKeys[provider] ?? "";

  const handleTest = async () => {
    await saveKey(provider);
    await testConnection(provider);
    const conn = useSettingsStore.getState().connections[provider];
    if (conn.status === "ok") {
      notify.success(`${meta.label} connected`, conn.message);
    } else if (conn.status === "error") {
      notify.error(conn.message ?? `Could not reach ${meta.label}`);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-ink-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink-800">{meta.label}</span>
          {connection.status === "ok" && (
            <Badge tone="success">
              <CheckCircle2 className="size-3" /> Connected
            </Badge>
          )}
          {connection.status === "error" && (
            <Badge tone="danger">
              <XCircle className="size-3" /> Failed
            </Badge>
          )}
        </div>
        <a
          href={meta.link}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-brand-600 hover:underline"
        >
          Get a key
        </a>
      </div>

      <Field hint={connection.message ?? meta.help} error={connection.status === "error" ? connection.message : undefined}>
        <div className="relative">
          <Input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(e) => setApiKey(provider, e.target.value)}
            placeholder={`Enter your ${meta.label} API key`}
            className="pr-10 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
            aria-label={reveal ? "Hide key" : "Show key"}
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          loading={connection.status === "testing"}
          disabled={!value.trim()}
          onClick={handleTest}
        >
          Save & test
        </Button>
      </div>
    </div>
  );
}

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const load = useSettingsStore((s) => s.load);
  const loaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  return (
    <Drawer open={open} onClose={onClose} title="Settings">
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          <p>
            Your API keys are stored locally on this device only and are used to talk to the
            providers directly. They are never sent anywhere else.
          </p>
        </div>
        <ProviderRow provider="openai" />
        <ProviderRow provider="google" />
      </div>
    </Drawer>
  );
}
