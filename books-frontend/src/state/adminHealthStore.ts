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
}

export const useAdminHealth = create<AdminHealthState>((set) => ({
  report: null,
  loading: false,
  error: null,

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
}));
