"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useAdminPayments, type HealthCheck } from "../../../state/adminPaymentsStore";
import { Button } from "../../components/Button";
import { cn } from "../../lib/cn";

const ICON = {
  pass: <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />,
  warn: <AlertTriangle className="size-4 shrink-0 text-amber-500" />,
  fail: <XCircle className="size-4 shrink-0 text-rose-500" />,
} as const;

/**
 * "Verify Stripe connection" — runs the backend health check and reports each
 * check (keys, account, webhook, tax, portal) with a precise fix when failing.
 */
export function StripeHealthCard() {
  const health = useAdminPayments((s) => s.health);
  const loading = useAdminPayments((s) => s.healthLoading);
  const error = useAdminPayments((s) => s.healthError);
  const check = useAdminPayments((s) => s.checkHealth);
  const [expanded, setExpanded] = useState(true);

  const fails = health?.checks.filter((c) => c.status === "fail").length ?? 0;
  const warns = health?.checks.filter((c) => c.status === "warn").length ?? 0;

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-xl",
              !health
                ? "bg-ink-50 text-ink-500"
                : health.ok
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-rose-50 text-rose-600",
            )}
          >
            <ShieldCheck className="size-4.5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-800">Stripe connection</p>
            <p className="text-xs text-ink-500">
              {health
                ? `${health.environment} · ${
                    health.ok ? "all critical checks pass" : `${fails} failing`
                  }${warns ? ` · ${warns} warning${warns > 1 ? "s" : ""}` : ""}`
                : "Verify keys, webhooks, tax and portal are correctly wired."}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void check()}
          loading={loading}
          leftIcon={!loading ? <ShieldCheck className="size-4" /> : undefined}
        >
          {health ? "Re-verify" : "Verify connection"}
        </Button>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {health && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-medium text-ink-500 hover:text-ink-700"
          >
            <span>
              {health.checks.length} check{health.checks.length === 1 ? "" : "s"}
            </span>
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
          </button>
          {expanded && (
            <ul className="mt-2 space-y-2">
              {health.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: HealthCheck }) {
  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-2.5 text-sm",
        check.status === "fail"
          ? "border-rose-200 bg-rose-50/50"
          : check.status === "warn"
            ? "border-amber-200 bg-amber-50/50"
            : "border-ink-100",
      )}
    >
      <div className="flex items-start gap-2">
        {ICON[check.status]}
        <div className="min-w-0">
          <p className="font-medium text-ink-800">{check.label}</p>
          <p className="mt-0.5 text-xs text-ink-600">{check.message}</p>
          {check.fix && check.status !== "pass" && (
            <p className="mt-1 text-xs text-ink-500">
              <span className="font-medium text-ink-700">Fix:</span> {check.fix}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
