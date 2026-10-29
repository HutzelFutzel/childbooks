"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  CheckCircle2,
  Eye,
  Globe,
  History,
  ImageIcon,
  Layers,
  RotateCcw,
  Search,
  Sparkles,
  Stamp,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  DEFAULT_BACK_COVER_LOGO_SIZE_CM,
  MAX_BACK_COVER_LOGO_SIZE_CM,
  MIN_BACK_COVER_LOGO_SIZE_CM,
  defaultCoverAsset,
  type BrandAsset,
  type BrandAssetSlot,
  type BrandColors,
  type BrandingConfig,
  type BrandingWatermark,
} from "../../../../core/config/branding";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { HugoCourierSvg } from "../../../contact/ContactMascot";
import { HedgehogPlaceholder } from "../../../guide/chat/GuideAvatar";
import { BrandMark } from "../../../layout/BrandMark";
import { cn } from "../../../lib/cn";
import {
  CleoDanglingOnLedgeSvg,
  FooterMascots,
  MomoReadingOnLedgeSvg,
  ScoutPeekingLedgeSvg,
} from "../../../marketing/FooterMascots";
import { EditorTabs, Section, TextField } from "../products/parts";

/** Read a File as bare base64 (no data: prefix) + its mime type. */
function readBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        base64: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || "image/png",
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type BrandingCategory = "all" | "identity" | "characters" | "covers" | "print";
type CoverShapeTab = "square" | "wide" | "portrait" | "overview";

interface AssetMeta {
  slot: BrandAssetSlot;
  label: string;
  whereUsed: string;
  spec: string;
  hint: string;
  ratio: string;
  dark?: boolean;
  category: Exclude<BrandingCategory, "all">;
  keywords: string;
  /** Optional built-in illustration when no custom asset is uploaded. */
  fallbackRender?: () => ReactNode;
  fallbackLabel?: string;
}

const CORE_ASSETS: AssetMeta[] = [
  {
    slot: "logo",
    label: "Primary logo (light)",
    whereUsed: "Navbar, Studio top bar, Footer",
    spec: "SVG / PNG · ~5:2",
    hint: "Horizontal wordmark or lockup for light surfaces. Falls back to the monogram stamp + brand name when empty.",
    ratio: "5/2",
    category: "identity",
    keywords: "logo light navbar header wordmark topbar",
    fallbackLabel: "Monogram stamp",
  },
  {
    slot: "logoDark",
    label: "Logo (dark surface)",
    whereUsed: "Dark banners & dark UI surfaces",
    spec: "SVG / PNG · ~5:2",
    hint: "Light-colored logo variant for dark backgrounds.",
    ratio: "5/2",
    dark: true,
    category: "identity",
    keywords: "logo dark inverse white footer banner",
    fallbackLabel: "Uses primary / text",
  },
  {
    slot: "icon",
    label: "App icon / square mark",
    whereUsed: "Bookplate stamp, PWA & mobile icon",
    spec: "512×512 PNG / SVG",
    hint: "Square emblem shown inside the brand stamp when no full horizontal logo is set.",
    ratio: "1/1",
    category: "identity",
    keywords: "icon mark square app monogram stamp",
    fallbackLabel: "Monogram letter",
  },
  {
    slot: "favicon",
    label: "Favicon",
    whereUsed: "Browser tab & bookmarks",
    spec: "SVG or 512×512 PNG",
    hint: "Browser tab icon emitted in site metadata.",
    ratio: "1/1",
    category: "identity",
    keywords: "favicon browser tab ico icon",
    fallbackLabel: "Default icon",
  },
  {
    slot: "ogImage",
    label: "Social share card (OG)",
    whereUsed: "Open Graph, X/Twitter, iMessage, Slack",
    spec: "1200×630 PNG / WebP",
    hint: "Default link preview image when someone shares the site on social media or messaging apps.",
    ratio: "1200/630",
    category: "identity",
    keywords: "og open graph twitter social share card meta preview",
  },
];

const CHARACTER_ASSETS: AssetMeta[] = [
  {
    slot: "contactMascot",
    label: "Contact mascot (Hugo)",
    whereUsed: "Help & Support modal + /contact",
    spec: "~512×512 PNG / SVG",
    hint: "Courier mascot on the correspondence card. Falls back to the built-in Hugo the Hedgehog illustration.",
    ratio: "1/1",
    category: "characters",
    keywords: "hugo hedgehog contact help support mascot character",
    fallbackLabel: "Built-in Hugo SVG",
    fallbackRender: () => <HugoCourierSvg className="size-12" />,
  },
  {
    slot: "guideAvatar",
    label: "Studio guide avatar",
    whereUsed: "Chat studio & opening greeting",
    spec: "~512×512 PNG / SVG",
    hint: "Profile picture beside the AI guide's messages in the book creation studio.",
    ratio: "1/1",
    category: "characters",
    keywords: "guide avatar chat studio assistant hedgehog persona",
    fallbackLabel: "Built-in Guide SVG",
    fallbackRender: () => <HedgehogPlaceholder className="size-11" />,
  },
  {
    slot: "footerMascotLeft",
    label: "Footer character — Left (Momo)",
    whereUsed: "Footer colophon ledge (left)",
    spec: "~512×512 PNG / SVG",
    hint: "Left companion seated on the footer rule. Falls back to Momo the Mole.",
    ratio: "1/1",
    category: "characters",
    keywords: "momo mole footer left mascot character curtain call",
    fallbackLabel: "Built-in Momo SVG",
    fallbackRender: () => <MomoReadingOnLedgeSvg className="size-12" />,
  },
  {
    slot: "footerMascotCenter",
    label: "Footer character — Center (Cleo)",
    whereUsed: "Footer colophon ledge (center)",
    spec: "~512×512 PNG / SVG",
    hint: "Center companion perched on the footer rule. Falls back to Cleo the Siamese Cat.",
    ratio: "1/1",
    category: "characters",
    keywords: "cleo cat siamese footer center mascot character curtain call",
    fallbackLabel: "Built-in Cleo SVG",
    fallbackRender: () => <CleoDanglingOnLedgeSvg className="size-12" />,
  },
  {
    slot: "footerMascotRight",
    label: "Footer character — Right (Scout)",
    whereUsed: "Footer colophon ledge (right)",
    spec: "~512×512 PNG / SVG",
    hint: "Right companion peeking over the footer rule. Falls back to Scout the Squirrel.",
    ratio: "1/1",
    category: "characters",
    keywords: "scout squirrel footer right mascot character curtain call",
    fallbackLabel: "Built-in Scout SVG",
    fallbackRender: () => <ScoutPeekingLedgeSvg className="size-12" />,
  },
];

const COVER_SHAPES: {
  id: Exclude<CoverShapeTab, "overview">;
  label: string;
  shortLabel: string;
  spec: string;
  aspectNum: number;
  ratio: string;
  frontSlot: BrandAssetSlot;
  backSlot: BrandAssetSlot;
  frontHint: string;
  backHint: string;
}[] = [
  {
    id: "square",
    label: "Square (1:1)",
    shortLabel: "Square",
    spec: "~1024×1024 PNG",
    aspectNum: 1,
    ratio: "1/1",
    frontSlot: "defaultCoverFront",
    backSlot: "defaultCoverBack",
    frontHint: "Universal fallback front cover for square books. Keep top third clear for the title.",
    backHint: "Universal fallback back cover for square books.",
  },
  {
    id: "wide",
    label: "Landscape (22:17)",
    shortLabel: "Landscape",
    spec: "~1536×1024 PNG",
    aspectNum: 1.3,
    ratio: "22/17",
    frontSlot: "defaultCoverFrontWide",
    backSlot: "defaultCoverBackWide",
    frontHint: "Fallback front cover for wide/landscape books. Keep top third clear for the title.",
    backHint: "Fallback back cover for wide/landscape books.",
  },
  {
    id: "portrait",
    label: "Portrait (4:5)",
    shortLabel: "Portrait",
    spec: "~1024×1280 PNG",
    aspectNum: 0.8,
    ratio: "4/5",
    frontSlot: "defaultCoverFrontPortrait",
    backSlot: "defaultCoverBackPortrait",
    frontHint: "Fallback front cover for tall/portrait books. Keep top third clear for the title.",
    backHint: "Fallback back cover for tall/portrait books.",
  },
];

const BACKCOVER_META: AssetMeta = {
  slot: "backCoverLogo",
  label: "Backcover publisher stamp",
  whereUsed: "Bottom-left of every printed & ebook back cover",
  spec: "SVG / transparent PNG",
  hint: "Baked into every print/ebook PDF on the server so it always appears and cannot be removed in the studio.",
  ratio: "1/1",
  category: "print",
  keywords: "backcover back cover logo stamp print pdf imprint",
};

const ALL_ASSET_METAS: AssetMeta[] = [
  ...CORE_ASSETS,
  ...CHARACTER_ASSETS,
  ...COVER_SHAPES.flatMap((s): AssetMeta[] => [
    {
      slot: s.frontSlot,
      label: `Default front cover — ${s.shortLabel}`,
      whereUsed: `${s.label} studio library fallback`,
      spec: s.spec,
      hint: s.frontHint,
      ratio: s.ratio,
      category: "covers",
      keywords: `cover front default fallback ${s.id} ${s.label.toLowerCase()}`,
    },
    {
      slot: s.backSlot,
      label: `Default back cover — ${s.shortLabel}`,
      whereUsed: `${s.label} studio library fallback`,
      spec: s.spec,
      hint: s.backHint,
      ratio: s.ratio,
      category: "covers",
      keywords: `cover back default fallback ${s.id} ${s.label.toLowerCase()}`,
    },
  ]),
  BACKCOVER_META,
];

/**
 * Marketing → Branding: high-density Brand Kit control center.
 *
 * Designed for zero scroll-bloat and instant findability:
 * 1. Top navigation bar with category tabs, instant keyword search, and a status filter.
 * 2. Compact horizontal asset rows (~80px tall instead of 500px+ aspect boxes) with
 *    drag-and-drop upload, real SVG fallback previews, and on-demand inspection/history modal.
 * 3. Contextual live previews (Navbar/Tab strip, Character Curtain-Call strip, Format-tabbed Book Spread,
 *    and Backcover/Watermark simulators) so admins see exactly how assets behave in production.
 */
export function BrandingTab() {
  const branding = useAppConfigStore((s) => s.branding);
  const saveInfo = useAppConfigStore((s) => s.saveBrandingInfo);

  // Navigation & filter state
  const [category, setCategory] = useState<BrandingCategory>("all");
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [coverTab, setCoverTab] = useState<CoverShapeTab>("square");
  const [inspectSlot, setInspectSlot] = useState<BrandAssetSlot | null>(null);

  // Identity draft (name / tagline / colors) with manual save
  const [name, setName] = useState(branding.brandName);
  const [tagline, setTagline] = useState(branding.tagline);
  const [colors, setColors] = useState<BrandColors>(branding.colors);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setName(branding.brandName);
    setTagline(branding.tagline);
    setColors(branding.colors);
  }, [branding.brandName, branding.tagline, branding.colors, dirty]);

  const onSaveInfo = async () => {
    setSaving(true);
    try {
      await saveInfo({ brandName: name, tagline, colors });
      setDirty(false);
      toast.success("Brand identity saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  // Compute completion stats across all 16 slots + watermark
  const stats = useMemo(() => {
    const customAssets = ALL_ASSET_METAS.filter((m) => Boolean(branding[m.slot]?.imageUrl)).length;
    const hasWatermark = Boolean(branding.watermark?.imageUrl);
    const totalSlots = ALL_ASSET_METAS.length + 1; // +1 for watermark
    const customTotal = customAssets + (hasWatermark ? 1 : 0);
    return { customTotal, totalSlots };
  }, [branding]);

  const normalizedQuery = search.trim().toLowerCase();

  const matchesFilter = (meta: AssetMeta) => {
    if (onlyMissing && Boolean(branding[meta.slot]?.imageUrl)) return false;
    if (!normalizedQuery) return true;
    const haystack = `${meta.label} ${meta.whereUsed} ${meta.hint} ${meta.keywords} ${meta.slot}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  };

  const filteredCore = CORE_ASSETS.filter(matchesFilter);
  const filteredCharacters = CHARACTER_ASSETS.filter(matchesFilter);
  const filteredCovers = ALL_ASSET_METAS.filter((m) => m.category === "covers" && matchesFilter(m));
  const showBackcover = matchesFilter(BACKCOVER_META);
  const showWatermark =
    (!onlyMissing || !branding.watermark?.imageUrl) &&
    (!normalizedQuery ||
      "share watermark overlay opacity scale public book".includes(normalizedQuery));
  const showIdentityFields =
    !onlyMissing &&
    (!normalizedQuery ||
      "identity brand name tagline primary accent color hex theme".includes(normalizedQuery));

  const showIdentitySection =
    (category === "all" || category === "identity") &&
    (showIdentityFields || filteredCore.length > 0);
  const showCharactersSection =
    (category === "all" || category === "characters") && filteredCharacters.length > 0;
  const showCoversSection =
    (category === "all" || category === "covers") && filteredCovers.length > 0;
  const showPrintSection =
    (category === "all" || category === "print") && (showBackcover || showWatermark);

  const inspectedMeta = useMemo(
    () => (inspectSlot ? ALL_ASSET_METAS.find((m) => m.slot === inspectSlot) ?? null : null),
    [inspectSlot],
  );

  return (
    <div className="space-y-4">
      {/* ---- Top Control Bar: Category Tabs + Quick Search + Status Filter ---- */}
      <div className="flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <EditorTabs
            value={category}
            onChange={(id) => setCategory(id as BrandingCategory)}
            items={[
              { id: "all", label: "All brand kit" },
              {
                id: "identity",
                label: `Identity & Logos (${CORE_ASSETS.filter((a) => branding[a.slot]?.imageUrl).length}/${CORE_ASSETS.length})`,
              },
              {
                id: "characters",
                label: `Characters (${CHARACTER_ASSETS.filter((a) => branding[a.slot]?.imageUrl).length}/${CHARACTER_ASSETS.length})`,
              },
              {
                id: "covers",
                label: `Book Covers (${COVER_SHAPES.reduce((n, s) => n + (branding[s.frontSlot]?.imageUrl ? 1 : 0) + (branding[s.backSlot]?.imageUrl ? 1 : 0), 0)}/6)`,
              },
              {
                id: "print",
                label: `Print & Watermark (${(branding.backCoverLogo?.imageUrl ? 1 : 0) + (branding.watermark?.imageUrl ? 1 : 0)}/2)`,
              },
            ]}
          />

          <div className="flex flex-wrap items-center gap-2">
            {/* Search input */}
            <div className="relative min-w-[210px] flex-1 sm:w-60 sm:flex-initial">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find logo, mascot, cover, color…"
                className="h-8 w-full rounded-lg border border-ink-200 bg-ink-50/50 pl-8 pr-7 text-xs text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:bg-white focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Filter to unconfigured / fallback slots */}
            <button
              type="button"
              onClick={() => setOnlyMissing((v) => !v)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition ring-1 ring-inset",
                onlyMissing
                  ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50",
              )}
              title="Show only slots that haven't had a custom file uploaded yet"
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  onlyMissing ? "bg-amber-500" : "bg-emerald-500",
                )}
              />
              {onlyMissing
                ? "Showing empty / fallback only"
                : `${stats.customTotal}/${stats.totalSlots} custom uploaded`}
            </button>
          </div>
        </div>
      </div>

      {/* ---- 1. Identity & Core Brand Marks ---- */}
      {showIdentitySection && (
        <Section
          title="Identity & Core Logos"
          hint="Brand name, tagline, theme colors, and core marks used across the navbar, studio top bar, browser tab, and social shares."
          action={
            showIdentityFields ? (
              <div className="flex items-center gap-2">
                {dirty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setName(branding.brandName);
                      setTagline(branding.tagline);
                      setColors(branding.colors);
                      setDirty(false);
                    }}
                  >
                    Discard
                  </Button>
                )}
                <Button size="sm" onClick={onSaveInfo} loading={saving} disabled={!dirty}>
                  Save identity
                </Button>
              </div>
            ) : undefined
          }
        >
          {showIdentityFields && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <TextField
                  label="Brand name"
                  value={name}
                  onChange={(v) => {
                    setName(v);
                    setDirty(true);
                  }}
                />
                <TextField
                  label="Tagline"
                  value={tagline}
                  onChange={(v) => {
                    setTagline(v);
                    setDirty(true);
                  }}
                />
                <ColorField
                  label="Primary color"
                  value={colors.primary}
                  onChange={(v) => {
                    setColors((c) => ({ ...c, primary: v }));
                    setDirty(true);
                  }}
                />
                <ColorField
                  label="Accent color"
                  value={colors.accent}
                  onChange={(v) => {
                    setColors((c) => ({ ...c, accent: v }));
                    setDirty(true);
                  }}
                />
              </div>

              {/* Compact Live Context Strip: shows Light Header, Dark Surface, and Browser Tab in one slim bar */}
              <LiveIdentityStrip
                name={name}
                tagline={tagline}
                colors={colors}
                branding={branding}
              />
            </div>
          )}

          {filteredCore.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 pt-1 lg:grid-cols-2">
              {filteredCore.map((meta) => (
                <CompactAssetRow
                  key={meta.slot}
                  meta={meta}
                  asset={branding[meta.slot]}
                  history={branding.assetHistory[meta.slot] ?? []}
                  onInspect={() => setInspectSlot(meta.slot)}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ---- 2. Mascots, Studio Guide & Footer Characters ---- */}
      {showCharactersSection && (
        <Section
          title="Characters & Mascots"
          hint="Storybook companions across the Contact card, Studio chat guide, and Footer curtain-call. Every slot has a built-in vector illustration when left empty."
        >
          {/* Compact live stage showing the 3 footer mascots & contact courier in context */}
          {!normalizedQuery && !onlyMissing && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-ink-100 bg-ink-50/50 p-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3.5 py-2.5 ring-1 ring-inset ring-ink-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-800">
                    <Sparkles className="size-3.5 text-brand-500" />
                    Contact & Studio Companions
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    Hugo (Contact modal) &amp; Studio Guide (Chat)
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setInspectSlot("contactMascot")}
                    title="Inspect Contact mascot (Hugo)"
                    className="group relative flex size-12 items-center justify-center rounded-lg bg-ink-50/80 p-1 ring-1 ring-ink-100 transition hover:ring-brand-300"
                  >
                    {branding.contactMascot?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={branding.contactMascot.imageUrl}
                        alt="Hugo"
                        className="size-full object-contain"
                      />
                    ) : (
                      <HugoCourierSvg className="size-full" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInspectSlot("guideAvatar")}
                    title="Inspect Studio guide avatar"
                    className="group relative flex size-11 items-center justify-center overflow-hidden rounded-full bg-linear-to-b from-amber-50 to-orange-100 p-1 ring-1 ring-amber-900/15 transition hover:ring-2 hover:ring-brand-400"
                  >
                    {branding.guideAvatar?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={branding.guideAvatar.imageUrl}
                        alt="Guide"
                        className="size-full rounded-full object-cover"
                      />
                    ) : (
                      <HedgehogPlaceholder className="size-[86%]" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3.5 py-2.5 ring-1 ring-inset ring-ink-100">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink-800">Footer Colophon Ledge</div>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    Live preview of Momo, Cleo &amp; Scout along the footer rule
                  </p>
                </div>
                <div className="shrink-0 border-b border-ink-200 px-1">
                  <FooterMascots
                    leftUrl={branding.footerMascotLeft?.imageUrl}
                    centerUrl={branding.footerMascotCenter?.imageUrl}
                    rightUrl={branding.footerMascotRight?.imageUrl}
                    className="[&>div]:!size-11 gap-1.5"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {filteredCharacters.map((meta) => (
              <CompactAssetRow
                key={meta.slot}
                meta={meta}
                asset={branding[meta.slot]}
                history={branding.assetHistory[meta.slot] ?? []}
                onInspect={() => setInspectSlot(meta.slot)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* ---- 3. Default Book Covers (Format-Tabbed + Matrix Overview) ---- */}
      {showCoversSection && (
        <DefaultCoversSection
          branding={branding}
          coverTab={
            normalizedQuery || onlyMissing ? "overview" : coverTab
          }
          onCoverTabChange={setCoverTab}
          filteredCovers={filteredCovers}
          onInspect={(slot) => setInspectSlot(slot)}
        />
      )}

      {/* ---- 4. Print Imprint & Share Watermark ---- */}
      {showPrintSection && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {showBackcover && (
            <BackCoverLogoSection
              branding={branding}
              onInspect={() => setInspectSlot("backCoverLogo")}
            />
          )}
          {showWatermark && <WatermarkCard />}
        </div>
      )}

      {/* Empty search state */}
      {!showIdentitySection &&
        !showCharactersSection &&
        !showCoversSection &&
        !showPrintSection && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-200 bg-white py-10 text-center">
            <Search className="size-5 text-ink-400" />
            <p className="text-sm font-medium text-ink-700">No branding settings match your filter</p>
            <p className="text-xs text-ink-400">
              Try clearing your search query or switching back to &ldquo;All brand kit&rdquo;.
            </p>
            <div className="mt-1 flex gap-2">
              {search && (
                <Button variant="secondary" size="sm" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              )}
              {onlyMissing && (
                <Button variant="secondary" size="sm" onClick={() => setOnlyMissing(false)}>
                  Show all slots
                </Button>
              )}
            </div>
          </div>
        )}

      {/* ---- On-Demand Full Preview, Alt Text & Version History Modal ---- */}
      <AssetInspectorModal
        meta={inspectedMeta}
        asset={inspectedMeta ? branding[inspectedMeta.slot] : null}
        history={inspectedMeta ? branding.assetHistory[inspectedMeta.slot] ?? [] : []}
        onClose={() => setInspectSlot(null)}
      />
    </div>
  );
}

/**
 * Slim horizontal preview showing how the current identity settings look in:
 * 1. The site header / Studio TopBar (light surface)
 * 2. Dark surface banner (`logoDark`)
 * 3. Browser tab (`favicon` + title)
 */
function LiveIdentityStrip({
  name,
  tagline,
  colors,
  branding,
}: {
  name: string;
  tagline: string;
  colors: BrandColors;
  branding: BrandingConfig;
}) {
  const displayName = name.trim() || "Childbook Studio";
  return (
    <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-ink-100 bg-ink-50/50 p-2.5 md:grid-cols-3">
      {/* 1. Light Navbar / TopBar preview */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-ink-100">
        <div className="min-w-0 flex-1 pointer-events-none">
          <BrandMark
            siteName={displayName}
            tagline={tagline}
            logoUrl={branding.logo?.imageUrl}
            iconUrl={branding.icon?.imageUrl}
            size="sm"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-2xs"
            style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(colors.primary) ? colors.primary : "#f96a4d" }}
          >
            Primary
          </span>
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-ink-900 shadow-2xs"
            style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(colors.accent) ? colors.accent : "#f79b04" }}
          >
            Accent
          </span>
        </div>
      </div>

      {/* 2. Dark Surface preview */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-ink-900 px-3 py-2 text-white">
        <div className="flex min-w-0 items-center gap-2">
          {branding.logoDark?.imageUrl || branding.logo?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoDark?.imageUrl ?? branding.logo?.imageUrl}
              alt={displayName}
              className="h-6 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <span className="truncate font-display text-sm font-medium text-white">
              {displayName}
            </span>
          )}
        </div>
        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
          {branding.logoDark?.imageUrl ? "Dark logo" : "Dark surface"}
        </span>
      </div>

      {/* 3. Browser Tab & Favicon preview */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-ink-100/80 px-3 py-2 ring-1 ring-inset ring-ink-200/60">
        <div className="flex min-w-0 items-center gap-2 rounded-t-md bg-white px-2.5 py-1 shadow-2xs ring-1 ring-ink-200/60">
          {branding.favicon?.imageUrl || branding.icon?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.favicon?.imageUrl ?? branding.icon?.imageUrl}
              alt=""
              className="size-3.5 shrink-0 object-contain"
            />
          ) : (
            <Globe className="size-3.5 shrink-0 text-ink-400" />
          )}
          <span className="truncate text-[11px] font-medium text-ink-800">
            {displayName}
            {tagline.trim() ? ` — ${tagline.trim()}` : ""}
          </span>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-ink-400">Browser tab</span>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <label className="relative flex h-9 w-11 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-ink-200 bg-white p-0.5 shadow-2xs">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <span
            className="size-full rounded-md ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : "#000000" }}
          />
        </label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
    </Field>
  );
}

/**
 * High-density horizontal card for a single brand asset slot.
 * Supports click-to-upload, drag-and-drop file upload, 1-click remove, and an
 * inspector modal trigger for full-size preview, alt text, and version history.
 */
function CompactAssetRow({
  meta,
  asset,
  history,
  inheritedFrom,
  onInspect,
}: {
  meta: AssetMeta;
  asset: BrandAsset | null;
  history: BrandAsset[];
  /** Optional fallback asset when this slot is empty (e.g. wide cover inheriting square cover). */
  inheritedFrom?: { asset: BrandAsset; label: string } | null;
  onInspect: () => void;
}) {
  const upload = useAppConfigStore((s) => s.uploadBrandingAsset);
  const remove = useAppConfigStore((s) => s.removeBrandingAsset);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      await upload(meta.slot, base64, mimeType, asset?.alt);
      toast.success(`${meta.label} updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await remove(meta.slot);
      toast.success(`${meta.label} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  };

  const hasCustom = Boolean(asset?.imageUrl);
  const hasBuiltInSvg = Boolean(meta.fallbackRender);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void onPick(file);
      }}
      className={cn(
        "group relative flex items-center gap-3.5 rounded-xl bg-white p-3 ring-1 ring-inset transition",
        dragOver
          ? "bg-brand-50/40 ring-2 ring-brand-400"
          : "ring-ink-100 hover:ring-ink-200",
      )}
    >
      {/* Thumbnail preview (clickable to open full inspector) */}
      <button
        type="button"
        onClick={onInspect}
        title="Click to inspect full preview & version history"
        className={cn(
          "relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-inset transition group-hover:ring-brand-300",
          meta.dark
            ? "bg-ink-900 ring-ink-700"
            : "bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:8px_8px] bg-ink-50/70 ring-ink-100",
        )}
      >
        {hasCustom ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset!.imageUrl}
            alt={asset!.alt ?? meta.label}
            className="max-h-full max-w-full object-contain p-1.5"
          />
        ) : inheritedFrom?.asset.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={inheritedFrom.asset.imageUrl}
            alt={meta.label}
            className="max-h-full max-w-full object-contain p-1.5 opacity-55"
          />
        ) : meta.fallbackRender ? (
          <div className="flex items-center justify-center p-1">{meta.fallbackRender()}</div>
        ) : (
          <ImageIcon className={cn("size-5", meta.dark ? "text-ink-600" : "text-ink-300")} />
        )}

        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink-900/45 opacity-0 transition-opacity group-hover:opacity-100">
          <Eye className="size-4 text-white" />
        </span>
      </button>

      {/* Asset metadata & status */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-ink-900">{meta.label}</span>
          {hasCustom ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200/60">
              <CheckCircle2 className="size-2.5" />
              Custom
            </span>
          ) : inheritedFrom ? (
            <span className="inline-flex items-center rounded-full bg-sky-50 px-1.5 py-0.2 text-[10px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200/60">
              Inherits {inheritedFrom.label}
            </span>
          ) : hasBuiltInSvg || meta.fallbackLabel ? (
            <span className="inline-flex items-center rounded-full bg-amber-50/90 px-1.5 py-0.2 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200/60">
              {meta.fallbackLabel ?? "Built-in SVG"}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-ink-100 px-1.5 py-0.2 text-[10px] font-medium text-ink-500">
              Empty
            </span>
          )}
        </div>

        <p className="truncate text-[11px] text-ink-500" title={meta.hint}>
          <span className="font-medium text-ink-600">{meta.whereUsed}</span>
          {" · "}
          <span className="text-ink-400">{meta.spec}</span>
        </p>

        <p className="line-clamp-1 text-[11px] text-ink-400" title={meta.hint}>
          {meta.hint}
        </p>
      </div>

      {/* Direct Action Buttons */}
      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml,image/png,image/webp,image/jpeg,image/x-icon"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <div className="flex shrink-0 items-center gap-1.5">
        {history.length > 0 && (
          <button
            type="button"
            onClick={onInspect}
            title={`${history.length} previous version${history.length === 1 ? "" : "s"} — click to restore or manage`}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
          >
            <History className="size-3.5" />
            <span className="tabular-nums">{history.length}</span>
          </button>
        )}

        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          leftIcon={<Upload className="size-3.5" />}
          onClick={() => inputRef.current?.click()}
        >
          {hasCustom ? "Replace" : "Upload"}
        </Button>

        {hasCustom && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRemove()}
            title={`Remove custom ${meta.label.toLowerCase()}`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Default Book Covers section with a format switcher (`Square 1:1`, `Landscape 22:17`,
 * `Portrait 4:5`, plus `All 6 overview`) so 6 giant aspect-ratio cards never stack vertically.
 */
function DefaultCoversSection({
  branding,
  coverTab,
  onCoverTabChange,
  filteredCovers,
  onInspect,
}: {
  branding: BrandingConfig;
  coverTab: CoverShapeTab;
  onCoverTabChange: (t: CoverShapeTab) => void;
  filteredCovers: AssetMeta[];
  onInspect: (slot: BrandAssetSlot) => void;
}) {
  const activeShape = COVER_SHAPES.find((s) => s.id === coverTab) ?? COVER_SHAPES[0]!;

  // Resolve what the book studio will actually show for this shape (including fallback inheritance)
  const resolvedFront = defaultCoverAsset(branding, activeShape.aspectNum, "front");
  const resolvedBack = defaultCoverAsset(branding, activeShape.aspectNum, "back");
  const ownFront = branding[activeShape.frontSlot];
  const ownBack = branding[activeShape.backSlot];

  const frontMeta = ALL_ASSET_METAS.find((m) => m.slot === activeShape.frontSlot)!;
  const backMeta = ALL_ASSET_METAS.find((m) => m.slot === activeShape.backSlot)!;

  return (
    <Section
      title="Default Book Covers"
      hint="Fallback front & back covers shown in the studio library before a project has generated its own cover art. Square is the universal fallback if Landscape or Portrait is left empty."
      action={
        <div
          className="inline-flex flex-wrap gap-1 rounded-xl bg-ink-100/80 p-1 ring-1 ring-inset ring-ink-200/60"
          role="tablist"
        >
          {COVER_SHAPES.map((s) => {
            const count =
              (branding[s.frontSlot]?.imageUrl ? 1 : 0) +
              (branding[s.backSlot]?.imageUrl ? 1 : 0);
            const active = coverTab === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onCoverTabChange(s.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-white text-ink-900 shadow-2xs"
                    : "text-ink-600 hover:text-ink-900",
                )}
              >
                <span>{s.shortLabel}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] tabular-nums",
                    count === 2
                      ? "bg-emerald-100 text-emerald-800"
                      : count === 1
                        ? "bg-amber-100 text-amber-800"
                        : "bg-ink-200/70 text-ink-500",
                  )}
                >
                  {count}/2
                </span>
              </button>
            );
          })}
          <button
            type="button"
            role="tab"
            aria-selected={coverTab === "overview"}
            onClick={() => onCoverTabChange("overview")}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              coverTab === "overview"
                ? "bg-white text-ink-900 shadow-2xs"
                : "text-ink-600 hover:text-ink-900",
            )}
          >
            <Layers className="size-3.5" />
            All 6
          </button>
        </div>
      }
    >
      {coverTab === "overview" ? (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          {filteredCovers.map((meta) => {
            const isFront = meta.slot.toLowerCase().includes("front");
            const fallbackAsset =
              meta.slot !== "defaultCoverFront" && meta.slot !== "defaultCoverBack"
                ? isFront
                  ? branding.defaultCoverFront
                  : branding.defaultCoverBack
                : null;
            return (
              <CompactAssetRow
                key={meta.slot}
                meta={meta}
                asset={branding[meta.slot]}
                history={branding.assetHistory[meta.slot] ?? []}
                inheritedFrom={
                  !branding[meta.slot]?.imageUrl && fallbackAsset?.imageUrl
                    ? { asset: fallbackAsset, label: "Square" }
                    : null
                }
                onInspect={() => onInspect(meta.slot)}
              />
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Compact Book Spread Preview for the selected format */}
          <div className="flex flex-col items-center justify-between gap-4 rounded-xl border border-ink-100 bg-ink-50/50 p-3.5 sm:flex-row">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <BookOpen className="size-4 text-brand-500" />
                <span className="text-xs font-semibold text-ink-800">
                  {activeShape.label} Spread Preview
                </span>
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-500 ring-1 ring-ink-100">
                  {activeShape.spec}
                </span>
              </div>
              <p className="max-w-md text-[11px] leading-relaxed text-ink-500">
                How an unillustrated {activeShape.shortLabel.toLowerCase()} book appears in the customer&apos;s library.
                {(!ownFront?.imageUrl || !ownBack?.imageUrl) && activeShape.id !== "square" && (
                  <span className="text-ink-600">
                    {" "}
                    Empty slots automatically fall back to the Square cover if one is uploaded.
                  </span>
                )}
              </p>
            </div>

            {/* Miniature Back + Spine + Front spread */}
            <div className="flex shrink-0 items-center gap-1 rounded-xl bg-white p-2.5 shadow-2xs ring-1 ring-ink-100">
              {/* Back cover */}
              <button
                type="button"
                onClick={() => onInspect(activeShape.backSlot)}
                style={{ aspectRatio: activeShape.ratio }}
                className="group relative h-24 overflow-hidden rounded-l-md bg-ink-100 ring-1 ring-ink-200"
                title="Back cover preview (click to inspect)"
              >
                {resolvedBack?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolvedBack.imageUrl}
                    alt="Back cover"
                    className={cn(
                      "size-full object-cover",
                      !ownBack?.imageUrl && "opacity-70",
                    )}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center px-2 text-center text-[10px] text-ink-400">
                    Back
                  </div>
                )}
                <span className="absolute bottom-1 left-1 rounded bg-ink-900/65 px-1 py-0.2 text-[9px] font-medium text-white">
                  Back
                </span>
              </button>

              {/* Spine crease */}
              <div className="h-24 w-1 rounded-full bg-ink-300/70" />

              {/* Front cover */}
              <button
                type="button"
                onClick={() => onInspect(activeShape.frontSlot)}
                style={{ aspectRatio: activeShape.ratio }}
                className="group relative h-24 overflow-hidden rounded-r-md bg-ink-100 ring-1 ring-ink-200"
                title="Front cover preview (click to inspect)"
              >
                {resolvedFront?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolvedFront.imageUrl}
                    alt="Front cover"
                    className={cn(
                      "size-full object-cover",
                      !ownFront?.imageUrl && "opacity-70",
                    )}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center px-2 text-center text-[10px] text-ink-400">
                    Front
                  </div>
                )}
                {/* Top-third title safe-zone guide */}
                <div className="pointer-events-none absolute inset-x-1.5 top-1.5 flex h-5 items-center justify-center rounded border border-dashed border-white/70 bg-ink-900/25 text-[8px] font-medium uppercase tracking-wider text-white">
                  Title zone
                </div>
                <span className="absolute bottom-1 right-1 rounded bg-ink-900/65 px-1 py-0.2 text-[9px] font-medium text-white">
                  Front
                </span>
              </button>
            </div>
          </div>

          {/* Front & Back upload rows side-by-side */}
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            <CompactAssetRow
              meta={frontMeta}
              asset={ownFront}
              history={branding.assetHistory[activeShape.frontSlot] ?? []}
              inheritedFrom={
                !ownFront?.imageUrl &&
                activeShape.id !== "square" &&
                branding.defaultCoverFront?.imageUrl
                  ? { asset: branding.defaultCoverFront, label: "Square" }
                  : null
              }
              onInspect={() => onInspect(activeShape.frontSlot)}
            />
            <CompactAssetRow
              meta={backMeta}
              asset={ownBack}
              history={branding.assetHistory[activeShape.backSlot] ?? []}
              inheritedFrom={
                !ownBack?.imageUrl &&
                activeShape.id !== "square" &&
                branding.defaultCoverBack?.imageUrl
                  ? { asset: branding.defaultCoverBack, label: "Square" }
                  : null
              }
              onInspect={() => onInspect(activeShape.backSlot)}
            />
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * Backcover Publisher Stamp section: combines the upload row, fixed-edge cm slider/input,
 * and a visual corner-stamp diagram in one compact card.
 */
function BackCoverLogoSection({
  branding,
  onInspect,
}: {
  branding: BrandingConfig;
  onInspect: () => void;
}) {
  const saveInfo = useAppConfigStore((s) => s.saveBrandingInfo);
  const sizeCm = branding.backCoverLogoSizeCm ?? DEFAULT_BACK_COVER_LOGO_SIZE_CM;
  const [value, setValue] = useState(String(sizeCm));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setValue(String(sizeCm));
  }, [sizeCm, dirty]);

  const parsed = Number(value);
  const valid =
    Number.isFinite(parsed) &&
    parsed >= MIN_BACK_COVER_LOGO_SIZE_CM &&
    parsed <= MAX_BACK_COVER_LOGO_SIZE_CM;

  const onSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await saveInfo({ backCoverLogoSizeCm: parsed });
      setDirty(false);
      toast.success("Backcover logo size saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  // Approximate visual proportion on a ~21cm square book cover
  const previewFraction = Math.min(
    0.45,
    Math.max(0.08, (valid ? parsed : sizeCm) / 21),
  );

  return (
    <Section
      title="Backcover Publisher Stamp"
      hint="Stamped bottom-left on every printed wraparound cover and digital ebook back cover at render time. Cannot be removed from the studio."
    >
      <CompactAssetRow
        meta={BACKCOVER_META}
        asset={branding.backCoverLogo}
        history={branding.assetHistory.backCoverLogo ?? []}
        onInspect={onInspect}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-ink-100 bg-ink-50/40 p-3 sm:flex-row sm:items-center">
        {/* Mini visual of bottom-left back cover corner */}
        <div
          className="relative flex size-24 shrink-0 items-end justify-start overflow-hidden rounded-lg border border-ink-200 bg-linear-to-br from-amber-50/80 to-orange-100/70 p-2.5 shadow-2xs"
          title="Relative scale on a 21×21 cm square back cover"
        >
          <span className="absolute right-1.5 top-1 text-[9px] font-medium text-ink-400">
            Back cover
          </span>
          {branding.backCoverLogo?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.backCoverLogo.imageUrl}
              alt="Backcover stamp"
              style={{
                width: `${Math.round(previewFraction * 100 * 1.4)}%`,
                maxHeight: "65%",
              }}
              className="object-contain object-left-bottom"
            />
          ) : (
            <div className="flex items-center gap-1 rounded border border-dashed border-ink-300 bg-white/80 px-1.5 py-0.5 text-[9px] text-ink-500">
              <Stamp className="size-2.5" />
              {valid ? parsed : sizeCm} cm
            </div>
          )}
        </div>

        {/* Fixed edge size control */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-800">
              Fixed edge size ({MIN_BACK_COVER_LOGO_SIZE_CM}–{MAX_BACK_COVER_LOGO_SIZE_CM} cm)
            </span>
            <span className="text-[11px] text-ink-500">
              Landscape = height · Portrait = width
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <input
              type="range"
              min={MIN_BACK_COVER_LOGO_SIZE_CM}
              max={MAX_BACK_COVER_LOGO_SIZE_CM}
              step={0.1}
              value={valid ? parsed : sizeCm}
              onChange={(e) => {
                setValue(e.target.value);
                setDirty(true);
              }}
              className="flex-1"
            />
            <div className="flex w-24 shrink-0 items-center gap-1">
              <Input
                type="number"
                min={MIN_BACK_COVER_LOGO_SIZE_CM}
                max={MAX_BACK_COVER_LOGO_SIZE_CM}
                step={0.1}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setDirty(true);
                }}
                className="h-8 text-xs tabular-nums"
              />
              <span className="text-xs text-ink-400">cm</span>
            </div>
            {dirty && (
              <Button
                size="sm"
                onClick={onSave}
                loading={saving}
                disabled={!valid}
              >
                Save
              </Button>
            )}
          </div>
          {!valid && (
            <p className="text-[11px] text-red-500">
              Enter a size between {MIN_BACK_COVER_LOGO_SIZE_CM} and {MAX_BACK_COVER_LOGO_SIZE_CM} cm.
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}

/**
 * Share Watermark section: compact upload row + side-by-side live preview and sliders,
 * with version history accessible via modal so it doesn't clutter the page.
 */
function WatermarkCard() {
  const watermark = useAppConfigStore((s) => s.branding.watermark);
  const watermarkHistory = useAppConfigStore((s) => s.branding.watermarkHistory);
  const uploadWatermark = useAppConfigStore((s) => s.uploadWatermark);
  const updateAppearance = useAppConfigStore((s) => s.updateWatermarkAppearance);
  const removeWatermark = useAppConfigStore((s) => s.removeWatermark);
  const restore = useAppConfigStore((s) => s.restoreWatermark);
  const deleteVersion = useAppConfigStore((s) => s.deleteWatermarkVersion);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [opacity, setOpacity] = useState(watermark?.opacity ?? 0.5);
  const [scale, setScale] = useState(watermark?.scale ?? 0.25);

  useEffect(() => {
    setOpacity(watermark?.opacity ?? 0.5);
    setScale(watermark?.scale ?? 0.25);
  }, [watermark?.opacity, watermark?.scale, watermark?.imageUrl]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      await uploadWatermark(base64, mimeType, opacity, scale);
      toast.success("Watermark updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const commit = async (patch: { opacity?: number; scale?: number }) => {
    try {
      await updateAppearance(patch);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save appearance.");
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await removeWatermark();
      toast.success("Watermark removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove watermark.");
    } finally {
      setBusy(false);
    }
  };

  const hasCustom = Boolean(watermark?.imageUrl);

  return (
    <Section
      title="Public Share Watermark"
      hint="Overlay shown on publicly shared books for free-plan readers (hidden when the publisher's plan includes “remove watermark”)."
    >
      {/* Upload Row */}
      <div className="flex items-center gap-3.5 rounded-xl bg-white p-3 ring-1 ring-inset ring-ink-100">
        <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-linear-to-br from-brand-100 to-amber-100 ring-1 ring-inset ring-ink-100">
          {hasCustom ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={watermark!.imageUrl}
              alt="Watermark preview"
              className="max-h-full max-w-full object-contain p-1.5"
              style={{ opacity }}
            />
          ) : (
            <ImageIcon className="size-5 text-ink-400" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-ink-900">Watermark overlay</span>
            {hasCustom ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200/60">
                <CheckCircle2 className="size-2.5" />
                Active
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-ink-100 px-1.5 py-0.2 text-[10px] font-medium text-ink-500">
                None set
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink-500">
            SVG or transparent PNG · Rendered over shared book pages
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/svg+xml,image/png,image/webp"
          className="hidden"
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {watermarkHistory.length > 0 && (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              title={`${watermarkHistory.length} previous version${watermarkHistory.length === 1 ? "" : "s"}`}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
            >
              <History className="size-3.5" />
              <span className="tabular-nums">{watermarkHistory.length}</span>
            </button>
          )}
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            leftIcon={<Upload className="size-3.5" />}
            onClick={() => inputRef.current?.click()}
          >
            {hasCustom ? "Replace" : "Upload"}
          </Button>
          {hasCustom && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRemove()}
              title="Remove watermark"
              className="inline-flex size-8 items-center justify-center rounded-lg text-ink-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Compact Live Page Simulator + Sliders */}
      <div className="flex flex-col gap-3 rounded-xl border border-ink-100 bg-ink-50/40 p-3 sm:flex-row sm:items-center">
        <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-linear-to-br from-brand-100 via-amber-50 to-sky-100 shadow-2xs">
          <span className="absolute left-1.5 top-1 text-[9px] font-medium text-ink-400">
            Shared page
          </span>
          {hasCustom ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={watermark!.imageUrl}
              alt="Watermark preview"
              className="
                absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain
              "
              style={{ width: `${Math.round(scale * 100)}%`, opacity }}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-[10px] text-ink-400">
              No watermark
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="block">
            <div className="flex items-center justify-between text-xs font-medium text-ink-700">
              <span>Opacity</span>
              <span className="tabular-nums text-ink-500">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={opacity}
              disabled={!hasCustom}
              onChange={(e) => setOpacity(Number(e.target.value))}
              onMouseUp={() => void commit({ opacity })}
              onTouchEnd={() => void commit({ opacity })}
              className="mt-1.5 w-full"
            />
          </label>

          <label className="block">
            <div className="flex items-center justify-between text-xs font-medium text-ink-700">
              <span>Width on page</span>
              <span className="tabular-nums text-ink-500">{Math.round(scale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={scale}
              disabled={!hasCustom}
              onChange={(e) => setScale(Number(e.target.value))}
              onMouseUp={() => void commit({ scale })}
              onTouchEnd={() => void commit({ scale })}
              className="mt-1.5 w-full"
            />
          </label>
        </div>
      </div>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Watermark — Version History"
        size="max-w-lg"
      >
        <VersionHistory
          versions={watermarkHistory}
          onRestore={(sp) => restore(sp)}
          onDelete={(sp) => deleteVersion(sp)}
        />
      </Modal>
    </Section>
  );
}

/**
 * Modal for inspecting an asset at full resolution, replacing it, and restoring
 * or deleting versions from its history.
 */
function AssetInspectorModal({
  meta,
  asset,
  history,
  onClose,
}: {
  meta: AssetMeta | null;
  asset: BrandAsset | null;
  history: BrandAsset[];
  onClose: () => void;
}) {
  const upload = useAppConfigStore((s) => s.uploadBrandingAsset);
  const remove = useAppConfigStore((s) => s.removeBrandingAsset);
  const restore = useAppConfigStore((s) => s.restoreBrandingAsset);
  const deleteVersion = useAppConfigStore((s) => s.deleteBrandingAssetVersion);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!meta) return null;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      await upload(meta.slot, base64, mimeType, asset?.alt);
      toast.success(`${meta.label} updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await remove(meta.slot);
      toast.success(`${meta.label} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(meta)} onClose={onClose} title={meta.label} size="max-w-xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <span>
            <strong className="font-medium text-ink-700">Where used:</strong> {meta.whereUsed}
          </span>
          <span className="rounded bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-ink-600">
            {meta.spec}
          </span>
        </div>

        <p className="text-xs leading-relaxed text-ink-500">{meta.hint}</p>

        {/* Full-size bounded preview */}
        <div
          className={cn(
            "flex max-h-72 min-h-44 w-full items-center justify-center overflow-hidden rounded-xl p-4 ring-1 ring-inset",
            meta.dark
              ? "bg-ink-900 ring-ink-700"
              : "bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:12px_12px] bg-ink-50 ring-ink-100",
          )}
        >
          {asset?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.imageUrl}
              alt={asset.alt ?? meta.label}
              className="max-h-64 max-w-full object-contain"
            />
          ) : meta.fallbackRender ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="scale-125">{meta.fallbackRender()}</div>
              <span className="text-[11px] text-ink-400">
                Currently using built-in SVG illustration
              </span>
            </div>
          ) : (
            <span className="text-xs text-ink-400">No custom {meta.label.toLowerCase()} uploaded</span>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/svg+xml,image/png,image/webp,image/jpeg,image/x-icon"
          className="hidden"
          onChange={(e) => void onPick(e.target.files?.[0])}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              leftIcon={<Upload className="size-3.5" />}
              onClick={() => inputRef.current?.click()}
            >
              {asset?.imageUrl ? "Replace file" : "Upload file"}
            </Button>
            {asset?.imageUrl && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                leftIcon={<Trash2 className="size-3.5" />}
                onClick={() => void onRemove()}
              >
                Remove
              </Button>
            )}
          </div>
          {asset?.updatedAt && (
            <span className="text-[11px] text-ink-400">
              Updated {new Date(asset.updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>

        {history.length > 0 ? (
          <VersionHistory
            versions={history}
            dark={meta.dark}
            onRestore={(sp) => restore(meta.slot, sp)}
            onDelete={(sp) => deleteVersion(meta.slot, sp)}
          />
        ) : (
          <p className="border-t border-ink-100 pt-3 text-[11px] text-ink-400">
            No previous versions yet. Replacing an image keeps the old one here so you can restore it anytime.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** A strip of previous versions with restore + permanent-delete actions. */
function VersionHistory({
  versions,
  dark,
  onRestore,
  onDelete,
}: {
  versions: (BrandAsset | BrandingWatermark)[];
  dark?: boolean;
  onRestore: (storagePath: string) => Promise<void>;
  onDelete: (storagePath: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (versions.length === 0) return null;

  const run = async (sp: string, fn: () => Promise<void>, ok: string) => {
    setBusy(sp);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 border-t border-ink-100 pt-3">
      <div className="text-xs font-semibold text-ink-700">
        Previous versions ({versions.length})
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {versions.map((v) =>
          v.storagePath ? (
            <div
              key={v.storagePath}
              className="flex flex-col items-center rounded-lg border border-ink-100 p-2"
            >
              <div
                className={cn(
                  "flex size-16 items-center justify-center overflow-hidden rounded-md ring-1 ring-inset ring-ink-100",
                  dark ? "bg-ink-900" : "bg-ink-50",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.imageUrl}
                  alt=""
                  className="max-h-full max-w-full object-contain p-1"
                />
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  type="button"
                  title="Restore this version"
                  disabled={busy === v.storagePath}
                  onClick={() =>
                    void run(
                      v.storagePath!,
                      () => onRestore(v.storagePath!),
                      "Version restored.",
                    )
                  }
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-600 hover:bg-ink-100 hover:text-brand-600 disabled:opacity-50"
                >
                  <RotateCcw className="size-3" />
                  Restore
                </button>
                <button
                  type="button"
                  title="Delete permanently"
                  disabled={busy === v.storagePath}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Permanently delete this version? This can't be undone.",
                      )
                    ) {
                      void run(
                        v.storagePath!,
                        () => onDelete(v.storagePath!),
                        "Version deleted.",
                      );
                    }
                  }}
                  className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
