import { useState } from "react";
import { ArrowLeftRight, Check, Link2, Pencil, Plus, Search, X } from "lucide-react";
import type { Anchor } from "../../core/types";
import {
  containersOf,
  currentAnchorImage,
  relatedAnchorsFor,
  relationNote,
  relationOwner,
  relationSentence,
  suggestLinkedAnchors,
} from "../../state/ai";
import { BlobThumbnail } from "../components/BlobThumbnail";
import { InfoHint } from "../components/InfoHint";
import { Input } from "../components/Input";
import { cn } from "../lib/cn";
import { ANCHOR_TYPE_ICON } from "./AnchorCard";

type RelField = "containedIds" | "relatedIds";

/**
 * Explicit, id-based relationship editor for an anchor. Lets the user declare
 * which other anchors this one CONTAINS (places/objects) or RELATES to / resembles.
 * Replaces fragile name-matching so the dependency & staleness graphs only follow
 * links the user actually created. Offers one-click suggestions from the text.
 *
 * Relationships are two-way but stored ONCE (on whichever anchor created them):
 * "relates" edges are symmetric and surfaced on both anchors here, and the
 * anchor that CONTAINS another shows up as a read-only "Contained in X" chip on
 * the child. The reverse view is always derived (never mirror-written), so the
 * two sides can't drift apart.
 *
 * Shows linked anchors as small portraits (not bare text chips) so a growing
 * cast still reads as faces, not a form. The exhaustive "every other anchor"
 * picker is tucked behind a search box you open on demand, instead of two
 * permanent walls of toggle buttons.
 */
export function RelationsEditor({
  anchor,
  all,
  update,
}: {
  anchor: Anchor;
  all: Anchor[];
  /** Patch ANY anchor — needed because an inbound relation's note/edge lives on
   *  the other anchor, so editing it from here writes to that owner. */
  update: (anchorId: string, patch: Partial<Anchor>) => void;
}) {
  const [managing, setManaging] = useState(false);
  const [query, setQuery] = useState("");
  // Which "Relates" chip's note is currently being edited, and its draft text
  // (lives here, not in the chip, since saving/cancelling needs to reach back
  // up to `update` anyway).
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const others = all.filter((a) => a.id !== anchor.id);
  if (others.length === 0) return null;

  const byId = new Map(all.map((a) => [a.id, a]));
  const canContain = anchor.type !== "character";
  const contained = new Set(anchor.containedIds ?? []);
  // "Relates" is symmetric: the set of related anchors is derived from BOTH
  // directions, not just this anchor's own `relatedIds`.
  const relatedAnchors = relatedAnchorsFor(anchor, all);
  const related = new Set(relatedAnchors.map((o) => o.id));
  // Anchors that contain THIS one — shown as read-only "Contained in X" chips.
  const containers = containersOf(anchor, all);
  const suggestions = suggestLinkedAnchors(anchor, all);
  const linkedCount = contained.size + related.size + containers.length;
  const linkedAnchors = others.filter(
    (o) => contained.has(o.id) || related.has(o.id) || containers.some((c) => c.id === o.id),
  );

  // Containment is limited to ONE level: nesting a parent inside another parent
  // (grandchildren) can't be rendered faithfully — the model would have to match
  // a reference-inside-a-reference. Rows that would create depth 2 are disabled
  // with an explanation (already-selected ones stay removable).
  const isContainedElsewhere = containers.length > 0;
  const containDisabledReason = (o: Anchor): string | null => {
    if (contained.has(o.id)) return null; // always allow unselecting
    if ((o.containedIds ?? []).length > 0)
      return `${o.name} already contains other subjects — nested containers can't be matched reliably.`;
    if (isContainedElsewhere)
      return `${anchor.name} is itself contained in another subject — only one level of nesting is supported.`;
    return null;
  };

  /** Toggle CONTAINS (directional — always owned by this anchor). */
  function toggleContain(id: string) {
    const set = new Set(anchor.containedIds ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update(anchor.id, { containedIds: [...set] });
  }

  /** Toggle RELATES (symmetric). Removing finds the true owner (either side)
   *  and drops the edge + note there; adding stores it on THIS anchor. */
  function toggleRelate(id: string) {
    const other = byId.get(id);
    const owner = other ? relationOwner(anchor, other) : null;
    if (owner) {
      const otherId = owner.id === anchor.id ? id : anchor.id;
      const set = new Set(owner.relatedIds ?? []);
      set.delete(otherId);
      const patch: Partial<Anchor> = { relatedIds: [...set] };
      if (owner.relatedNotes?.[otherId] !== undefined) {
        const nextNotes = { ...owner.relatedNotes };
        delete nextNotes[otherId];
        patch.relatedNotes = nextNotes;
      }
      update(owner.id, patch);
    } else {
      update(anchor.id, { relatedIds: [...new Set([...(anchor.relatedIds ?? []), id])] });
    }
  }

  function addSuggestion(field: RelField, id: string) {
    if (field === "containedIds") toggleContain(id);
    else if (!related.has(id)) toggleRelate(id);
  }

  function startEditNote(id: string) {
    const other = byId.get(id);
    setEditingNoteId(id);
    setNoteDraft((other && relationNote(anchor, other)) ?? "");
  }

  /** Persist the note (predicate) onto whichever anchor OWNS the relates edge. */
  function saveNote() {
    if (!editingNoteId) return;
    const other = byId.get(editingNoteId);
    const owner = other ? relationOwner(anchor, other) : null;
    if (owner && other) {
      const otherId = owner.id === anchor.id ? editingNoteId : anchor.id;
      const nextNotes = { ...(owner.relatedNotes ?? {}) };
      const trimmed = noteDraft.trim();
      if (trimmed) nextNotes[otherId] = trimmed;
      else delete nextNotes[otherId];
      update(owner.id, { relatedNotes: nextNotes });
    }
    setEditingNoteId(null);
  }

  /** Flip the sentence's subject/object by moving edge + note to the other
   *  anchor — lets the user phrase it whichever way reads right ("Dad has
   *  lighter hair than Mom" vs. "Mom has darker hair than Dad"). */
  function swapDirection(id: string) {
    const other = byId.get(id);
    const owner = other ? relationOwner(anchor, other) : null;
    if (!owner || !other) return;
    const subjectId = owner.id;
    const objectId = owner.id === anchor.id ? id : anchor.id;
    const predicate = owner.relatedNotes?.[objectId];
    // Remove from the current owner (subject)…
    const ownerSet = new Set(owner.relatedIds ?? []);
    ownerSet.delete(objectId);
    const ownerNotes = { ...(owner.relatedNotes ?? {}) };
    delete ownerNotes[objectId];
    update(owner.id, { relatedIds: [...ownerSet], relatedNotes: ownerNotes });
    // …and add to the former object (new subject), carrying the predicate over.
    const newOwner = byId.get(objectId)!;
    const newSet = new Set(newOwner.relatedIds ?? []);
    newSet.add(subjectId);
    const newNotes = { ...(newOwner.relatedNotes ?? {}) };
    if (predicate) newNotes[subjectId] = predicate;
    update(objectId, { relatedIds: [...newSet], relatedNotes: newNotes });
  }

  const filteredOthers = others.filter((o) =>
    o.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="space-y-3 border-t border-ink-100 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-700">
          <Link2 className="size-4" /> Relationships
          {linkedCount > 0 && (
            <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
              {linkedCount}
            </span>
          )}
          <InfoHint topic="containsRelates" />
        </div>
        <button
          type="button"
          onClick={() => setManaging((v) => !v)}
          className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50"
        >
          <Plus className="size-3.5" /> Link
        </button>
      </div>

      {/* Always visible (not just behind the hint) — this is what actually
          answers "what is this for" the instant you look at it. */}
      <p className="text-xs leading-relaxed text-ink-400">
        <span className="font-medium text-ink-500">Contains</span> draws it inside, matched exactly
        (e.g. a bed in a room).{" "}
        <span className="font-medium text-ink-500">Relates</span> just notes a resemblance or
        connection — never drawn separately. Links are two-way (they show on both subjects) and add
        a little generation time & Sparks.
      </p>

      {suggestions.length > 0 && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="text-xs text-brand-800">
            Mentioned in the description — link so they stay consistent:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <SuggestionChip
                key={s.id}
                anchor={s}
                showContain={canContain && s.type !== "character" && !containDisabledReason(s)}
                onContain={() => addSuggestion("containedIds", s.id)}
                onRelate={() => addSuggestion("relatedIds", s.id)}
              />
            ))}
          </div>
        </div>
      )}

      {linkedAnchors.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {linkedAnchors.map((o) => {
            if (contained.has(o.id)) {
              return (
                <LinkedChip
                  key={o.id}
                  anchor={o}
                  tag="Contains"
                  onRemove={() => toggleContain(o.id)}
                />
              );
            }
            // Inbound containment: another anchor contains THIS one. Read-only
            // "Contained in X" — removing edits that container's own list.
            if (containers.some((c) => c.id === o.id)) {
              return (
                <LinkedChip
                  key={o.id}
                  anchor={o}
                  tag="Contained in"
                  onRemove={() =>
                    update(o.id, {
                      containedIds: (o.containedIds ?? []).filter((id) => id !== anchor.id),
                    })
                  }
                />
              );
            }
            return (
              <RelatedChip
                key={o.id}
                anchor={o}
                sentence={relationSentence(anchor, o)}
                subjectName={(relationOwner(anchor, o) ?? anchor).name}
                objectName={(relationOwner(anchor, o)?.id === o.id ? anchor : o).name}
                editing={editingNoteId === o.id}
                noteDraft={noteDraft}
                onNoteDraftChange={setNoteDraft}
                onStartEdit={() => startEditNote(o.id)}
                onSaveNote={saveNote}
                onCancelEdit={() => setEditingNoteId(null)}
                onSwap={() => swapDirection(o.id)}
                onRemove={() => toggleRelate(o.id)}
              />
            );
          })}
        </div>
      ) : (
        !managing && (
          <p className="text-xs leading-relaxed text-ink-400">
            No relationships yet — link the characters, places or objects that belong with{" "}
            {anchor.name}.
          </p>
        )
      )}

      {managing && (
        <div className="space-y-2 rounded-xl border border-ink-100 bg-ink-50/60 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-300" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search characters & places…"
              className="h-9 pl-8 text-xs"
            />
          </div>

          {contained.size > 3 && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700">
              With more than 3 embedded subjects, each one gets matched less accurately. For best
              results keep the 2–3 most important ones here and describe the rest in the text.
            </p>
          )}

          <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
            {filteredOthers.length === 0 ? (
              <p className="py-3 text-center text-xs text-ink-400">No matches.</p>
            ) : (
              filteredOthers.map((o) => (
                <PickerRow
                  key={o.id}
                  anchor={o}
                  containActive={contained.has(o.id)}
                  relateActive={related.has(o.id)}
                  showContain={canContain}
                  containDisabledReason={containDisabledReason(o)}
                  onToggleContain={() => toggleContain(o.id)}
                  onToggleRelate={() => toggleRelate(o.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A small circular portrait — the shared "face" used by every relation row. */
function RelationAvatar({ anchor, size = "size-6" }: { anchor: Anchor; size?: string }) {
  const Icon = ANCHOR_TYPE_ICON[anchor.type];
  return (
    <BlobThumbnail
      blobId={currentAnchorImage(anchor)?.blobId}
      alt={anchor.name}
      instant
      className={cn(size, "shrink-0 rounded-full")}
      fallback={<Icon className="size-3 text-ink-300" />}
    />
  );
}

/**
 * An already-linked containment anchor: portrait, name, tag, remove. Handles
 * both directions — "Contains" on the parent's editor and the read-only-ish
 * "Contained in" mirror shown on the child (removing either one edits the same
 * single stored link on the parent).
 */
function LinkedChip({
  anchor,
  tag,
  onRemove,
}: {
  anchor: Anchor;
  tag: "Contains" | "Contained in";
  onRemove: () => void;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-ink-200 bg-white py-1 pl-1 pr-1.5 text-xs">
      <RelationAvatar anchor={anchor} />
      <span className="max-w-24 truncate font-medium text-ink-700">{anchor.name}</span>
      <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
        {tag}
      </span>
      <button
        type="button"
        onClick={onRemove}
        title={tag === "Contains" ? "Remove contains link" : "Remove containment link"}
        className="rounded-full p-0.5 text-ink-300 transition hover:bg-red-50 hover:text-red-500"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * An already-linked "Relates to" anchor. Unlike `LinkedChip`, this one carries
 * the relationship as a full, side-independent sentence ("Dad has lighter hair
 * than Mom") shown identically on both anchors — so it's a slightly taller
 * card, not a bare pill. Editing is a fill-in-the-blank sentence builder:
 * `Subject ‹ predicate › Object`, with a swap control to flip which anchor is
 * the subject (so the user can phrase it whichever way reads right).
 */
function RelatedChip({
  anchor,
  sentence,
  subjectName,
  objectName,
  editing,
  noteDraft,
  onNoteDraftChange,
  onStartEdit,
  onSaveNote,
  onCancelEdit,
  onSwap,
  onRemove,
}: {
  anchor: Anchor;
  sentence: string | null;
  subjectName: string;
  objectName: string;
  editing: boolean;
  noteDraft: string;
  onNoteDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onSaveNote: () => void;
  onCancelEdit: () => void;
  onSwap: () => void;
  onRemove: () => void;
}) {
  return (
    <span className="flex flex-col gap-1 rounded-xl border border-ink-200 bg-white px-1.5 py-1 text-xs">
      <span className="flex items-center gap-1.5">
        <RelationAvatar anchor={anchor} />
        <span className="max-w-24 truncate font-medium text-ink-700">{anchor.name}</span>
        <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
          Relates
        </span>
        {!editing && (
          <button
            type="button"
            onClick={onStartEdit}
            title={sentence ? "Edit how they relate" : "Describe how they relate"}
            className="rounded-full p-0.5 text-ink-300 transition hover:bg-brand-50 hover:text-brand-600"
          >
            <Pencil className="size-3" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          title="Remove relates link"
          className="rounded-full p-0.5 text-ink-300 transition hover:bg-red-50 hover:text-red-500"
        >
          <X className="size-3" />
        </button>
      </span>
      {editing ? (
        <span className="flex flex-col gap-1 pl-1">
          <span className="flex items-center gap-1">
            <span className="max-w-16 truncate font-medium text-ink-600" title={subjectName}>
              {subjectName}
            </span>
            <Input
              autoFocus
              value={noteDraft}
              onChange={(e) => onNoteDraftChange(e.target.value)}
              placeholder="e.g. has lighter hair than"
              className="h-7 min-w-32 flex-1 px-2 text-[11px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveNote();
                if (e.key === "Escape") onCancelEdit();
              }}
            />
            <span className="max-w-16 truncate font-medium text-ink-600" title={objectName}>
              {objectName}
            </span>
            <button
              type="button"
              onClick={onSwap}
              title="Swap direction"
              className="rounded-full p-1 text-ink-300 transition hover:bg-ink-100 hover:text-ink-600"
            >
              <ArrowLeftRight className="size-3" />
            </button>
            <button
              type="button"
              onClick={onSaveNote}
              title="Save"
              className="rounded-full p-1 text-brand-500 transition hover:bg-brand-50"
            >
              <Check className="size-3.5" />
            </button>
          </span>
        </span>
      ) : (
        sentence && (
          <span className="pl-1 text-[11px] italic leading-snug text-ink-400">"{sentence}"</span>
        )
      )}
    </span>
  );
}

/** An auto-detected mention, offered as a one-click link. */
function SuggestionChip({
  anchor,
  showContain,
  onContain,
  onRelate,
}: {
  anchor: Anchor;
  showContain: boolean;
  onContain: () => void;
  onRelate: () => void;
}) {
  return (
    <div className="flex items-center overflow-hidden rounded-full border border-brand-200 bg-white text-xs">
      <span className="flex items-center gap-1.5 py-1 pl-1.5 pr-2">
        <RelationAvatar anchor={anchor} size="size-5" />
        <span className="font-medium text-ink-700">{anchor.name}</span>
      </span>
      {showContain && (
        <button
          type="button"
          onClick={onContain}
          className="border-l border-brand-200 px-2 py-1 text-brand-600 hover:bg-brand-50"
          title="Add as contained"
        >
          Contains
        </button>
      )}
      <button
        type="button"
        onClick={onRelate}
        className="border-l border-brand-200 px-2 py-1 text-brand-600 hover:bg-brand-50"
        title="Add as related"
      >
        Relates
      </button>
    </div>
  );
}

/** One row of the search picker: a face, a name, and up to two toggle pills. */
function PickerRow({
  anchor,
  containActive,
  relateActive,
  showContain,
  containDisabledReason,
  onToggleContain,
  onToggleRelate,
}: {
  anchor: Anchor;
  containActive: boolean;
  relateActive: boolean;
  showContain: boolean;
  containDisabledReason: string | null;
  onToggleContain: () => void;
  onToggleRelate: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition hover:bg-white">
      <RelationAvatar anchor={anchor} size="size-7" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-700">{anchor.name}</span>
      <div className="flex shrink-0 items-center gap-1">
        {showContain && anchor.type !== "character" && (
          <TogglePill
            active={containActive}
            disabled={Boolean(containDisabledReason)}
            title={containDisabledReason ?? undefined}
            onClick={onToggleContain}
          >
            Contains
          </TogglePill>
        )}
        <TogglePill active={relateActive} onClick={onToggleRelate}>
          Relates
        </TogglePill>
      </div>
    </div>
  );
}

function TogglePill({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
        active
          ? "border-brand-400 bg-brand-100 text-brand-700"
          : disabled
            ? "cursor-not-allowed border-ink-100 text-ink-300"
            : "border-ink-200 text-ink-500 hover:border-brand-300 hover:text-brand-600",
      )}
    >
      {active && <Check className="size-3" />}
      {children}
    </button>
  );
}
