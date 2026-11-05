"use client";

/**
 * One cover, open for changes: its words, what is happening on it, who is there and its picture.
 *
 * It is laid out like a page's card (`PageCard`) and opens the same way, in the book view and in the editor,
 * with the words that belong to a cover: the title, the line under it and the author on the front, and the
 * words on the back. Each change is one undo step, and the title, subtitle and author are written
 * everywhere the book keeps them (`core/book/coverEdits.ts`), so whichever side is changed the other agrees.
 */
import { useEffect, useRef } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { coverLinesOf } from "../../core/book/coverLines";
import { COVER_BACK_ID, COVER_FRONT_ID, type CoverSpec } from "../../core/types";
import { getCursor } from "../../core/versioning";
import { coverTextDrift } from "../../state/ai";
import { Button } from "../components/Button";
import { Field, Input, Textarea } from "../components/Input";
import { useBufferedText } from "../hooks/useBufferedText";
import { SparkEstimateCost } from "../layout/SparkCost";
import { cn } from "../lib/cn";
import { CoverToolsPanel } from "./CoverStudio";
import { editBackBlurb, editCoverCast, editCoverLine, editCoverScene, editCoverTitle } from "./coverOps";
import { StyleLockBadge, StyleLockNote } from "./StyleLock";
import { useStudio } from "./StudioContext";
import { useStudioPanelStore } from "./studioPanelStore";
import { usePageIllustration } from "./usePageIllustration";

const SCENE_PLACEHOLDER = "Arthur under a glowing moon; warm night colors; curious, not scared";

export function CoverCard({ coverId }: { coverId: string }) {
  const { project } = useStudio();
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const spec = coverId === COVER_BACK_ID ? doc?.backCover : doc?.frontCover;
  if (!doc || !spec) {
    return (
      <p className="p-4 text-xs leading-relaxed text-ink-500">
        The covers can be changed once the pages are drafted.
      </p>
    );
  }
  return <CoverCardBody key={coverId} coverId={coverId} spec={spec} />;
}

function CoverCardBody({ coverId, spec }: { coverId: string; spec: CoverSpec }) {
  const { project } = useStudio();
  const isBack = coverId === COVER_BACK_ID;
  const illo = usePageIllustration(coverId);
  const drawn = Boolean(illo.cursor);
  const lines = coverLinesOf(project);
  const drift = isBack ? null : coverTextDrift(project, COVER_FRONT_ID);

  const title = useBufferedText(lines.title, editCoverTitle);
  const subtitle = useBufferedText(lines.subtitle, (value) => editCoverLine("subtitle", value));
  const author = useBufferedText(lines.author, (value) => editCoverLine("author", value));
  const blurb = useBufferedText(spec.title ?? "", editBackBlurb);
  const scene = useBufferedText(spec.illustration, (value) => editCoverScene(coverId, value));

  // Opened by a double-click on the cover: the cursor goes straight into its words.
  const titleField = useRef<HTMLInputElement>(null);
  const blurbField = useRef<HTMLTextAreaElement>(null);
  const focusWordsFor = useStudioPanelStore((s) => s.focusWordsFor);
  useEffect(() => {
    if (focusWordsFor !== coverId) return;
    const field = isBack ? blurbField.current : titleField.current;
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
    useStudioPanelStore.getState().wordsFocused();
  }, [focusWordsFor, coverId, isBack]);

  const people = illo.anchors;
  const here = new Set(illo.activeIds);
  const change = illo.edit.trim();
  const keepsPicture = drawn && Boolean(change);
  const range = keepsPicture ? illo.editSparkRange : illo.freshSparkRange;

  function flush(): void {
    title.flush();
    subtitle.flush();
    author.flush();
    blurb.flush();
    scene.flush();
  }

  function toggle(anchorId: string): void {
    editCoverCast(
      coverId,
      here.has(anchorId) ? illo.activeIds.filter((id) => id !== anchorId) : [...illo.activeIds, anchorId],
    );
  }

  function draw(): void {
    // What was just typed is saved before the price is asked for.
    flush();
    if (keepsPicture) void illo.applyEdit();
    else void illo.generate();
  }

  return (
    <div className="space-y-4 p-4">
      <StyleLockBadge project={project} />

      {isBack ? (
        <Field label="Words">
          <Textarea
            ref={blurbField}
            rows={3}
            value={blurb.value}
            onChange={(event) => blurb.onChange(event.target.value)}
            onFocus={blurb.onFocus}
            onBlur={blurb.onBlur}
            placeholder="Optional: words for the back of the book"
          />
        </Field>
      ) : (
        <div className="space-y-2">
          <Field label="Title" required>
            <Input
              ref={titleField}
              value={title.value}
              onChange={(event) => title.onChange(event.target.value)}
              onFocus={title.onFocus}
              onBlur={title.onBlur}
              placeholder="Your book's title"
            />
          </Field>
          <Field label="Subtitle">
            <Input
              value={subtitle.value}
              onChange={(event) => subtitle.onChange(event.target.value)}
              onFocus={subtitle.onFocus}
              onBlur={subtitle.onBlur}
              placeholder="Optional"
            />
          </Field>
          <Field label="Author">
            <Input
              value={author.value}
              onChange={(event) => author.onChange(event.target.value)}
              onFocus={author.onFocus}
              onBlur={author.onBlur}
              placeholder="Optional"
            />
          </Field>
        </div>
      )}

      {drift ? (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 ring-1 ring-inset ring-amber-200" role="status">
          The picture shows “{drift.baked.title || "—"}”, painted in. Draw it again to match the new words.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={`scene-${coverId}`} className="text-xs font-medium text-ink-600">
          What's happening
        </label>
        <Textarea
          id={`scene-${coverId}`}
          rows={3}
          value={scene.value}
          onChange={(event) => scene.onChange(event.target.value)}
          onFocus={scene.onFocus}
          onBlur={scene.onBlur}
          placeholder={SCENE_PLACEHOLDER}
        />
        <StyleLockNote project={project} text={scene.value} />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-ink-600">Who's here</p>
        {people.length === 0 ? (
          <p className="text-[11px] leading-snug text-ink-400">Nobody is in the book yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {people.map((anchor) => (
              <button
                key={anchor.id}
                type="button"
                aria-pressed={here.has(anchor.id)}
                onClick={() => toggle(anchor.id)}
                className={cn(
                  "min-h-8 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                  here.has(anchor.id)
                    ? "bg-brand-50 text-brand-700 ring-brand-300"
                    : "bg-white text-ink-500 ring-ink-200 hover:bg-ink-50",
                )}
              >
                {anchor.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-ink-100 pt-4">
        {drawn && illo.isStale ? (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 ring-1 ring-inset ring-amber-200" role="status">
            Someone or somewhere on this cover has changed since it was drawn.
          </p>
        ) : null}

        {drawn ? (
          <div className="space-y-1.5">
            <Field label="What should change?">
              <Textarea
                rows={2}
                value={illo.edit}
                onChange={(event) => illo.setEdit(event.target.value)}
                placeholder="Arthur's hat is red, or: a new picture at night"
              />
            </Field>
            <p className="text-[11px] leading-snug text-ink-400">
              {change
                ? "Changes the picture you have. The rest stays as it is."
                : "Leave it empty to draw this cover again from its description."}
            </p>
          </div>
        ) : null}

        <Button className="w-full" leftIcon={<Wand2 className="size-4" />} loading={illo.generating} onClick={draw}>
          {!drawn ? "Draw the cover" : keepsPicture ? "Change the picture" : "Draw a new picture"}
          <SparkEstimateCost range={range} action="coverIllustration" />
        </Button>
        <p className="text-[11px] leading-snug text-ink-400">Nothing is drawn until you tap. The price is on the button.</p>
      </div>

      <details className="rounded-xl border border-ink-100 bg-ink-50/40 px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <Sparkles className="size-3.5" aria-hidden />
          More cover options
        </summary>
        <div className="pt-3">
          <CoverToolsPanel embedded variant="options" />
        </div>
      </details>
    </div>
  );
}

