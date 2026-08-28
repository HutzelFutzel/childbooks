/**
 * "What's new" release notes — the shape we ask the model for, and how that
 * becomes a Slack message.
 *
 * Pure: no Firebase, no Node APIs, no React. The backend half (resolving the
 * admin-selected model, rendering the prompt, posting) lives in
 * `functions/src/releaseNotes.ts`.
 *
 * The split matters for one reason: THE MODEL NEVER FORMATS. It returns fields
 * and this module renders them, so a bad generation can produce a wrong note
 * but never a broken-looking message. Slack's mrkdwn is also not markdown
 * (`*bold*`, not `**bold**`), which a model gets wrong roughly as often as it
 * gets it right.
 */
import { z } from "zod";

/** Items below this are dropped: a guess posted confidently is worse than silence. */
const MIN_CONFIDENCE: Confidence[] = ["high", "medium"];

/** Most items we render; the rest collapse into a "+N smaller changes" line. */
const MAX_ITEMS = 12;

/** Slack's per-section text cap (a longer section is rejected outright). */
const SECTION_LIMIT = 3000;

export const CONFIDENCE = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

/** The kinds of change a release note can contain (drives the emoji + label). */
export const RELEASE_KINDS = [
  "new_feature",
  "improvement",
  "fix",
  "ui_change",
  "performance",
  "reliability",
  "admin",
] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

/** How each kind reads in Slack. The model picks the kind; we own the wording. */
const KIND_META: Record<ReleaseKind, { emoji: string; label: string }> = {
  new_feature: { emoji: "✨", label: "New" },
  improvement: { emoji: "🛠", label: "Improved" },
  fix: { emoji: "🐛", label: "Fixed" },
  ui_change: { emoji: "🎨", label: "Changed" },
  performance: { emoji: "⚡", label: "Faster" },
  reliability: { emoji: "🔒", label: "More reliable" },
  admin: { emoji: "⚙️", label: "Admin" },
};

/**
 * Lengths are capped in the schema rather than asked for in the prompt, so a
 * chatty generation can't blow Slack's block limits. Deliberately no unions or
 * literals: Gemini's response-schema subset drops `const` and can't express
 * them (see providers/google/schema.ts).
 */
export const releaseItemSchema = z.object({
  kind: z.enum(RELEASE_KINDS),
  audience: z.enum(["customer", "admin"]),
  title: z.string().max(90),
  detail: z.string().max(400),
  howToSeeIt: z.string().max(200),
  confidence: z.enum(CONFIDENCE),
});

export const releaseNotesSchema = z.object({
  headline: z.string().max(300),
  internalOnly: z.boolean(),
  items: z.array(releaseItemSchema).max(30),
  uncertain: z.array(z.string().max(200)).max(10),
});

export type ReleaseNotes = z.infer<typeof releaseNotesSchema>;
export type ReleaseItem = z.infer<typeof releaseItemSchema>;

/** Which release a summary describes — the footer's "receipt". */
export interface ReleaseMeta {
  repo: string;
  sha: string;
  previousSha: string;
  runUrl: string;
  commitCount: number;
}

/** Slack mrkdwn is not markdown: escape what it would otherwise interpret. */
function mrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One item as a short mrkdwn paragraph: title, then what it means, then where. */
function itemLines(item: ReleaseItem): string {
  const meta = KIND_META[item.kind];
  const lines = [`${meta.emoji}  *${mrkdwn(item.title.trim().replace(/\.$/, ""))}*`];
  if (item.detail.trim()) lines.push(`_${meta.label}_ · ${mrkdwn(item.detail.trim())}`);
  if (item.howToSeeIt.trim()) lines.push(`↳ ${mrkdwn(item.howToSeeIt.trim())}`);
  return lines.join("\n");
}

/** Section blocks for one audience group, split to respect Slack's text cap. */
function groupBlocks(heading: string, items: ReleaseItem[]): unknown[] {
  if (items.length === 0) return [];
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: `*${heading}*` } }];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: buffer.join("\n\n") } });
    buffer = [];
  };
  for (const item of items) {
    const text = itemLines(item);
    if (buffer.length > 0 && [...buffer, text].join("\n\n").length > SECTION_LIMIT) flush();
    buffer.push(text);
  }
  flush();
  return blocks;
}

const short = (sha: string) => sha.slice(0, 7);

/**
 * Render the notes as Block Kit. Returns null when there is nothing worth
 * posting — either the model said the release is invisible to everyone, or
 * nothing survived the confidence filter. Callers treat null as "stay quiet",
 * which is the expected outcome for a backend-only release.
 */
export function renderReleaseBlocks(
  notes: ReleaseNotes,
  meta: ReleaseMeta,
  now = new Date(),
): { text: string; blocks: unknown[] } | null {
  const keep = notes.items.filter(
    (i) => MIN_CONFIDENCE.includes(i.confidence) && i.title.trim().length > 0,
  );
  if (notes.internalOnly || keep.length === 0) return null;

  const shown = keep.slice(0, MAX_ITEMS);
  const hidden = keep.length - shown.length;

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚀 What's new — ${now.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      },
    },
  ];
  if (notes.headline.trim()) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: mrkdwn(notes.headline.trim()) } });
  }
  blocks.push({ type: "divider" });
  blocks.push(...groupBlocks("For customers", shown.filter((i) => i.audience === "customer")));
  blocks.push(...groupBlocks("For your admin team", shown.filter((i) => i.audience === "admin")));
  if (hidden > 0) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `_+${hidden} smaller change${hidden === 1 ? "" : "s"} not listed._` },
      ],
    });
  }

  // The receipt. Nobody reviews these before the whole company reads them, so
  // every message carries the commit range and the CI run it came from —
  // "is this real?" should be ten seconds of checking, not a conversation.
  const provenance =
    `${mrkdwn(meta.repo)} · ${short(meta.previousSha)}…${short(meta.sha)} · ` +
    `${meta.commitCount} commit${meta.commitCount === 1 ? "" : "s"}` +
    (meta.runUrl ? ` · <${meta.runUrl}|CI run>` : "") +
    " · written by AI from the code diff";
  blocks.push({ type: "divider" });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: provenance }] });

  // The fallback is what mobile push notifications and the channel preview show,
  // so it has to carry the point on its own.
  return { text: `What's new — ${notes.headline.trim() || "this release"}`, blocks };
}
