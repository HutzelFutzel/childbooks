"use client";

import { useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useAdminHealth, type HealthCheck, type HealthGroup } from "../../../state/adminHealthStore";
import { Button } from "../../components/Button";
import { cn } from "../../lib/cn";

const ICON = {
  pass: <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />,
  warn: <AlertTriangle className="size-4 shrink-0 text-amber-500" />,
  fail: <XCircle className="size-4 shrink-0 text-rose-500" />,
} as const;

/**
 * "System health" — runs the backend `/admin/health` probe and reports each
 * dependency (AI providers, Lulu, Stripe, Storage, config) with a precise fix
 * when something is wrong. Read-only: it never shows or sets secret values.
 */
export function SystemHealthTab() {
  const report = useAdminHealth((s) => s.report);
  const loading = useAdminHealth((s) => s.loading);
  const error = useAdminHealth((s) => s.error);
  const check = useAdminHealth((s) => s.check);

  // Run once when the tab opens so the admin sees status without an extra click.
  useEffect(() => {
    if (!report && !loading) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = report
    ? report.groups
        .flatMap((g) => g.checks)
        .reduce(
          (acc, c) => {
            acc[c.status] += 1;
            return acc;
          },
          { pass: 0, warn: 0, fail: 0 } as Record<HealthCheck["status"], number>,
        )
    : null;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-ink-100 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-xl",
                !report
                  ? "bg-ink-50 text-ink-500"
                  : report.ok
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-rose-50 text-rose-600",
              )}
            >
              <ShieldCheck className="size-4.5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-800">System health</p>
              <p className="text-xs text-ink-500">
                {report
                  ? `Print: ${report.environment.lulu} · Payments: ${report.environment.stripe}${
                      totals ? ` · ${totals.fail} failing, ${totals.warn} warning(s)` : ""
                    }`
                  : "Verify AI keys, Lulu, Stripe, Storage and config are correctly wired."}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void check()}
            loading={loading}
            leftIcon={!loading ? <RefreshCw className="size-4" /> : undefined}
          >
            {report ? "Re-run checks" : "Run checks"}
          </Button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {report && (
          <p className="mt-3 text-xs text-ink-400">
            Last run {new Date(report.generatedAt).toLocaleTimeString()}. Secrets are checked, never
            shown — set them with{" "}
            <code className="rounded bg-ink-50 px-1 py-0.5">firebase functions:secrets:set</code>.
          </p>
        )}
      </div>

      {report?.groups.map((group) => <GroupCard key={group.id} group={group} />)}
    </div>
  );
}

function GroupCard({ group }: { group: HealthGroup }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        {group.ok ? ICON.pass : ICON.fail}
        <p className="text-sm font-semibold text-ink-800">{group.label}</p>
      </div>
      <ul className="space-y-2">
        {group.checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>
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
