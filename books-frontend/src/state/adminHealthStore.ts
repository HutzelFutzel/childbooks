/**
 * Client store for the admin "System health" tab.
 *
 * Pulls a live diagnostic report from the admin-gated `/admin/health` route,
 * which probes every external dependency (AI providers, Lulu, Stripe, Storage)
 * plus a few config sanity checks. The report contains only pass/warn/fail
 * statuses — never secret values.
 */
import { create } from "zustand";
import { backendFetch } from "../platform/backend";

export type CheckStatus = "pass" | "warn" | "fail";

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

export interface HealthGroup {
  id: string;
  label: string;
  ok: boolean;
  checks: HealthCheck[];
}

export interface SystemHealthReport {
  ok: boolean;
  generatedAt: number;
  environment: { lulu: "sandbox" | "live"; stripe: "sandbox" | "live" };
  groups: HealthGroup[];
}

export type BillingEnv = "sandbox" | "live";

/** Active/default environment + whether live secrets are deployed. */
export interface RuntimeEnvState {
  env: BillingEnv;
  override: BillingEnv | null;
  default: BillingEnv;
  liveSecretsBound: boolean;
}

export interface ReadinessReport {
  env: BillingEnv;
  ok: boolean;
  generatedAt: number;
  secretsBound: boolean;
  groups: HealthGroup[];
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? null;
  } catch {
    return null;
  }
}

interface AdminHealthState {
  report: SystemHealthReport | null;
  loading: boolean;
  error: string | null;
  check: () => Promise<void>;

  // Sandbox↔live mode + go-live readiness.
  runtime: RuntimeEnvState | null;
  readiness: ReadinessReport | null;
  readinessLoading: boolean;
  switching: boolean;
  modeError: string | null;
  loadRuntime: () => Promise<void>;
  checkReadiness: (env?: BillingEnv) => Promise<void>;
  /** Returns true when the switch succeeded; on a blocked live switch returns false and stores the readiness report. */
  switchEnv: (env: BillingEnv, force?: boolean) => Promise<boolean>;
}

export const useAdminHealth = create<AdminHealthState>((set, get) => ({
  report: null,
  loading: false,
  error: null,
  runtime: null,
  readiness: null,
  readinessLoading: false,
  switching: false,
  modeError: null,

  async check() {
    set({ loading: true, error: null });
    try {
      const res = await backendFetch("/admin/health");
      if (!res.ok) throw new Error((await safeError(res)) ?? "Health check failed.");
      set({ report: (await res.json()) as SystemHealthReport });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Health check failed." });
    } finally {
      set({ loading: false });
    }
  },

  async loadRuntime() {
    set({ modeError: null });
    try {
      const res = await backendFetch("/admin/runtime");
      if (!res.ok) throw new Error((await safeError(res)) ?? "Couldn't load the environment.");
      set({ runtime: (await res.json()) as RuntimeEnvState });
    } catch (err) {
      set({ modeError: (err as Error)?.message ?? "Couldn't load the environment." });
    }
  },

  async checkReadiness(env: BillingEnv = "live") {
    set({ readinessLoading: true, modeError: null });
    try {
      const res = await backendFetch(`/admin/readiness?env=${env}`);
      if (!res.ok) throw new Error((await safeError(res)) ?? "Readiness check failed.");
      set({ readiness: (await res.json()) as ReadinessReport });
    } catch (err) {
      set({ modeError: (err as Error)?.message ?? "Readiness check failed." });
    } finally {
      set({ readinessLoading: false });
    }
  },

  async switchEnv(env: BillingEnv, force = false) {
    set({ switching: true, modeError: null });
    try {
      const res = await backendFetch("/admin/runtime", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, force }),
      });
      if (res.status === 409) {
        // Live not ready — surface the returned readiness report.
        const body = (await res.json()) as { error?: { message?: string }; readiness?: ReadinessReport };
        set({ readiness: body.readiness ?? null, modeError: body.error?.message ?? "Live environment is not ready." });
        return false;
      }
      if (!res.ok) throw new Error((await safeError(res)) ?? "Couldn't switch the environment.");
      await get().loadRuntime();
      await get().check();
      return true;
    } catch (err) {
      set({ modeError: (err as Error)?.message ?? "Couldn't switch the environment." });
      return false;
    } finally {
      set({ switching: false });
    }
  },
}));
