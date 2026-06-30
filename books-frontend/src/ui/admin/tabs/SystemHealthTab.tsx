"use client";

import { useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  Rocket,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  useAdminHealth,
  type BillingEnv,
  type HealthCheck,
  type HealthGroup,
} from "../../../state/adminHealthStore";
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
      <ModeCard />

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

/**
 * Sandbox↔live mode switch. Flipping the whole backend (Stripe + Lulu) between
 * environments at runtime — no redeploy. Going live is gated by a readiness
 * probe (live keys bound, account active, webhooks + live plan prices present).
 */
function ModeCard() {
  const runtime = useAdminHealth((s) => s.runtime);
  const readiness = useAdminHealth((s) => s.readiness);
  const readinessLoading = useAdminHealth((s) => s.readinessLoading);
  const switching = useAdminHealth((s) => s.switching);
  const modeError = useAdminHealth((s) => s.modeError);
  const loadRuntime = useAdminHealth((s) => s.loadRuntime);
  const checkReadiness = useAdminHealth((s) => s.checkReadiness);
  const switchEnv = useAdminHealth((s) => s.switchEnv);

  useEffect(() => {
    if (!runtime) void loadRuntime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active: BillingEnv = runtime?.env ?? "sandbox";
  const isLive = active === "live";

  const onSwitch = async (env: BillingEnv) => {
    if (env === active) return;
    const ok = await switchEnv(env);
    // If live was blocked, the readiness report is now populated for review.
    if (!ok && env === "live") void checkReadiness("live");
  };

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-xl",
              isLive ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-600",
            )}
          >
            {isLive ? <Rocket className="size-4.5" /> : <FlaskConical className="size-4.5" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-800">
              Mode: <span className={isLive ? "text-rose-600" : "text-sky-600"}>{isLive ? "Live" : "Sandbox"}</span>
            </p>
            <p className="text-xs text-ink-500">
              {isLive
                ? "Real charges and real print orders. Stripe + Lulu use live credentials."
                : "Test mode — no real money, no real prints. Stripe + Lulu use sandbox credentials."}
              {runtime && !runtime.liveSecretsBound && (
                <>
                  {" "}
                  Live secrets are not deployed — redeploy with <code className="rounded bg-ink-50 px-1 py-0.5">LIVE_ENABLED=true</code>.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="inline-flex overflow-hidden rounded-xl ring-1 ring-inset ring-ink-200">
          <button
            type="button"
            disabled={switching}
            onClick={() => void onSwitch("sandbox")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
              !isLive ? "bg-sky-500 text-white" : "bg-white text-ink-600 hover:bg-ink-50",
            )}
          >
            Sandbox
          </button>
          <button
            type="button"
            disabled={switching}
            onClick={() => void onSwitch("live")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
              isLive ? "bg-rose-500 text-white" : "bg-white text-ink-600 hover:bg-ink-50",
            )}
          >
            Live
          </button>
        </div>
      </div>

      {modeError && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {modeError}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void checkReadiness("live")}
          loading={readinessLoading}
          leftIcon={!readinessLoading ? <Rocket className="size-4" /> : undefined}
        >
          Check go-live readiness
        </Button>
        {readiness && (
          <span className={cn("text-xs font-medium", readiness.ok ? "text-emerald-600" : "text-rose-600")}>
            {readiness.ok ? "Ready to go live." : "Not ready — see below."}
          </span>
        )}
      </div>

      {readiness && (
        <div className="mt-3 space-y-3">
          {readiness.groups.map((group) => (
            <GroupCard key={`readiness-${group.id}`} group={group} />
          ))}
          {!readiness.ok && (
            <p className="text-xs text-ink-500">
              Resolve the failing checks, then switch to Live. You can force the switch with the Live
              button after the live secrets are deployed, but checkout will fail until prices exist in live.
            </p>
          )}
        </div>
      )}
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
