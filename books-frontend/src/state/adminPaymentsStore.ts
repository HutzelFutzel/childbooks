/**
 * Client store for the admin "Payments" analysis view.
 *
 * Pulls aggregates + a recent payment list from the admin-gated `/admin/payments*`
 * routes, and exposes a refund action + a Stripe connection health check. The
 * browser can't read the `payments/{id}` collection directly (rules deny it), so
 * everything goes through the backend.
 */
import { create } from "zustand";
import { backendFetch } from "../platform/backend";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded" | "partially_refunded";

export interface PaymentListItem {
  id: string;
  ownerUid: string;
  status: PaymentStatus;
  kind: "order" | "subscription";
  amount: number;
  currency: string;
  refundedAmount: number;
  feeAmount: number | null;
  netAmount: number | null;
  description: string;
  receiptUrl: string | null;
  orderId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: number | null;
}

export interface CurrencyRollup {
  currency: string;
  grossVolume: number;
  netVolume: number;
  fees: number;
  refunds: number;
  orderCount: number;
  paidCount: number;
  refundCount: number;
  averageOrderValue: number;
}

export interface PaymentsAnalytics {
  windowDays: number;
  byCurrency: CurrencyRollup[];
  series: { date: string; currency: string; gross: number; count: number }[];
  totalPayments: number;
  pendingCount: number;
  failedCount: number;
}

export interface HealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
}

export interface StripeHealthReport {
  environment: "sandbox" | "live";
  ok: boolean;
  checks: HealthCheck[];
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? null;
  } catch {
    return null;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await backendFetch(path);
  if (!res.ok) throw new Error((await safeError(res)) ?? "Request failed.");
  return (await res.json()) as T;
}

interface AdminPaymentsState {
  days: number;
  analytics: PaymentsAnalytics | null;
  payments: PaymentListItem[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refundingId: string | null;

  health: StripeHealthReport | null;
  healthLoading: boolean;
  healthError: string | null;

  setDays: (days: number) => void;
  refresh: () => Promise<void>;
  refund: (id: string, amount?: number) => Promise<void>;
  checkHealth: () => Promise<void>;
}

export const useAdminPayments = create<AdminPaymentsState>((set, get) => ({
  days: 30,
  analytics: null,
  payments: [],
  loading: false,
  error: null,
  lastUpdated: null,
  refundingId: null,

  health: null,
  healthLoading: false,
  healthError: null,

  setDays(days) {
    set({ days });
    void get().refresh();
  },

  async refresh() {
    const { days } = get();
    set({ loading: true, error: null });
    try {
      const [analytics, list] = await Promise.all([
        getJson<PaymentsAnalytics>(`/admin/payments/analytics?days=${days}`),
        getJson<{ payments: PaymentListItem[] }>(`/admin/payments?days=${days}`),
      ]);
      set({ analytics, payments: list.payments, lastUpdated: Date.now() });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load payments." });
    } finally {
      set({ loading: false });
    }
  },

  async refund(id, amount) {
    set({ refundingId: id, error: null });
    try {
      const res = await backendFetch(`/admin/payments/${encodeURIComponent(id)}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(amount ? { amount } : {}),
      });
      if (!res.ok) throw new Error((await safeError(res)) ?? "Refund failed.");
      // The webhook updates the record; refresh shortly after so the UI reflects it.
      await new Promise((r) => setTimeout(r, 1200));
      await get().refresh();
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Refund failed." });
    } finally {
      set({ refundingId: null });
    }
  },

  async checkHealth() {
    set({ healthLoading: true, healthError: null });
    try {
      const report = await getJson<StripeHealthReport>("/admin/stripe/health");
      set({ health: report });
    } catch (err) {
      set({ healthError: (err as Error)?.message ?? "Health check failed." });
    } finally {
      set({ healthLoading: false });
    }
  },
}));
