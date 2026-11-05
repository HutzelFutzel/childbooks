"use client";

/**
 * One page, in four plain parts: its picture, its words, what is happening on
 * it and who is there. It works on any page, drawn or not, and on pages that
 * never had a picture, so a new page can be described and drawn without leaving
 * the editor.
 *
 * Editing is free and immediate. Drawing is its own step, with its price on the
 * button, and it goes through the same priced path the assistant uses. The
 * book's look is shown but is not a control here: no page can change it.
 */
import { useEffect, useRef, useState } from "react";
import { ImageOff, Image as ImageIcon, Sparkles, Undo2, Wand2 } from "lucide-react";
import { cleanScene, hasEarlierPicture, hasNoPicture, spreadOf } from "../../core/book/pagePlan";
import { describesNewMoment, pictureChangeMode } from "../../core/guide/redrawMode";
import type { ScreenplaySpread } from "../../core/types";
import { illustrationStaleness } from "../../state/ai";
import { useChatStudio } from "../../state/chatStudio";
import { notify } from "../lib/notify";
import { Button } from "../components/Button";
import { Field, Textarea } from "../components/Input";
import { SparkEstimateCost } from "../layout/SparkCost";
import { useBufferedText } from "../hooks/useBufferedText";
import { cn } from "../lib/cn";
import { editPageCast, editPagePicture, editPageScene, editPageWords, suggestPageScene } from "./pagePlanOps";
import { StyleLockBadge, StyleLockNote } from "./StyleLock";
import { useStudioPanelStore } from "./studioPanelStore";
import { useStudio } from "./StudioContext";
import { usePageIllustration } from "./usePageIllustration";

const SCENE_PLACEHOLDER = "Arthur finds a glowing lantern at the back of the cave";
const WORDS_PLACEHOLDER = "The words that are printed on this page";

export function PageCard({ pageId }: { pageId: string }) {
  const { project } = useStudio();
  const spread = spreadOf(project, pageId);
  if (!spread) {
    return (
      <p className="p-4 text-xs leading-relaxed text-ink-500">
        A cover changes from the cover's own tools, or by telling the assistant what should look different.
      </p>
    );
  }
  return <PageCardBody key={spread.id} spread={spread} />;
}

function PageCardBody({ spread }: { spread: ScreenplaySpread }) {
  const { project } = useStudio();
  const pageId = spread.id;
  const illo = usePageIllustration(pageId);
  const drawPage = useChatStudio((s) => s.drawPage);

  const noPicture = hasNoPicture(spread);
  const drawn = Boolean(illo.cursor);
  const earlier = hasEarlierPicture(project, pageId);

  const words = useBufferedText(spread.text, (value) => editPageWords(pageId, value));
  // Opened by a double-click on the page: the cursor goes straight into its words.
  const wordsField = useRef<HTMLTextAreaElement>(null);
  const focusWordsFor = useStudioPanelStore((s) => s.focusWordsFor);
  useEffect(() => {
    if (focusWordsFor !== pageId) return;
    const field = wordsField.current;
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
    useStudioPanelStore.getState().wordsFocused();
  }, [focusWordsFor, pageId]);
  const scene = useBufferedText(spread.illustration, (value) => editPageScene(pageId, value));

  const people = illo.anchors;
  const here = new Set(illo.activeIds);
  const hasDescription = Boolean(cleanScene(scene.value) || words.value.trim());
  const staleness = drawn ? illustrationStaleness(project, pageId) : null;

  // One field for what should change in a picture that is there. What it does is decided by what was typed,
  // and said under the field before anything is drawn.
  const change = illo.edit.trim();
  const mode = change ? pictureChangeMode(change) : "new";
  const keepsPicture = drawn && Boolean(change) && mode === "edit";
  const range = keepsPicture ? illo.editSparkRange : illo.freshSparkRange;
  const maxSparks = range?.maxSparks ?? 0;

  const [suggesting, setSuggesting] = useState(false);

  async function suggest(): Promise<void> {
    scene.flush();
    words.flush();
    setSuggesting(true);
    try {
      await suggestPageScene(pageId, scene.value.trim() ? "rewrite" : "suggest");
    } catch (err) {
      notify.error(err, "I couldn't suggest a description just now.");
    } finally {
      setSuggesting(false);
    }
  }

  // The picture there before a new one lands stays one tap away for a few seconds, besides being in its history.
  const cursorId = illo.tree?.cursorId ?? null;
  const seenCursor = useRef<string | null>(cursorId);
  const drewHere = useRef(false);
  const [previous, setPrevious] = useState<string | null>(null);
  useEffect(() => {
    const before = seenCursor.current;
    seenCursor.current = cursorId;
    if (!drewHere.current || !cursorId || cursorId === before) return;
    drewHere.current = false;
    if (!before) return;
    setPrevious(before);
    const timer = window.setTimeout(() => setPrevious(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [cursorId]);

  function toggle(anchorId: string): void {
    const next = here.has(anchorId) ? illo.activeIds.filter((id) => id !== anchorId) : [...illo.activeIds, anchorId];
    editPageCast(pageId, next);
  }

  function draw(): void {
    // What was just typed is saved before the price is asked for.
    scene.flush();
    words.flush();
    drewHere.current = drawn;
    if (drawn && change) {
      // Another moment replaces what the page says is happening, so the page keeps describing its picture.
      const newMoment = mode === "new" && describesNewMoment(change);
      if (newMoment) editPageScene(pageId, change);
      void drawPage(pageId, Math.ceil(maxSparks), { instruction: newMoment ? "" : change, mode });
      illo.setEdit("");
      return;
    }
    void drawPage(pageId, Math.ceil(maxSparks));
  }

  return (
    <div className="space-y-4 p-4">
      <StyleLockBadge project={project} />

      <div role="group" aria-label="Picture" className="grid grid-cols-2 gap-1 rounded-xl bg-ink-50 p-1">
        <Choice
          active={!noPicture}
          icon={<ImageIcon className="size-3.5" />}
          label="Picture"
          onClick={() => noPicture && editPagePicture(pageId, true)}
        />
        <Choice
          active={noPicture}
          icon={<ImageOff className="size-3.5" />}
          label="No picture"
          onClick={() => !noPicture && editPagePicture(pageId, false)}
        />
      </div>

      <Field label="Words">
        <Textarea
          ref={wordsField}
          rows={3}
          value={words.value}
          onChange={(event) => words.onChange(event.target.value)}
          onFocus={words.onFocus}
          onBlur={words.onBlur}
          placeholder={WORDS_PLACEHOLDER}
        />
      </Field>

      {noPicture ? (
        <div className="space-y-2 rounded-xl border border-ink-100 bg-ink-50/60 p-3">
          <p className="text-xs leading-relaxed text-ink-600">
            {spread.text.trim() ? "This page shows only its words." : "This page is empty on purpose."}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            leftIcon={<ImageIcon className="size-4" />}
            onClick={() => editPagePicture(pageId, true)}
          >
            {earlier ? "Put the picture back" : "Add a picture"}
          </Button>
          {earlier ? (
            <p className="text-[11px] leading-snug text-ink-400">
              Free. The last picture was kept. To draw a different one, put it back and draw again.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`scene-${pageId}`} className="text-xs font-medium text-ink-600">
                What's happening
              </label>
              <button
                type="button"
                onClick={() => void suggest()}
                disabled={suggesting || !(words.value.trim() || scene.value.trim() || spread.text.trim())}
                className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:pointer-events-none disabled:opacity-40"
                title="Free. Reads the words and the pages around this one."
              >
                <Sparkles className="size-3" aria-hidden />
                {suggesting ? "Thinking…" : scene.value.trim() ? "Say it better" : "Suggest"}
              </button>
            </div>
            <div>
              <Textarea
                id={`scene-${pageId}`}
                rows={3}
                value={scene.value}
                onChange={(event) => scene.onChange(event.target.value)}
                onFocus={scene.onFocus}
                onBlur={scene.onBlur}
                placeholder={SCENE_PLACEHOLDER}
              />
            </div>
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
            {staleness === "scene" ? (
              <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 ring-1 ring-inset ring-amber-200" role="status">
                The picture shows what this page said before. Draw it again to match.
              </p>
            ) : staleness === "looks" ? (
              <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 ring-1 ring-inset ring-amber-200" role="status">
                Someone or somewhere in this picture has changed since it was drawn.
              </p>
            ) : null}

            {previous && illo.tree?.nodes[previous] ? (
              <button
                type="button"
                onClick={() => {
                  illo.setVersion(previous);
                  setPrevious(null);
                }}
                className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-ink-800 px-3 text-xs font-semibold text-white transition hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Undo2 className="size-3.5" aria-hidden />
                Back to the previous picture
              </button>
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
                  {!change
                    ? "Leave it empty to draw this page again from its description."
                    : mode === "edit"
                      ? "Changes the picture you have. The rest stays as it is."
                      : "Draws a new picture. The old one stays in the picture's history."}
                </p>
              </div>
            ) : null}

            <Button
              className="w-full"
              leftIcon={<Wand2 className="size-4" />}
              loading={illo.generating}
              disabled={!hasDescription}
              onClick={draw}
            >
              {!drawn ? "Draw this page" : keepsPicture ? "Change the picture" : "Draw a new picture"}
              <SparkEstimateCost range={range} action="pageIllustration" />
            </Button>
            <p className="text-[11px] leading-snug text-ink-400">
              {!hasDescription
                ? "Say what happens on this page first, or give it words."
                : "Nothing is drawn until you tap. The price is on the button."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Choice({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        active ? "bg-white text-ink-800 shadow-sm" : "text-ink-500 hover:text-ink-700",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
