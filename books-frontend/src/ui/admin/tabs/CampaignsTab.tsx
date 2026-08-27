"use client";

/**
 * Admin editor for **marketing campaigns** (`adminSettings/campaigns`, projected
 * to `appConfig/campaigns` for the client).
 *
 * A campaign is a list of rules, and a rule is one moment + a flat AND-list of
 * conditions + one thing that happens. That's the whole model, and this screen is
 * arranged to make it readable in that order: pick who's in, say when and what,
 * then read the sentence a customer will see and the number it costs.
 *
 * Three deliberate choices:
 *
 *   1. **One campaign at a time.** The list on the left picks; the editor on the
 *      right edits. Campaigns don't interact except through stacking, so showing
 *      them all at once would only make each one harder to read.
 *   2. **Saving is refused on a `block`.** The impact engine's blocking warnings
 *      are the ones that lose money on every redemption (a refund with no
 *      ceiling, a discount past break-even, Sparks for guests). They're not
 *      advice.
 *   3. **The customer-facing sentence is generated, never typed.** The headline
 *      field is an optional override; the default is derived from the rules, so
 *      the promise cannot drift from the payout. The preview shows exactly what
 *      will be displayed.
 *
 * Live numbers (enrollments, cost, measured lift against the holdout) are a
 * metrics view rather than a setting, so they live in Analysis → Campaigns.
 */
import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import {
  CAMPAIGN_STATUS_LABELS,
  MAX_CAMPAIGNS,
  MAX_RULES_PER_CAMPAIGN,
  campaignTeaser,
  createCampaign,
  createRule,
  freezeTerms,
  normalizeCampaignsConfig,
  summarizeRules,
  type Campaign,
  type CampaignStatus,
  type CampaignsConfig,
} from "../../../core/config/campaigns";
import { campaignBlocks, campaignImpact } from "../../../core/config/campaignImpact";
import type { ProductDefinition } from "../../../core/config/products";
import { Disclosure, Grid, ImpactNote, NumberField, Section, TabIntro } from "./products/parts";
import { CampaignRuleEditor, AddRuleButton } from "./campaigns/CampaignRuleEditor";
import { CampaignImpactPanel, CampaignSimulatorPanel } from "./campaigns/CampaignImpactPanel";
import { HeldPayoutsPanel } from "./campaigns/HeldPayoutsPanel";
import { DateField, SwitchField } from "./campaigns/parts";
import { useReadOnly } from "../../components/ReadOnlyContext";

const STATUS_OPTIONS = (["draft", "active", "paused", "ended"] as CampaignStatus[]).map((value) => ({
  value,
  label: CAMPAIGN_STATUS_LABELS[value],
}));

export function CampaignsTab() {
  const readOnly = useReadOnly();
  const load = useAppConfigStore((s) => s.loadCampaignsConfig);
  const save = useAppConfigStore((s) => s.saveCampaignsConfig);
  const loadAdminProducts = useAppConfigStore((s) => s.loadAdminProducts);
  const sparks = useAppConfigStore((s) => s.sparks);
  const settings = useAppConfigStore((s) => s.pricingSettings);
  const shipping = useAppConfigStore((s) => s.shippingSettings);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const openConfigTab = useAdminTab((s) => s.openConfigTab);
  const openAnalysis = useAdminTab((s) => s.openAnalysis);

  const [draft, setDraft] = useState<CampaignsConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<ProductDefinition[]>([]);

  useEffect(() => {
    let live = true;
    void load()
      .then((cfg) => {
        if (!live) return;
        setDraft(cfg);
        setSelectedId((id) => id ?? cfg.campaigns[0]?.id ?? null);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load campaigns."));
    void loadAdminProducts()
      .then((cfg) => live && setProducts(cfg.products))
      .catch(() => {
        /* the impact panel reports discounts as unmodelable */
      });
    return () => {
      live = false;
    };
  }, [load, loadAdminProducts]);

  const selected = draft?.campaigns.find((c) => c.id === selectedId) ?? null;

  const impact = useMemo(
    () =>
      selected
        ? campaignImpact({ campaign: selected, sparks, settings, products, plans, shipping })
        : null,
    [selected, sparks, settings, products, plans, shipping],
  );
  const blockers = impact ? campaignBlocks(impact) : [];

  if (!draft) return <p className="text-sm text-ink-400">Loading campaigns…</p>;

  const setConfig = (patch: Partial<CampaignsConfig>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const setCampaign = (id: string, patch: Partial<Campaign>) => {
    setDraft((d) =>
      d ? { ...d, campaigns: d.campaigns.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d,
    );
    setDirty(true);
  };

  const addCampaign = () => {
    const campaign = createCampaign({ name: `Campaign ${draft.campaigns.length + 1}` });
    setConfig({ campaigns: [...draft.campaigns, campaign] });
    setSelectedId(campaign.id);
  };

  const duplicateCampaign = (source: Campaign) => {
    // A fresh id on the campaign AND on every rule: ids form the payout key, so
    // reusing them would make the copy's payouts collide with the original's.
    const copy = createCampaign({
      ...source,
      id: undefined,
      name: `${source.name} (copy)`,
      status: "draft",
      rules: source.rules.map((r) => createRule({ ...r, id: undefined })),
    });
    setConfig({ campaigns: [...draft.campaigns, copy] });
    setSelectedId(copy.id);
    toast.success("Copied as a new draft.");
  };

  const removeCampaign = (campaign: Campaign) => {
    if (
      !window.confirm(
        campaign.status === "draft"
          ? `Delete "${campaign.name}"?`
          : `Delete "${campaign.name}"? Anyone already enrolled keeps the terms they were promised — those are frozen ` +
              `on the enrollment — but nobody new can earn anything. Ending it instead keeps the record.`,
      )
    ) {
      return;
    }
    const remaining = draft.campaigns.filter((c) => c.id !== campaign.id);
    setConfig({ campaigns: remaining });
    setSelectedId(remaining[0]?.id ?? null);
  };

  const onSave = async () => {
    if (blockers.length > 0) {
      toast.error(blockers[0].message);
      return;
    }
    setSaving(true);
    try {
      // Normalized once, here: the editor lets a draft be temporarily incoherent
      // while it's being typed, and this is the moment that has to stop.
      const saved = await save(normalizeCampaignsConfig(draft));
      setDraft(saved);
      setDirty(false);
      toast.success("Campaigns saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            Payout economics come from the Sparks peg and the catalog&apos;s margins, and live results (enrollments,
            cost, measured lift) are a metrics view rather than a setting.
          </>
        }
        links={[
          { label: "Sparks economy", onClick: () => openConfigTab("sparks") },
          { label: "Discount planner", onClick: () => openConfigTab("discounts") },
          { label: "Analysis → Campaigns", onClick: () => openAnalysis("campaigns") },
        ]}
      >
        Promotions with rules: refund the Sparks someone spent, hand over a gift, make an action free for a week, or
        discount their next order. Each rule is one moment, a list of conditions, and one thing that happens — and the
        sentence the customer reads is generated from those rules, so the promise can never drift from what actually
        pays out. Terms freeze onto each enrollment, so editing a live campaign never rewrites a promise already made.
      </TabIntro>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SwitchField
          checked={draft.enabled}
          onChange={(v) => setConfig({ enabled: v })}
          label="Campaign engine enabled"
          hint="The master switch. Off means nothing enrolls and nothing pays, whatever each campaign says."
        />
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={draft.campaigns.length >= MAX_CAMPAIGNS}
              onClick={addCampaign}
            >
              <Plus className="size-3.5" /> New campaign
            </Button>
            <Button
              type="button"
              size="sm"
              loading={saving}
              disabled={!dirty || blockers.length > 0}
              onClick={() => void onSave()}
            >
              Save
            </Button>
          </div>
        )}
      </div>

      {!draft.enabled && draft.campaigns.some((c) => c.status === "active") && (
        <ImpactNote>
          The engine is <span className="font-semibold">off</span>, so the active campaigns below aren&apos;t running.
          Nothing enrolls and nothing pays until it&apos;s switched on.
        </ImpactNote>
      )}

      {!sparks.enabled && (
        <ImpactNote>
          The Sparks economy is disabled, so Spark grants and refunds can&apos;t be delivered — they&apos;ll pile up
          under Held payouts until it&apos;s back on. Turn it on under{" "}
          <button type="button" className="font-semibold underline" onClick={() => openConfigTab("sparks")}>
            Sparks economy
          </button>
          .
        </ImpactNote>
      )}

      <HeldPayoutsPanel currency={settings.baseCurrency} />

      {draft.campaigns.length === 0 ? (
        <Section title="Campaigns" hint="Nothing configured yet.">
          <p className="text-xs text-ink-400">
            No campaigns. Add one to start — it opens as a draft, which never evaluates and never pays, so there&apos;s
            no risk in building it out first.
          </p>
        </Section>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <CampaignList
            campaigns={draft.campaigns}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selected && impact ? (
            <div className="min-w-0 space-y-3">
              <CampaignEditor
                campaign={selected}
                currency={settings.baseCurrency}
                onChange={(patch) => setCampaign(selected.id, patch)}
                onDuplicate={() => duplicateCampaign(selected)}
                onRemove={() => removeCampaign(selected)}
              />
              <CampaignImpactPanel impact={impact} currency={settings.baseCurrency} />
              <CampaignSimulatorPanel campaign={selected} currency={settings.baseCurrency} />
            </div>
          ) : (
            <p className="text-sm text-ink-400">Pick a campaign to edit.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- List -------------------------------------------------------------------

const STATUS_DOT: Record<CampaignStatus, string> = {
  draft: "bg-ink-300",
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  ended: "bg-ink-200",
};

function CampaignList({
  campaigns,
  selectedId,
  onSelect,
}: {
  campaigns: Campaign[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {campaigns.map((campaign) => {
        const on = campaign.id === selectedId;
        return (
          <button
            key={campaign.id}
            type="button"
            onClick={() => onSelect(campaign.id)}
            className={
              on
                ? "w-full rounded-lg bg-white px-3 py-2 text-left ring-2 ring-inset ring-brand-400"
                : "w-full rounded-lg bg-white px-3 py-2 text-left ring-1 ring-inset ring-ink-100 transition hover:ring-ink-200"
            }
          >
            <div className="flex items-center gap-1.5">
              <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[campaign.status]}`} />
              <span className="truncate text-sm font-medium text-ink-800">{campaign.name}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-400">
              {campaignTeaser(campaign)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ---- Editor -----------------------------------------------------------------

function CampaignEditor({
  campaign,
  currency,
  onChange,
  onDuplicate,
  onRemove,
}: {
  campaign: Campaign;
  currency: string;
  onChange: (patch: Partial<Campaign>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const readOnly = useReadOnly();
  const terms = freezeTerms(campaign);
  const generated = summarizeRules(campaign.rules);

  return (
    <div className="space-y-3">
      <Section
        title="This campaign"
        action={
          readOnly ? undefined : (
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant="secondary" onClick={onDuplicate}>
                <Copy className="size-3.5" /> Duplicate
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={onRemove}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
            </div>
          )
        }
      >
        <Grid cols={2}>
          <Field label="Name" hint="Admin-facing only. Customers never see it.">
            <Input
              value={campaign.name}
              maxLength={120}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>
          <Field
            label="Status"
            hint="Draft never evaluates. Paused stops new enrollments but honors the ones already made."
          >
            <Select
              value={campaign.status}
              options={STATUS_OPTIONS}
              onChange={(e) => onChange({ status: e.target.value as CampaignStatus })}
            />
          </Field>
        </Grid>
        <Field label="Notes" hint="Why this exists and what it's testing. For you and whoever reads this next.">
          <Textarea
            value={campaign.notes}
            rows={2}
            maxLength={2000}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </Field>
        <Grid cols={2}>
          <DateField
            label="Starts"
            value={campaign.window.startsAt}
            hint="Empty means as soon as it goes active."
            onChange={(startsAt) => onChange({ window: { ...campaign.window, startsAt } })}
          />
          <DateField
            label="Ends"
            value={campaign.window.endsAt}
            hint="Empty means it runs until someone stops it."
            onChange={(endsAt) => onChange({ window: { ...campaign.window, endsAt } })}
          />
        </Grid>
      </Section>

      <Section
        title="Rules"
        hint="Each rule fires on its own. Conditions within a rule are ANDed — to express OR, add a second rule."
        action={
          <AddRuleButton
            disabled={campaign.rules.length >= MAX_RULES_PER_CAMPAIGN}
            onAdd={() => onChange({ rules: [...campaign.rules, createRule()] })}
          />
        }
      >
        <div className="space-y-3">
          {campaign.rules.map((rule) => (
            <CampaignRuleEditor
              key={rule.id}
              rule={rule}
              currency={currency}
              onChange={(next) => onChange({ rules: campaign.rules.map((r) => (r.id === rule.id ? next : r)) })}
              onRemove={() => onChange({ rules: campaign.rules.filter((r) => r.id !== rule.id) })}
            />
          ))}
          {campaign.rules.length === 0 && (
            <p className="text-xs text-ink-400">No rules — this campaign does nothing. Add one.</p>
          )}
        </div>
      </Section>

      <Section
        title="What people see"
        hint="The headline is an optional override. Leave it empty and it's generated from the rules, which is the version that can't drift out of sync with what actually pays out."
      >
        <div className="space-y-2.5">
          <Field label="Headline override" hint={generated ? `Generated: ${generated}` : "Add a rule to generate one."}>
            <Input
              value={campaign.presentation.headline}
              maxLength={160}
              placeholder={generated}
              onChange={(e) =>
                onChange({ presentation: { ...campaign.presentation, headline: e.target.value } })
              }
            />
          </Field>
          <Field label="Subline">
            <Textarea
              value={campaign.presentation.subline}
              rows={2}
              maxLength={400}
              onChange={(e) =>
                onChange({ presentation: { ...campaign.presentation, subline: e.target.value } })
              }
            />
          </Field>
        </div>
        <div className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-inset ring-ink-100">
          <div className="text-[11px] uppercase tracking-wide text-ink-400">Preview</div>
          <p className="text-sm font-medium text-ink-800">{terms.summary || "— nothing to show yet."}</p>
          {campaign.presentation.subline && (
            <p className="text-[11px] text-ink-500">{campaign.presentation.subline}</p>
          )}
          {terms.notes.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-[11px] text-ink-500">
              {terms.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-[11px] text-ink-400">
          Those footnotes are generated from the rules&apos; own conditions and caps, and they&apos;re shown wherever the
          offer is. A cap the customer can&apos;t see is how &quot;get your Sparks back&quot; turns into a chargeback.
        </p>
      </Section>

      <Section
        title="Who can take part"
        hint="Evaluated once, when someone first meets the campaign, and frozen onto their enrollment."
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          <SwitchField
            checked={campaign.audience.requireVerified}
            onChange={(requireVerified) => onChange({ audience: { ...campaign.audience, requireVerified } })}
            label="Require a verified email"
            hint="The cheapest anti-farming gate there is. Without it, one person can take the offer as many times as they can make addresses."
          />
          <SwitchField
            checked={campaign.audience.allowGuests}
            onChange={(allowGuests) => onChange({ audience: { ...campaign.audience, allowGuests } })}
            label="Let guest sessions take part"
            hint="Almost always wrong: a guest costs nothing to create and has no payment relationship."
          />
        </div>
        <Grid cols={2}>
          <DateField
            label="Only accounts created after"
            value={campaign.audience.signedUpFrom}
            hint="The way to say &quot;everyone who joins from today&quot;."
            onChange={(signedUpFrom) => onChange({ audience: { ...campaign.audience, signedUpFrom } })}
          />
          <DateField
            label="…and before"
            value={campaign.audience.signedUpTo}
            hint="The way to say &quot;everyone who joined before the launch&quot;."
            onChange={(signedUpTo) => onChange({ audience: { ...campaign.audience, signedUpTo } })}
          />
        </Grid>
        <Disclosure label="Narrow it further">
          <Field label="Countries (ISO-2)" hint="Comma-separated. Empty means anywhere.">
            <Input
              value={campaign.audience.countries.join(", ")}
              placeholder="US, GB, DE"
              onChange={(e) =>
                onChange({
                  audience: {
                    ...campaign.audience,
                    countries: e.target.value
                      .split(",")
                      .map((s) => s.trim().toUpperCase().slice(0, 2))
                      .filter(Boolean),
                  },
                })
              }
            />
          </Field>
          <Field
            label="Only these accounts"
            hint="Comma-separated uids. The escape hatch for make-goods and pilots — empty means everyone eligible."
          >
            <Textarea
              value={campaign.audience.allowlistUids.join(", ")}
              rows={2}
              onChange={(e) =>
                onChange({
                  audience: {
                    ...campaign.audience,
                    allowlistUids: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </Field>
        </Disclosure>
      </Section>

      <Section
        title="Limits & budget"
        hint="The caps that keep the liability bounded. Past the daily budget, payouts are held for review and an alert fires."
      >
        <Grid cols={2}>
          <NumberField
            label="Redemptions per account"
            value={campaign.limits.maxPerAccount}
            step="1"
            hint={campaign.limits.maxPerAccount === 0 ? "0 means unlimited." : undefined}
            onChange={(n) => onChange({ limits: { ...campaign.limits, maxPerAccount: Math.max(0, Math.round(n)) } })}
          />
          <NumberField
            label="Redemptions in total"
            value={campaign.limits.maxTotal}
            step="10"
            hint="The &quot;first 100 customers&quot; cap. 0 means unlimited."
            onChange={(n) => onChange({ limits: { ...campaign.limits, maxTotal: Math.max(0, Math.round(n)) } })}
          />
          <NumberField
            label={`Daily budget (${currency})`}
            value={campaign.limits.dailyBudget}
            step="25"
            suffix={currency}
            hint="The circuit breaker. Past it, payouts wait for a human."
            onChange={(n) => onChange({ limits: { ...campaign.limits, dailyBudget: Math.max(0, n) } })}
          />
          <NumberField
            label={`Lifetime budget (${currency})`}
            value={campaign.limits.lifetimeBudget}
            step="100"
            suffix={currency}
            hint="0 means unlimited."
            onChange={(n) => onChange({ limits: { ...campaign.limits, lifetimeBudget: Math.max(0, n) } })}
          />
        </Grid>
      </Section>

      <Section
        title="Measurement & stacking"
        hint="How you'll know whether this worked, and what happens when two offers collide."
      >
        <Grid cols={3}>
          <NumberField
            label="Holdout"
            value={campaign.holdoutPct}
            step="5"
            suffix="%"
            hint="Held back deliberately so their behaviour is the control. Without one, you can't tell a purchase this caused from one that would have happened anyway."
            onChange={(n) => onChange({ holdoutPct: Math.min(100, Math.max(0, Math.round(n))) })}
          />
          <NumberField
            label="Priority"
            value={campaign.priority}
            step="1"
            min={-100}
            hint="Higher wins when two non-stackable offers collide."
            onChange={(n) => onChange({ priority: Math.round(n) })}
          />
          <div className="flex items-end pb-1">
            <SwitchField
              checked={campaign.stackable}
              onChange={(stackable) => onChange({ stackable })}
              label="Can stack"
              hint="Off means the single best offer wins at checkout."
            />
          </div>
        </Grid>
        {campaign.holdoutPct > 0 && (
          <p className="text-[11px] text-ink-400">
            {campaign.holdoutPct}% of the eligible audience will be held back. They see the same &quot;this offer
            isn&apos;t running&quot; message as everyone outside the campaign — a holdout that knows it&apos;s a holdout
            isn&apos;t a control group.
          </p>
        )}
      </Section>
    </div>
  );
}
