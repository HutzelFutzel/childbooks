/**
 * The playlist — which components run, in what order, with whose wording.
 *
 * This is the part an admin owns. The catalog (what a component *is*, when it is
 * finished, what it depends on) stays in code, because those are contracts the
 * pipeline relies on. The playlist is the editorial decision on top: reorder the
 * questions, make one optional, retitle it, or switch it off.
 *
 * Ownership is split that way so a dashboard edit can never produce a book the
 * generator refuses to make. The worst an admin can do here is ask in an odd
 * order — and even that is caught, because {@link lintGuidePlaylist} rejects an
 * order that puts a component before something it requires, and
 * {@link normalizeGuidePlaylist} repairs a stored playlist rather than trusting it.
 *
 * Normalization is total and lossy in one direction only: unknown ids are
 * dropped (a component that no longer exists cannot run), and components missing
 * from the stored document are appended in catalog order (a new component ships
 * enabled rather than invisibly absent). Both rules mean a deployment that has
 * never opened the admin editor behaves exactly like one that has.
 */
import { z } from "zod";
import {
  GUIDE_CATALOG,
  GUIDE_COMPONENTS,
  isGuideComponentId,
  type GuideComponent,
  type GuideComponentId,
} from "./components";

export interface GuidePlaylistEntry {
  id: GuideComponentId;
  /** Off means the guide never raises it; its facts still count as facts. */
  enabled: boolean;
  /**
   * Admin override for whether the reader may decline it. Absent ⇒ the catalog's
   * own answer. A component the catalog calls required can be made optional, and
   * vice versa: that is an editorial call, not a contract.
   */
  skippable?: boolean;
  /** Admin override for the component's title. Absent ⇒ the catalog's. */
  title?: string;
}

export interface GuidePlaylist {
  version: 1;
  entries: GuidePlaylistEntry[];
}

export const guidePlaylistEntrySchema = z.object({
  id: z.string().min(1).max(60),
  enabled: z.boolean(),
  skippable: z.boolean().optional(),
  title: z.string().max(120).optional(),
});

export const guidePlaylistSchema = z.object({
  version: z.literal(1),
  entries: z.array(guidePlaylistEntrySchema).max(GUIDE_CATALOG.length * 2),
});

export function createDefaultGuidePlaylist(): GuidePlaylist {
  return {
    version: 1,
    entries: GUIDE_CATALOG.map((component) => ({ id: component.id, enabled: true })),
  };
}

/**
 * Re-anchor a stored playlist onto the catalog: keep the admin's order and
 * overrides for components that still exist, drop the ones that don't, and append
 * anything the catalog has gained.
 *
 * Then repair the order. An entry that sits before something it requires is
 * moved down to just after its last requirement rather than rejected, because a
 * stored document is the live configuration — refusing it would take the guide
 * offline, and silently running it would ask readers for a picture of a character
 * from a story that hasn't been written.
 */
export function normalizeGuidePlaylist(input: unknown): GuidePlaylist {
  const stored = (input ?? {}) as Partial<GuidePlaylist>;
  const rawEntries = Array.isArray(stored.entries) ? stored.entries : [];

  const seen = new Set<GuideComponentId>();
  const entries: GuidePlaylistEntry[] = [];
  for (const raw of rawEntries) {
    const parsed = guidePlaylistEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const { id, enabled, skippable, title } = parsed.data;
    if (!isGuideComponentId(id) || seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id,
      enabled,
      ...(typeof skippable === "boolean" ? { skippable } : {}),
      ...(title?.trim() ? { title: title.trim() } : {}),
    });
  }

  for (const component of GUIDE_CATALOG) {
    if (!seen.has(component.id)) entries.push({ id: component.id, enabled: true });
  }

  return { version: 1, entries: repairOrder(entries) };
}

/**
 * Move every entry below its requirements, preserving the admin's order wherever
 * it was already legal. A stable insertion pass rather than a full topological
 * sort: the stored order is a human decision worth keeping, and only the entries
 * that actually violate a dependency should move.
 */
function repairOrder(entries: GuidePlaylistEntry[]): GuidePlaylistEntry[] {
  const out: GuidePlaylistEntry[] = [];
  const placed = new Set<GuideComponentId>();
  const pending = [...entries];

  while (pending.length > 0) {
    // The first entry whose requirements are all placed (or absent from the
    // playlist entirely — a disabled requirement is still a fact, so it cannot
    // deadlock the order).
    const index = pending.findIndex((entry) =>
      GUIDE_COMPONENTS[entry.id].requires.every(
        (required) => placed.has(required) || !entries.some((e) => e.id === required),
      ),
    );
    // A requirement cycle would leave nothing ready. The catalog can't express
    // one today, but draining in order beats looping forever if it ever can.
    const next = index === -1 ? pending.shift()! : pending.splice(index, 1)[0]!;
    out.push(next);
    placed.add(next.id);
  }

  // A terminal component ends the flow, so anything stored after it would be
  // unreachable — the engine stops at `review` because ordering never satisfies
  // it. Requirements are unaffected: everything it needs is already above.
  return [
    ...out.filter((entry) => !GUIDE_COMPONENTS[entry.id].terminal),
    ...out.filter((entry) => GUIDE_COMPONENTS[entry.id].terminal),
  ];
}

/**
 * Problems worth telling an admin about before saving. Normalization already
 * guarantees a runnable playlist, so these are editorial warnings, not errors
 * the engine could trip over.
 */
export function lintGuidePlaylist(playlist: GuidePlaylist): string[] {
  const problems: string[] = [];
  const position = new Map(playlist.entries.map((entry, index) => [entry.id, index]));
  const enabled = new Set(playlist.entries.filter((e) => e.enabled).map((e) => e.id));

  for (const entry of playlist.entries) {
    const component = GUIDE_COMPONENTS[entry.id];
    for (const required of component.requires) {
      const requiredPosition = position.get(required);
      if (requiredPosition === undefined) continue;
      if (requiredPosition > (position.get(entry.id) ?? 0)) {
        problems.push(
          `"${component.title}" is asked before "${GUIDE_COMPONENTS[required].title}", which it needs.`,
        );
      }
      if (entry.enabled && !enabled.has(required)) {
        problems.push(
          `"${component.title}" is on while "${GUIDE_COMPONENTS[required].title}", which it needs, is off.`,
        );
      }
    }
    if (component.terminal && position.get(entry.id) !== playlist.entries.length - 1) {
      problems.push(`"${component.title}" ends the flow, so nothing can come after it.`);
    }
  }

  if (playlist.entries.every((entry) => !entry.enabled)) {
    problems.push("Every component is off, so the guide has nothing to do.");
  }
  return problems;
}

/** A component with the playlist's overrides applied. */
export interface ResolvedGuideComponent extends GuideComponent {
  /** True when the playlist overrode the catalog's skippability. */
  skippableOverridden: boolean;
}

/**
 * The components the guide will actually run, in order, with overrides applied.
 * Disabled entries are dropped here — the engine works on this list and never
 * sees the raw document.
 */
export function resolveGuidePlaylist(playlist: GuidePlaylist): ResolvedGuideComponent[] {
  return playlist.entries
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const component = GUIDE_COMPONENTS[entry.id];
      return {
        ...component,
        title: entry.title ?? component.title,
        skippable: entry.skippable ?? component.skippable,
        skippableOverridden:
          typeof entry.skippable === "boolean" && entry.skippable !== component.skippable,
      };
    });
}
