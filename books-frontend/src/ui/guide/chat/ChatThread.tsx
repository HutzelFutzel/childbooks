"use client";

/**
 * The thread: prose and receipts. The guide speaks in open type, one group per
 * turn; the reader's line is the only bubble. The one live task sits directly
 * under the guide line that asked for it (`useWellConversation`); a tap on it
 * becomes the reader's line, so old controls never stay interactive after the
 * book moves on.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Info, PencilLine, Redo2, RotateCcw, Sparkles } from "lucide-react";
import { isQuietMessage } from "../../../core/guide/conversation";
import { bookViewOf, type BookViewId } from "../../../core/guide/journey";
import type { GuideMessage, ReceiptThumb } from "../../../core/guide/session";
import { illustrationUnits } from "../../../core/book/units";
import { pageNumberOf } from "../../../core/book/pageRefs";
import { COVER_BACK_ID, type Project } from "../../../core/types";
import { messageText, useChatStudio } from "../../../state/chatStudio";
import { useBookHistory } from "../../../state/bookHistory";
import { useProjectsStore } from "../../../state/projectsStore";
import { useMessageThumbs } from "../../../state/messageThumbs";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { cn } from "../../lib/cn";
import { CharacterAvatar } from "../book/CharacterAvatar";
import { GuideAvatar, useGuideIdentity } from "./GuideAvatar";
import { StoryFitCard } from "./StoryFitCard";
import { lineRise } from "../motion";
import { useGuideLabel, useGuideT } from "../intl";

export function ChatThread({
  messages,
  project,
  locale,
  sending,
  onUndo,
  onEdit,
  onRetry,
  onOpenCast,
  onOpenUnit,
  away,
  className,
  scrollKey,
  task,
  taskKey,
  wideTask = false,
}: {
  messages: readonly GuideMessage[];
  project: Project;
  locale: string;
  sending: boolean;
  onUndo: (id: string) => void;
  onEdit: (message: GuideMessage) => void;
  onRetry: () => void;
  onOpenCast: () => void;
  onOpenUnit: (unitId: string, view: BookViewId) => void;
  away?: React.ReactNode;
  className?: string;
  /** Scroll position is kept per key, so leaving page focus restores it. */
  scrollKey: string;
  /** The one live choice/action, derived from the book rather than transcript state. */
  task?: React.ReactNode;
  taskKey?: string;
  /** A catalog choice uses the column, not the prose measure. */
  wideTask?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // Only the reader scrolling lets go of the bottom: a smooth scroll on its way
  // down, or a card still growing in, must not.
  const readerScrolledAt = useRef(0);
  const markReaderScroll = () => {
    readerScrolledAt.current = Date.now();
  };

  // The bottom stays in view while what is under it grows (a card sliding in,
  // a line typing out) or the pane above the composer shrinks (a progress note).
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const saved = scrollMemory.get(scrollKey);
    if (saved !== undefined) el.scrollTop = saved;
    else el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  const { groups, typing } = useMemo(() => threadGroups(messages), [messages]);
  const { name: guideName } = useGuideIdentity();
  const shownCount = groups.reduce((sum, group) => sum + group.messages.length, 0);
  const latestFitId = useMemo(() => messages.findLast((message) => message.fit)?.id, [messages]);
  const firstSpokenGroupKey = useMemo(
    () =>
      groups.find(
        (group) =>
          group.role === "guide" && group.messages.some((message) => !isQuietMessage(message)),
      )?.key,
    [groups],
  );

  // A new line scrolls when the reader is already at the bottom. Choosing a
  // person opens their section under the latest line, so that click scrolls too.
  const seenTask = useRef<string | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [shownCount, typing, sending]);
  useEffect(() => {
    const next = taskKey ?? "";
    if (seenTask.current === null) {
      seenTask.current = next;
      return;
    }
    if (seenTask.current === next) return;
    seenTask.current = next;
    pinned.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [taskKey]);

  return (
    <div
      ref={scroller}
      onWheel={markReaderScroll}
      onTouchMove={markReaderScroll}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) markReaderScroll();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) markReaderScroll();
      }}
      onScroll={(event) => {
        const el = event.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        if (atBottom) pinned.current = true;
        else if (Date.now() - readerScrolledAt.current < 800) pinned.current = false;
        scrollMemory.set(scrollKey, el.scrollTop);
      }}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-6 pb-4", className)}
      aria-live="polite"
    >
      <div className="mx-auto flex w-full flex-col gap-3">
        <div className="mx-auto flex w-full max-w-[65ch] flex-col gap-5">
          {away}
          <AnimatePresence initial={false}>
            {groups.map((group) => {
              if (group.role === "reader") {
                return (
                  <motion.div key={group.key} variants={lineRise} initial="hidden" animate="show" layout="position">
                    <ReaderLine
                      message={group.messages[0]!}
                      editable={!project.authoringState?.lockedAt}
                      onUndo={onUndo}
                      onEdit={onEdit}
                      onRetry={onRetry}
                    />
                  </motion.div>
                );
              }
              const spoken = group.messages.some((message) => !isQuietMessage(message));
              return (
                <motion.div
                  key={group.key}
                  layout="position"
                  className={cn("flex items-start gap-3", !spoken && "pl-11")}
                >
                  {spoken && <GuideAvatar size="sm" className="mt-0.5" />}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {spoken && group.key === firstSpokenGroupKey && (
                      <span className="font-display text-xs font-semibold tracking-tight text-ink-500">
                        {guideName}
                      </span>
                    )}
                    {group.messages.map((message) => (
                      <motion.div key={message.id} variants={lineRise} initial="hidden" animate="show">
                        {isQuietMessage(message) &&
                        !message.keys?.includes("foundCast") &&
                        !message.receipt?.thumbs?.length ? (
                          <GuideNotice text={messageText(message, locale)} sparks={message.keys?.includes("sparksNotice")} />
                        ) : (
                          <GuideLine
                            message={message}
                            project={project}
                            locale={locale}
                            fitActionable={message.id === latestFitId}
                            onOpenCast={onOpenCast}
                            onOpenUnit={onOpenUnit}
                          />
                        )}
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {(typing || sending) && <TypingDots />}
        </div>
        {/* A card on screen stays while the guide phrases a line above it; a
            new one waits for that line (`wellStage`). Each card keeps its own
            key, so nothing here remounts it. */}
        {task && (
          <div className={cn("w-full", wideTask ? "max-w-none" : "mx-auto max-w-[65ch] sm:pl-11")}>
            {task}
          </div>
        )}
      </div>
    </div>
  );
}

const scrollMemory = new Map<string, number>();

interface ThreadGroup {
  key: string;
  role: GuideMessage["role"];
  messages: GuideMessage[];
}

/**
 * One group per turn: the reader's line alone, the guide's consecutive lines
 * together. A line still being phrased holds back itself and everything after
 * it, so the thread never reorders or rewrites what is on screen.
 */
function threadGroups(messages: readonly GuideMessage[]): { groups: ThreadGroup[]; typing: boolean } {
  const groups: ThreadGroup[] = [];
  for (const message of messages) {
    if (message.pending) return { groups, typing: true };
    const last = groups[groups.length - 1];
    if (message.role === "guide" && last?.role === "guide") last.messages.push(message);
    else groups.push({ key: message.id, role: message.role, messages: [message] });
  }
  return { groups, typing: false };
}

/** News the guide reports without taking the floor, and the Sparks note. */
function GuideNotice({ text, sparks }: { text: string; sparks?: boolean }) {
  return (
    <p className="inline-flex w-fit max-w-full items-center gap-2 rounded-full bg-ink-900/[0.035] px-3 py-1 text-[12.5px] leading-snug text-ink-500 ring-1 ring-inset ring-ink-900/[0.06]">
      {sparks ? (
        <Sparkles className="size-3.5 shrink-0 text-amber-500" aria-hidden />
      ) : (
        <Info className="size-3.5 shrink-0 text-ink-400" aria-hidden />
      )}
      <span>{text}</span>
    </p>
  );
}

function TypingDots() {
  const t = useGuideT("chrome");
  return (
    <div className="flex items-center gap-3" role="status" aria-label={t("guideTyping")}>
      <GuideAvatar size="sm" />
      <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 shadow-soft ring-1 ring-ink-900/8">
        {[0, 1, 2].map((dot) => (
          <motion.span
            key={dot}
            className="size-1.5 rounded-full bg-ink-400"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.18 }}
          />
        ))}
      </div>
    </div>
  );
}

function GuideLine({
  message,
  project,
  locale,
  fitActionable,
  onOpenCast,
  onOpenUnit,
}: {
  message: GuideMessage;
  project: Project;
  locale: string;
  /** This message's story card is the newest one. */
  fitActionable: boolean;
  onOpenCast: () => void;
  onOpenUnit: (unitId: string, view: BookViewId) => void;
}) {
  const receiptOnly = message.keys?.includes("receipt");
  const notice = !receiptOnly && message.keys?.includes("notice");
  const thumbs = message.receipt?.thumbs;
  return (
    <div className="flex flex-col gap-2">
      {notice ? (
        <GuideNotice text={messageText(message, locale)} />
      ) : (
        !receiptOnly && (
          <p className="max-w-[58ch] font-display text-[15.5px] leading-7 text-ink-900 [text-wrap:pretty]">
            {messageText(message, locale)}
          </p>
        )
      )}
      {message.keys?.includes("foundCast") ? (
        <CastStrip project={project} onOpenCast={onOpenCast} />
      ) : thumbs && thumbs.length > 0 ? (
        <ReceiptThumbs thumbs={thumbs} onOpenUnit={onOpenUnit} />
      ) : null}
      {message.fit && (
        <StoryFitCard
          fit={message.fit}
          storyText={project.config.storyText}
          actionable={fitActionable && !project.authoringState?.lockedAt}
        />
      )}
    </div>
  );
}

function CastStrip({
  project,
  onOpenCast,
}: {
  project: Project;
  onOpenCast: () => void;
}) {
  const label = useGuideLabel();
  const cast = project.config.storyBrief?.cast ?? [];
  if (cast.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpenCast}
      className="mt-1 flex max-w-full items-center gap-2 rounded-xl border border-ink-100 bg-white px-2.5 py-2 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-ink-200 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magic-400"
    >
      <span className="flex -space-x-2">
        {cast.slice(0, 5).map((member) => (
          <CharacterAvatar
            key={member.id}
            project={project}
            characterId={member.id}
            name={member.name}
            className="size-10 text-xs"
          />
        ))}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-ink-800">
          {cast.map((member) => member.name).join(", ")}
        </span>
        <span className="text-[11px] text-ink-500">{label("editPeople")}</span>
      </span>
    </button>
  );
}

/** Clickable thumbnails under a guide line (e.g. newly drawn portraits). */
function ReceiptThumbs({
  thumbs,
  onOpenUnit,
}: {
  thumbs: readonly ReceiptThumb[];
  onOpenUnit: (unitId: string, view: BookViewId) => void;
}) {
  return (
    <div className="flex w-fit max-w-full flex-wrap items-center gap-2">
      {thumbs.map((thumb) => (
        <ReceiptThumbButton key={`${thumb.unitId}:${thumb.blobId}`} thumb={thumb} onOpenUnit={onOpenUnit} />
      ))}
    </div>
  );
}

function ReceiptThumbButton({
  thumb,
  onOpenUnit,
}: {
  thumb: ReceiptThumb;
  onOpenUnit: (unitId: string, view: BookViewId) => void;
}) {
  const url = useBlobUrl(thumb.blobId, "thumb");
  if (!url) return null;
  return (
    <button
      type="button"
      onClick={() => onOpenUnit(thumb.unitId, bookViewOf(thumb.view) ?? "pages")}
      className={cn(
        "overflow-hidden ring-1 ring-ink-200 transition hover:ring-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-500",
        thumb.view === "cast"
          ? "size-12 rounded-full"
          : thumb.view === "style"
            ? "h-12 w-16 rounded-lg bg-[#eee8de] p-1"
            : "size-8 rounded-[3px]",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className={cn(
          "size-full object-top",
          thumb.view === "style" ? "rounded-sm bg-white object-contain" : "object-cover",
        )}
      />
    </button>
  );
}

/**
 * The pages a message named, as chips over it: hover rings the page on the
 * left, a click brings it into view. The number is read from the book now, so a
 * page that moved shows its new number and a page that is gone says so.
 */
function PageRefChips({ refs }: { refs: readonly string[] }) {
  const t = useGuideT("chrome");
  const project = useProjectsStore((s) => s.current());
  const jump = useChatStudio((s) => s.jumpToPage);
  const hover = useChatStudio((s) => s.setHoverUnit);
  if (!project) return null;
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
      {refs.map((id) => {
        const exists = illustrationUnits(project).some((unit) => unit.id === id);
        const n = pageNumberOf(project, id);
        const label = !exists ? t("pageGone") : n === null ? (id === COVER_BACK_ID ? t("mentionBackCover") : t("mentionFrontCover")) : t("page", { n });
        return exists ? (
          <button
            key={id}
            type="button"
            onClick={() => jump(id)}
            onMouseEnter={() => hover(id)}
            onMouseLeave={() => hover(null)}
            onFocus={() => hover(id)}
            onBlur={() => hover(null)}
            className="rounded-full bg-ink-900/90 px-2.5 py-0.5 text-[11px] font-medium text-white transition hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
          >
            {label}
          </button>
        ) : (
          <span key={id} className="rounded-full bg-ink-100 px-2.5 py-0.5 text-[11px] text-ink-400 line-through">
            {label}
          </span>
        );
      })}
    </div>
  );
}

function ReaderLine({
  message,
  editable,
  onUndo,
  onEdit,
  onRetry,
}: {
  message: GuideMessage;
  editable: boolean;
  onUndo: (id: string) => void;
  onEdit: (message: GuideMessage) => void;
  onRetry: () => void;
}) {
  const t = useGuideT("chrome");
  const tapped = message.keys?.includes("tap") ?? false;
  const projectId = useProjectsStore((s) => s.currentId) ?? undefined;
  const redo = useChatStudio((s) => s.redo);
  // A change made through the book's change log can be taken back after the book
  // is drawn too (it only touches pages); whether it is undone is read from the log.
  useEffect(() => {
    if (projectId && message.changeId) useBookHistory.getState().hydrate(projectId);
  }, [projectId, message.changeId]);
  const entryState = useBookHistory((s) =>
    projectId && message.changeId ? s.logs[projectId]?.entries.find((e) => e.id === message.changeId)?.state : undefined,
  );
  const undone = entryState === "undone";
  const legacy = Boolean(message.restore || message.before);
  const undoable = !undone && ((editable && (!tapped || legacy)) || entryState === "applied");
  const redoable = undone && !legacy;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(message.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  const thumbs = useMessageThumbs((s) => s.byMessage[message.id]);
  return (
    <div className="group flex flex-col items-end gap-1">
      {thumbs && thumbs.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {thumbs.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              className="size-16 rounded-xl object-cover ring-1 ring-ink-200/80"
            />
          ))}
        </div>
      )}
      {message.quote && (
        <blockquote className="max-w-[85%] border-l-2 border-magic-300 py-0.5 pl-2.5 font-serif text-[13px] leading-snug text-ink-500">
          “{message.quote}”
        </blockquote>
      )}
      {message.pageRefs && message.pageRefs.length > 0 && <PageRefChips refs={message.pageRefs} />}
      <p
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-linear-to-b from-ink-800 to-ink-900 px-3.5 py-2 text-sm leading-relaxed text-white shadow-[0_2px_8px_-2px_rgba(20,22,58,0.22),inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-ink-900",
          message.failed && "ring-2 ring-red-400",
          undone && "opacity-55",
        )}
      >
        {message.text}
      </p>
      <div className="flex items-center gap-0.5 text-ink-400 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
        {message.failed && (
          <button type="button" onClick={onRetry} className="rounded-md px-1.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
            {t("sendFailed")} ↻
          </button>
        )}
        {undoable && (
          <LineAction label={t("undo")} onClick={() => onUndo(message.id)}>
            <RotateCcw className="size-3.5" />
          </LineAction>
        )}
        {redoable && (
          <LineAction label={t("redo")} onClick={() => void redo(message.id)}>
            <Redo2 className="size-3.5" />
          </LineAction>
        )}
        {!tapped && (
          <LineAction label={copied ? t("copied") : t("copy")} onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </LineAction>
        )}
        {editable && !tapped && !message.quote && (
          <LineAction label={t("edit")} onClick={() => onEdit(message)}>
            <PencilLine className="size-3.5" />
          </LineAction>
        )}
      </div>
    </div>
  );
}

function LineAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-md transition hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
    >
      {children}
    </button>
  );
}
