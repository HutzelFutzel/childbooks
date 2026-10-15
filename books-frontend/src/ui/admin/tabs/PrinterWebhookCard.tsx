"use client";

/**
 * System health → the printer's status webhook.
 *
 * Order status reaches us two ways: the printer calls our webhook (fast), and a
 * scheduled poll asks (slow, always on). The webhook is what makes shipping
 * emails arrive in minutes rather than a quarter hour, and Lulu switches it off
 * on its own when our endpoint fails a few times — so this shows what is
 * registered right now, and lets an admin register, test or remove it without
 * leaving the dashboard or knowing the URL.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Send, Trash2, XCircle } from "lucide-react";
import { backendFetch } from "../../../platform/backend";
import { Button } from "../../components/Button";
import { cn } from "../../lib/cn";

interface Webhook {
  id: string;
  url: string;
  isActive: boolean;
  topics?: string[];
}

async function call<T>(path: string, method: "GET" | "POST" | "DELETE" = "GET"): Promise<T> {
  const res = await backendFetch(path, {
    method,
    ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
  });
  if (!res.ok) {
    let message = "Request failed.";
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function PrinterWebhookCard() {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      setHooks(await call<Webhook[]>("/admin/print/webhooks"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      setHooks(await call<Webhook[]>("/admin/print/webhooks"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const active = hooks?.some((h) => h.isActive) ?? false;

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-xl",
              hooks === null
                ? "bg-ink-50 text-ink-500"
                : active
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-amber-50 text-amber-600",
            )}
          >
            <Link2 className="size-4.5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-800">Printer status webhook</p>
            <p className="text-xs text-ink-500">
              {hooks === null
                ? "Checking what the printer has registered…"
                : active
                  ? "Active — order updates arrive within minutes."
                  : "None active — updates arrive via the 15-minute poll until one is registered."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            loading={busy === "load"}
            leftIcon={busy !== "load" ? <RefreshCw className="size-4" /> : undefined}
          >
            Refresh
          </Button>
          {!active && hooks !== null ? (
            <Button
              size="sm"
              onClick={() =>
                void run("register", () => call("/admin/print/webhooks", "POST"), "Webhook registered.")
              }
              loading={busy === "register"}
            >
              Register webhook
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}
      {notice ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="size-4 shrink-0" />
          {notice}
        </p>
      ) : null}

      {hooks && hooks.length > 0 ? (
        <ul className="mt-3 divide-y divide-ink-100 text-sm">
          {hooks.map((hook) => (
            <li key={hook.id} className="flex flex-wrap items-center gap-3 py-2">
              {hook.isActive ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="size-4 shrink-0 text-rose-500" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-700" title={hook.url}>
                {hook.url}
              </span>
              <span className="text-xs text-ink-400">{hook.isActive ? "active" : "inactive"}</span>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Send className="size-4" />}
                loading={busy === `test:${hook.id}`}
                onClick={() =>
                  void run(
                    `test:${hook.id}`,
                    () => call(`/admin/print/webhooks/${encodeURIComponent(hook.id)}/test`, "POST"),
                    "Test sent — it appears under Orders → Printer connection as the last webhook received.",
                  )
                }
              >
                Send test
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Trash2 className="size-4" />}
                loading={busy === `delete:${hook.id}`}
                onClick={() =>
                  void run(
                    `delete:${hook.id}`,
                    () => call(`/admin/print/webhooks/${encodeURIComponent(hook.id)}`, "DELETE"),
                    "Webhook removed.",
                  )
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
