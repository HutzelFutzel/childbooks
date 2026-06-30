"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  CreditCard,
  DollarSign,
  FileText,
  Gauge,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { Button } from "../../components/Button";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab, type ConfigTabId } from "../adminTabStore";
import {
  IMAGE_ACTIONS,
  TEXT_ACTIONS,
  type ActionInfo,
  type ImageActionId,
  type TextActionId,
} from "../../../core/ai/actions";
import { resolveImageModel, resolveTextModel } from "../../../core/config/modelConfig";
import type { ModelSelection } from "../../../core/types";
import { costForUsage, costKey } from "../../../core/config/modelCosts";
import { sparksForCostUsd } from "../../../core/config/sparks";
import { QUOTAS } from "../../../core/config/quotas";
import type { PlanDefinition } from "../../../core/config/plans";

const PROVIDER_LABELS: Record<string, string> = { openai: "OpenAI", google: "Google" };

/** Image actions whose edit path is metered by the per-book edit quota. */
const EDIT_QUOTA_ACTIONS = new Set<string>(["pageIllustration", "coverIllustration"]);

function JumpButton({
  icon,
  label,
  tab,
}: {
  icon: React.ReactNode;
  label: string;
  tab: ConfigTabId;
}) {
  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  return (
    <Button variant="ghost" size="sm" leftIcon={icon} onClick={() => setConfigTab(tab)}>
      {label}
    </Button>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-ink-50 text-ink-500 ring-ink-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-xs text-ink-700">{children}</div>
    </div>
  );
}

/**
 * The **Actions hub** — one place that lists every AI action and, for each,
 * surfaces all of its configuration at a glance: the bound model, whether that
 * model has a configured cost, the Sparks price, which plans discount it, and
 * any per-plan usage limits. Each card deep-links to the precise editor (Models,
 * Model costs, Sparks, Plans) so an action's whole config is reachable from here.
 */
export function ActionsTab() {
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  const modelCosts = useAppConfigStore((s) => s.modelCosts);
  const sparks = useAppConfigStore((s) => s.sparks);
  const publicPlans = useAppConfigStore((s) => s.plans.plans);
  const loadAdminPlans = useAppConfigStore((s) => s.loadAdminPlans);

  // The public plan projection omits actionMultipliers, so pull the full admin
  // config once for the Spark-discount summary (limits come from public plans).
  const [adminPlans, setAdminPlans] = useState<PlanDefinition[]>([]);
  useEffect(() => {
    let alive = true;
    loadAdminPlans()
      .then((cfg) => alive && setAdminPlans(cfg.plans))
      .catch(() => {
        /* non-fatal: discounts summary just stays empty */
      });
    return () => {
      alive = false;
    };
  }, [loadAdminPlans]);

  const planNameById = useMemo(
    () => Object.fromEntries(adminPlans.map((p) => [p.id, p.presentation.name])),
    [adminPlans],
  );

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
        Every AI action in one place. Each card shows the model it runs on, its cost coverage, the
        Sparks price, the subscription perks that touch it (discounts + limits), and a jump to the
        exact editor. This is the map of how an action is wired across the config.
      </p>

      <div className="space-y-3">
        <SectionHeader icon={<FileText className="size-3.5 text-sky-500" />} label="Text actions" />
        {TEXT_ACTIONS.map((a) => (
          <ActionCard
            key={a.id}
            action={a}
            modality="text"
            model={resolveTextModel(modelConfig, a.id as TextActionId)}
            modelCosts={modelCosts}
            sparks={sparks}
            publicPlans={publicPlans}
            adminPlans={adminPlans}
            planNameById={planNameById}
          />
        ))}

        <SectionHeader icon={<ImageIcon className="size-3.5 text-violet-500" />} label="Image actions" />
        {IMAGE_ACTIONS.map((a) => (
          <ActionCard
            key={a.id}
            action={a}
            modality="image"
            model={resolveImageModel(modelConfig, a.id as ImageActionId)}
            modelCosts={modelCosts}
            sparks={sparks}
            publicPlans={publicPlans}
            adminPlans={adminPlans}
            planNameById={planNameById}
          />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 pt-1 text-xs font-semibold text-ink-600">
      {icon}
      {label}
    </div>
  );
}

function ActionCard({
  action,
  modality,
  model,
  modelCosts,
  sparks,
  publicPlans,
  adminPlans,
  planNameById,
}: {
  action: ActionInfo<string>;
  modality: "text" | "image";
  model: ModelSelection | null;
  modelCosts: ReturnType<typeof useAppConfigStore.getState>["modelCosts"];
  sparks: ReturnType<typeof useAppConfigStore.getState>["sparks"];
  publicPlans: ReturnType<typeof useAppConfigStore.getState>["plans"]["plans"];
  adminPlans: PlanDefinition[];
  planNameById: Record<string, string>;
}) {
  const accent = modality === "text" ? "border-l-sky-300" : "border-l-violet-300";

  // Model + cost coverage.
  const modelLabel = model ? `${PROVIDER_LABELS[model.provider] ?? model.provider} · ${model.id}` : null;
  const hasCost = model ? !!modelCosts.models[costKey(model.provider, model.id)] : false;

  // Sparks price summary.
  const rule = sparks.actions[action.id] ?? { mode: "free" as const, fixedSparks: 0, estimatedSparks: 0 };
  let priceText = "Free";
  if (rule.mode === "fixed") {
    priceText = `${rule.fixedSparks} ✦ (fixed)`;
  } else if (rule.mode === "derived") {
    let preview: number | null = null;
    if (model) {
      const cost = modelCosts.models[costKey(model.provider, model.id)];
      const usd = costForUsage(cost, { images: 1 });
      if (usd != null) preview = sparksForCostUsd({ ...sparks, enabled: true }, usd);
    }
    priceText = preview != null ? `≈ ${preview} ✦ (cost-derived)` : "Cost-derived";
  }

  // Plans that discount this action (full admin config carries multipliers).
  const discounts = adminPlans
    .map((p) => ({ name: p.presentation.name, m: p.actionMultipliers?.[action.id] }))
    .filter((d) => typeof d.m === "number" && d.m !== 1) as { name: string; m: number }[];

  // Per-plan usage limits that apply to this action (public entitlements.limits).
  const limitQuotas = EDIT_QUOTA_ACTIONS.has(action.id)
    ? QUOTAS.filter((q) => q.id === "editsPerBook")
    : [];
  const limits = limitQuotas.flatMap((q) =>
    publicPlans
      .map((p) => ({ name: p.name, v: p.entitlements.limits?.[q.id] }))
      .filter((x) => typeof x.v === "number" && x.v >= 0)
      .map((x) => ({ label: `${x.name}: ${x.v} ${q.label.toLowerCase()}` })),
  );

  return (
    <div className={`rounded-xl border-l-4 ring-1 ring-inset ring-ink-100 ${accent}`}>
      <div className="space-y-3 p-3">
        <div>
          <div className="text-sm font-semibold text-ink-800">{action.label}</div>
          <div className="text-xs text-ink-500">{action.help}</div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cell label="Model">
            {modelLabel ? (
              <span className="break-all">{modelLabel}</span>
            ) : (
              <Pill tone="warn">
                <AlertTriangle className="size-3" /> Not set
              </Pill>
            )}
          </Cell>

          <Cell label="Cost">
            {!model ? (
              <span className="text-ink-400">—</span>
            ) : hasCost ? (
              <Pill tone="ok">
                <DollarSign className="size-3" /> Priced
              </Pill>
            ) : (
              <Pill tone="warn">
                <AlertTriangle className="size-3" /> No cost
              </Pill>
            )}
          </Cell>

          <Cell label="Sparks price">{priceText}</Cell>

          <Cell label="Subscription perks">
            {discounts.length === 0 && limits.length === 0 ? (
              <span className="text-ink-400">None</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {discounts.map((d) => (
                  <Pill key={`d-${d.name}`} tone="muted">
                    {d.name} ×{d.m}
                  </Pill>
                ))}
                {limits.map((l) => (
                  <Pill key={`l-${l.label}`} tone="muted">
                    {l.label}
                  </Pill>
                ))}
              </div>
            )}
          </Cell>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-ink-100 px-2 py-1.5">
        <JumpButton icon={<Cpu className="size-3.5" />} label="Model" tab="models" />
        <JumpButton icon={<DollarSign className="size-3.5" />} label="Cost" tab="modelCosts" />
        <JumpButton icon={<Sparkles className="size-3.5" />} label="Price" tab="sparks" />
        <JumpButton icon={<CreditCard className="size-3.5" />} label="Plans" tab="plans" />
        {EDIT_QUOTA_ACTIONS.has(action.id) && (
          <JumpButton icon={<Gauge className="size-3.5" />} label="Limits" tab="plans" />
        )}
      </div>
    </div>
  );
}
