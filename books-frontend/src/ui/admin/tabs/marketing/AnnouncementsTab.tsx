"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Copy, Megaphone, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input, Textarea } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  createDefaultAnnouncement,
  isAnnouncementLive,
  newAnnouncementId,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_FREQUENCIES,
  ANNOUNCEMENT_LINK_PRESETS,
  ANNOUNCEMENT_PLACEMENTS,
  ANNOUNCEMENT_TONES,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementFrequency,
  type AnnouncementPlacement,
  type AnnouncementsConfig,
  type AnnouncementTone,
} from "../../../../core/config/announcements";
import { AnnouncementCard } from "../../../marketing/AnnouncementBanner";
import { Grid, NumberField, Section, TabIntro, TextField } from "../products/parts";

const PLACEMENT_LABELS: Record<AnnouncementPlacement, string> = {
  bar: "Bottom bar",
  floating: "Floating card",
  pill: "Small pill",
};

const TONE_SWATCH: Record<AnnouncementTone, string> = {
  brand: "bg-brand-600",
  amber: "bg-amber-500",
  rose: "bg-rose-600",
  magic: "bg-gradient-to-br from-magic-500 to-magic-700",
  ink: "bg-ink-900",
};

const AUDIENCE_OPTIONS: { value: AnnouncementAudience; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "guests", label: "Guests only (not signed in)" },
  { value: "signedIn", label: "Signed-in accounts only" },
];

const FREQUENCY_OPTIONS: { value: AnnouncementFrequency; label: string }[] = [
  { value: "always", label: "Every page load — no memory" },
  { value: "session", label: "Once per browser session" },
  { value: "once", label: "Once ever, on this device" },
];

/** Sentinel select value meaning "not one of the presets" — never written to
 *  the field itself, just what the dropdown shows while the raw `Input`
 *  below holds custom text (or a preset the admin has since hand-edited). */
const CUSTOM_LINK_VALUE = "__custom__";

const LINK_SELECT_OPTIONS = [{ value: CUSTOM_LINK_VALUE, label: "Custom URL…" }, ...ANNOUNCEMENT_LINK_PRESETS];

/** A button-link field: a quick-fill dropdown of common destinations (see
 *  `ANNOUNCEMENT_LINK_PRESETS`) sitting above the raw URL `Input`, which
 *  stays the source of truth — picking a preset just fills it, and anything
 *  not listed (a specific blog post, an external link) still works as free
 *  text. Two presets ("Sign up / sign in", "Cookie settings") aren't URLs;
 *  they fill in an `action:*` value that `AnnouncementBanner.tsx` recognizes
 *  and runs as a dialog instead of a navigation. */
function LinkField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const isPreset = ANNOUNCEMENT_LINK_PRESETS.some((p) => p.value === value);
  return (
    <Field label={label} hint="Pick a common destination, or type any URL below.">
      <div className="space-y-1.5">
        <Select
          value={isPreset ? value : CUSTOM_LINK_VALUE}
          options={LINK_SELECT_OPTIONS}
          onChange={(e) => {
            if (e.target.value !== CUSTOM_LINK_VALUE) onChange(e.target.value);
          }}
        />
        <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

function segBtnClass(active: boolean): string {
  return `h-9 flex-1 rounded-lg px-2 text-xs font-semibold ring-1 ring-inset transition ${
    active ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50"
  }`;
}

/** `<input type="datetime-local">` works in the browser's local timezone —
 *  convert to/from epoch ms for storage. Empty string means "not set". */
function toDatetimeLocal(ms: number | null): string {
  if (ms == null) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(v: string): number | null {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function statusBadge(a: Announcement): { label: string; className: string } {
  if (!a.enabled) return { label: "Off", className: "bg-ink-100 text-ink-500" };
  const now = Date.now();
  if (a.startAt != null && now < a.startAt) return { label: "Scheduled", className: "bg-sky-100 text-sky-700" };
  if (a.endAt != null && now > a.endAt) return { label: "Ended", className: "bg-ink-100 text-ink-500" };
  if (isAnnouncementLive(a, now)) return { label: "Live now", className: "bg-emerald-100 text-emerald-700" };
  return { label: "Off", className: "bg-ink-100 text-ink-500" };
}

/**
 * Marketing → Announcements. Edits the world-readable `appConfig/announcements`
 * doc: a list of promo/seasonal banners (a discount, a summer sale, a launch
 * countdown, …), each with its own copy, schedule window, audience, dismissal
 * rule and placement. Only the single highest-priority LIVE + eligible one is
 * ever shown to a given visitor — see `core/config/announcements.ts`.
 *
 * The live preview on each card renders the exact same component the real
 * site uses ({@link AnnouncementCard}), so what's shown here is pixel-for-pixel
 * what a visitor would see, not an approximation.
 */
export function AnnouncementsTab() {
  const stored = useAppConfigStore((s) => s.announcements);
  const save = useAppConfigStore((s) => s.saveAnnouncementsConfig);

  const [draft, setDraft] = useState<AnnouncementsConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Ticks the previews' countdowns while this tab is open.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const update = (id: string, patch: Partial<Announcement>) => {
    setDraft((d) => ({ ...d, banners: d.banners.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    setDirty(true);
  };

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = () => {
    const banner = createDefaultAnnouncement();
    setDraft((d) => ({ ...d, banners: [...d.banners, banner] }));
    setExpanded((prev) => new Set(prev).add(banner.id));
    setDirty(true);
  };

  const duplicate = (a: Announcement) => {
    const copy: Announcement = { ...a, id: newAnnouncementId(), name: `${a.name} (copy)`, enabled: false };
    setDraft((d) => ({ ...d, banners: [...d.banners, copy] }));
    setExpanded((prev) => new Set(prev).add(copy.id));
    setDirty(true);
  };

  const remove = (id: string) => {
    setDraft((d) => ({ ...d, banners: d.banners.filter((a) => a.id !== id) }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Announcements saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save announcements.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Promo and seasonal banners — a discount, a summer sale, a launch countdown. Only the
          single highest-<strong>priority</strong> banner that&apos;s currently enabled, inside its
          schedule window, and matches the visitor&apos;s audience is ever shown. Changes apply on a
          visitor&apos;s next page load (not live mid-session).
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(stored);
                setDirty(false);
              }}
            >
              Discard
            </Button>
          )}
          <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
            Save announcements
          </Button>
        </div>
      </div>

      {draft.banners.length === 0 && (
        <TabIntro>
          No announcement banners yet. Add one below — it starts disabled, so you can build out the
          copy and schedule before switching it on.
        </TabIntro>
      )}

      <div className="space-y-3">
        {draft.banners.map((a) => {
          const isOpen = expanded.has(a.id);
          const badge = statusBadge(a);
          return (
            <div key={a.id} className="rounded-xl ring-1 ring-inset ring-ink-100">
              <button
                type="button"
                onClick={() => toggleExpanded(a.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className={`size-2.5 shrink-0 rounded-full ${TONE_SWATCH[a.tone]}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-800">
                      {a.name || "Untitled announcement"}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                  </span>
                  {!isOpen && (
                    <span className="mt-0.5 block truncate text-xs text-ink-400">
                      {a.message || "No message set"} · {PLACEMENT_LABELS[a.placement]}
                    </span>
                  )}
                </span>
                {isOpen ? (
                  <ChevronUp className="size-4 shrink-0 text-ink-400" />
                ) : (
                  <ChevronDown className="size-4 shrink-0 text-ink-400" />
                )}
              </button>

              {isOpen && (
                <div className="grid gap-4 border-t border-ink-100 p-4 sm:grid-cols-[1fr_20rem]">
                  <div className="space-y-3">
                    <Grid cols={2}>
                      <TextField
                        label="Internal name"
                        value={a.name}
                        placeholder="e.g. Summer sale 2026"
                        onChange={(v) => update(a.id, { name: v })}
                      />
                      <div className="flex items-end pb-1.5">
                        <label className="flex items-center gap-2 text-sm text-ink-700">
                          <Toggle
                            checked={a.enabled}
                            onChange={(v) => update(a.id, { enabled: v })}
                            label="Enabled"
                          />
                          {a.enabled ? "Enabled" : "Disabled"}
                        </label>
                      </div>
                    </Grid>

                    <Section title="Content" hint="What the visitor sees.">
                      <Grid cols={4}>
                        <TextField
                          label="Emoji"
                          className="sm:col-span-1"
                          value={a.emoji}
                          placeholder="🎉"
                          onChange={(v) => update(a.id, { emoji: v })}
                        />
                        <div className="sm:col-span-3">
                          <Field label="Message">
                            <Textarea
                              rows={2}
                              value={a.message}
                              placeholder="20% off all print books — this week only!"
                              onChange={(e) => update(a.id, { message: e.target.value })}
                            />
                          </Field>
                        </div>
                      </Grid>
                      <Grid cols={2}>
                        <TextField
                          label="Button label"
                          value={a.ctaLabel}
                          placeholder="Shop the sale"
                          onChange={(v) => update(a.id, { ctaLabel: v })}
                        />
                        <LinkField
                          label="Button link"
                          value={a.ctaUrl}
                          placeholder="/#pricing"
                          onChange={(v) => update(a.id, { ctaUrl: v })}
                        />
                      </Grid>
                      <Grid cols={2}>
                        <TextField
                          label="Secondary link label (optional)"
                          value={a.secondaryLabel}
                          placeholder="Learn more"
                          onChange={(v) => update(a.id, { secondaryLabel: v })}
                        />
                        <LinkField
                          label="Secondary link URL"
                          value={a.secondaryUrl}
                          placeholder="/blog/summer-sale"
                          onChange={(v) => update(a.id, { secondaryUrl: v })}
                        />
                      </Grid>
                    </Section>

                    <Section title="Look" hint="Where it sits on the page and its color.">
                      <Field label="Placement">
                        <div className="flex gap-1">
                          {ANNOUNCEMENT_PLACEMENTS.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => update(a.id, { placement: p })}
                              className={segBtnClass(a.placement === p)}
                            >
                              {PLACEMENT_LABELS[p]}
                            </button>
                          ))}
                        </div>
                      </Field>
                      <Field label="Color">
                        <div className="flex gap-1.5">
                          {ANNOUNCEMENT_TONES.map((t) => (
                            <button
                              key={t}
                              type="button"
                              title={t}
                              onClick={() => update(a.id, { tone: t })}
                              className={`size-8 rounded-full ring-2 ring-offset-2 transition ${TONE_SWATCH[t]} ${
                                a.tone === t ? "ring-ink-400" : "ring-transparent"
                              }`}
                            />
                          ))}
                        </div>
                      </Field>
                    </Section>

                    <Section title="Schedule" hint="Leave blank for no start/end restriction.">
                      <Grid cols={2}>
                        <Field label="Starts">
                          <Input
                            type="datetime-local"
                            value={toDatetimeLocal(a.startAt)}
                            onChange={(e) => update(a.id, { startAt: fromDatetimeLocal(e.target.value) })}
                          />
                        </Field>
                        <Field label="Ends">
                          <Input
                            type="datetime-local"
                            value={toDatetimeLocal(a.endAt)}
                            onChange={(e) => update(a.id, { endAt: fromDatetimeLocal(e.target.value) })}
                          />
                        </Field>
                      </Grid>
                      <label className="flex items-center gap-2 text-sm text-ink-700">
                        <Toggle
                          checked={a.showCountdown}
                          disabled={a.endAt == null}
                          onChange={(v) => update(a.id, { showCountdown: v })}
                          label="Show countdown"
                        />
                        Show a live countdown to the end date
                        {a.endAt == null && <span className="text-ink-400">(set an end date first)</span>}
                      </label>
                    </Section>

                    <Section title="Audience & frequency">
                      <Grid cols={2}>
                        <Field label="Who sees it">
                          <Select
                            value={a.audience}
                            options={AUDIENCE_OPTIONS}
                            onChange={(e) => update(a.id, { audience: e.target.value as AnnouncementAudience })}
                          />
                        </Field>
                        <Field label="How often, once dismissed">
                          <Select
                            value={a.frequency}
                            options={FREQUENCY_OPTIONS}
                            onChange={(e) => update(a.id, { frequency: e.target.value as AnnouncementFrequency })}
                          />
                        </Field>
                      </Grid>
                      <Grid cols={2}>
                        <label className="flex items-center gap-2 text-sm text-ink-700">
                          <Toggle
                            checked={a.dismissible}
                            onChange={(v) => update(a.id, { dismissible: v })}
                            label="Dismissible"
                          />
                          Visitor can close it
                        </label>
                        <NumberField
                          label="Priority"
                          value={a.priority}
                          onChange={(n) => update(a.id, { priority: n })}
                          hint="Higher wins if more than one banner is eligible at once."
                        />
                      </Grid>
                    </Section>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Copy className="size-3.5" />}
                        onClick={() => duplicate(a)}
                      >
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="size-3.5" />}
                        onClick={() => remove(a.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-ink-500">Live preview</div>
                    <div className="relative flex h-56 items-end overflow-hidden rounded-lg bg-ink-100 ring-1 ring-inset ring-ink-200">
                      <div
                        className={
                          a.placement === "bar"
                            ? "w-full"
                            : a.placement === "floating"
                              ? "flex w-full justify-end p-3"
                              : "flex w-full justify-start p-3"
                        }
                      >
                        <AnnouncementCard announcement={a} now={now} onDismiss={() => {}} />
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-ink-400">
                      Exactly how it renders on the site (grayed box stands in for the page).
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button variant="secondary" leftIcon={<Plus className="size-4" />} onClick={add}>
        New announcement
      </Button>

      {draft.banners.length > 0 && (
        <TabIntro elsewhere="Site-wide branding colors live in Marketing → Branding; this tab only picks from the fixed set of tones above so a banner can never clash.">
          <Megaphone className="mr-1 inline size-3.5" />
          Tip: keep at most one banner enabled per audience/placement at a time — if several are
          eligible together, only the highest-priority one shows; the rest just wait their turn.
        </TabIntro>
      )}
    </div>
  );
}
