"use client";

/**
 * The decision queue: payouts a rule's approval step, a limit, a budget or a
 * failed delivery stopped, waiting on a human.
 *
 * Releasing pays regardless of the limit that held it. That's deliberate — the
 * limits exist to make an operator look, not to decide for them — and the copy
 * says so, because a queue whose buttons an operator doesn't trust is a queue
 * that grows forever.
 *
 * Loaded on mount and refreshed after every decision rather than polled: an
 * operator working the queue is the only thing that changes it, and stale rows
 * would let two admins pay the same reward twice (the backend is idempotent, but
 * the confusion isn't worth it).
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/Button";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { useAdminAccess } from "../../../../state/adminAccessStore";
import type { HeldRedemptionView } from "../../../../core/config/campaigns";
import { Section, fmtMoney } from "../products/parts";

export function HeldPayoutsPanel({ currency }: { currency: string }) {
  const canDangerous = useAdminAccess((s) => s.can("dangerous"));
  const loadHeld = useAppConfigStore((s) => s.loadHeldRedemptions);
  const resolve = useAppConfigStore((s) => s.resolveHeldRedemption);
  const [held, setHeld] = useState<HeldRedemptionView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void loadHeld()
      .then(setHeld)
      .catch(() => setHeld([]))
      .finally(() => setLoaded(true));
  }, [loadHeld]);

  useEffect(refresh, [refresh]);

  // Nothing to decide is the normal state, and an empty panel is noise.
  if (!loaded || held.length === 0) return null;

  const act = async (row: HeldRedemptionView, verdict: "release" | "void") => {
    if (
      verdict === "void" &&
      !window.confirm(`Void "${row.summary}"? It will never be paid. This cannot be undone.`)
    ) {
      return;
    }
    setBusy(row.id);
    try {
      await resolve(row.id, verdict);
      toast.success(verdict === "release" ? "Payout delivered." : "Payout voided.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this payout.");
      refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title={`Held payouts (${held.length})`}
      hint="Payouts stopped by an approval step, a limit, the daily budget, or a failed delivery. Releasing pays regardless of the limit that held it — the limits exist to make you look, not to decide for you."
    >
      <div className="space-y-2">
        {held.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-amber-50/60 px-3 py-2.5 ring-1 ring-inset ring-amber-100"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-800">
                <span className="font-semibold">{row.summary}</span>{" "}
                <span className="text-ink-500">to {row.email ?? row.uid.slice(0, 10)}</span>
              </p>
              <p className="text-[11px] text-ink-500">
                {row.campaignName} · {row.unlocks} · {fmtMoney(row.cost, currency)} ·{" "}
                {new Date(row.createdAt).toLocaleDateString()}
              </p>
              {row.note && <p className="mt-0.5 text-[11px] text-amber-800">{row.note}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              {canDangerous ? (
                <>
                  <Button type="button" size="sm" loading={busy === row.id} onClick={() => void act(row, "release")}>
                    Pay out
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy === row.id}
                    onClick={() => void act(row, "void")}
                  >
                    Void
                  </Button>
                </>
              ) : (
                <span className="text-[11px] text-ink-400">Owner action</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
