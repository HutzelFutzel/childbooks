import { wordCount } from "./brief";

export interface StoryBeatItem {
  id: string;
  title: string;
  text: string;
}

function uid(): string {
  return `b_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

/**
 * Returns a user-friendly default title for a section index (1-based).
 */
export function defaultBeatLabel(index: number): string {
  return `Section ${index + 1}`;
}

export const defaultSectionLabel = defaultBeatLabel;

/**
 * Normalizes section titles, converting legacy "Beat 1", "Beat 2", etc. to "Section 1", "Section 2".
 */
export function normalizeSectionTitle(title: string, index?: number): string {
  const trimmed = title.trim();
  if (!trimmed) return "";
  // If title is "Beat 1", "Beat 2", "beat 1", "Beat", etc.
  if (/^beat(\s+\d+)?$/i.test(trimmed)) {
    const numMatch = trimmed.match(/\d+/);
    const num = numMatch ? numMatch[0] : index != null ? `${index + 1}` : "";
    return num ? `Section ${num}` : "Section";
  }
  // If title starts with "Beat 1: ..." or "Beat: ..."
  if (/^beat(\s+\d+)?\s*[:\-\u2013\u2014]\s*/i.test(trimmed)) {
    return trimmed.replace(/^beat/i, "Section");
  }
  return trimmed;
}

/**
 * Parses raw story text into structured beats.
 *
 * Rules:
 * 1. Only splits into multiple beats when explicit Markdown headings (### or ##) are present.
 * 2. If no Markdown headings exist, the entire text is kept as ONE unified beat (even across multiple paragraphs),
 *    preventing accidental beat explosion from normal paragraphs.
 */
export function parseStoryBeats(
  storyText: string,
  existingBeats?: StoryBeatItem[],
): StoryBeatItem[] {
  const raw = storyText.trim();
  if (!raw) {
    return [{ id: existingBeats?.[0]?.id ?? uid(), title: "", text: "" }];
  }

  // Check if text contains markdown section headings (### or ## at start of lines)
  const hasMarkdownHeadings = /(?:^|\n)#{1,3}\s+[^\n]+/m.test(raw);

  if (hasMarkdownHeadings) {
    const sections = raw.split(/(?:^|\n)(?=#{1,3}\s+[^\n]+)/g).filter(Boolean);
    const parsed: StoryBeatItem[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      if (!section) continue;

      const headingMatch = section.match(/^#{1,3}\s+([^\n]+)(?:\n+([\s\S]*))?$/);
      if (headingMatch) {
        const title = normalizeSectionTitle((headingMatch[1] ?? "").trim(), i);
        const text = (headingMatch[2] ?? "").trim();
        parsed.push({
          id: existingBeats?.[i]?.id ?? uid(),
          title,
          text,
        });
      } else {
        const existingTitle = existingBeats?.[i]?.title ?? "";
        parsed.push({
          id: existingBeats?.[i]?.id ?? uid(),
          title: normalizeSectionTitle(existingTitle, i),
          text: section,
        });
      }
    }

    return parsed.length > 0
      ? parsed
      : [{ id: existingBeats?.[0]?.id ?? uid(), title: "", text: raw }];
  }

  // Without explicit markdown headings, the entire story text is 1 beat
  const existingTitle = existingBeats?.[0]?.title ?? "";
  return [
    {
      id: existingBeats?.[0]?.id ?? uid(),
      title: normalizeSectionTitle(existingTitle, 0),
      text: raw,
    },
  ];
}

/**
 * Serializes structured beats back into canonical storyText.
 * - Single beat without title: returns plain text (no markdown noise).
 * - Multi-beats: prefixes each beat with ### <Title> to preserve beat structure and round-trip reliably.
 */
export function serializeStoryBeats(beats: StoryBeatItem[]): string {
  if (beats.length === 0) return "";

  if (beats.length === 1) {
    const single = beats[0];
    const title = normalizeSectionTitle(single.title.trim(), 0);
    const text = single.text.trim();
    if (title && text) {
      return `### ${title}\n\n${text}`;
    }
    return text || (title ? `### ${title}` : "");
  }

  const chunks: string[] = [];

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const title = normalizeSectionTitle(beat.title.trim(), i) || defaultBeatLabel(i);
    const text = beat.text.trim();

    if (text) {
      chunks.push(`### ${title}\n\n${text}`);
    } else {
      chunks.push(`### ${title}`);
    }
  }

  return chunks.join("\n\n");
}

/**
 * Checks if a beat is considered empty and safe to delete.
 */
export function isBeatEmpty(beat: StoryBeatItem): boolean {
  return beat.text.trim().length === 0 && beat.title.trim().length === 0;
}

/**
 * Calculates words in a beat.
 */
export function beatWordCount(beat: StoryBeatItem): number {
  return wordCount(`${beat.title} ${beat.text}`.trim());
}
