/**
 * The guided studio: the conversation, and the book it is making.
 *
 * The layout is the argument. Chat on the left is where decisions are made; the book
 * on the right is what those decisions produced, live. Neither is a step in a flow —
 * they are two views of the same moment, which is what lets a reader answer a
 * question and watch the answer land without navigating anywhere.
 *
 * **The right-hand pane is the existing studio, not a copy of it.** It renders
 * `StudioWorkspace` with its step rail suppressed, so the manuscript, the cast shelf,
 * the page canvas and the flip-through are the same components the wizard uses — and
 * so are the background effects that produce them (the story analysis and the page
 * plan both kick off from in there). Reimplementing those beside the chat would mean
 * two surfaces that had to agree about a book forever; this way there is one, and the
 * chat is what changed. Later phases replace those panels one at a time.
 *
 * **Which panel is showing is not this component's decision.** The destination comes
 * from the route, and in guide mode the route is already driven by the engine (see
 * `StudioApp` and `studioRoutes.ts`), so the pane follows the same cursor the chat is
 * talking about. There is no second source of "where are we".
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, MessageCircle } from "lucide-react";
import { coveredGuideSlots, guideProgress, nextGuideStep } from "../../core/guide/engine";
import type { GuideCanvasKind } from "../../core/guide/components";
import type { ResolvedGuideComponent } from "../../core/guide/playlist";
import type { GuideSlotId } from "../../core/guide/slots";
import { guideWidget } from "../../core/guide/widgets";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useGuideStore } from "../../state/guideStore";
import { useProjectsStore } from "../../state/projectsStore";
import { StudioWorkspace } from "../studio/StudioWorkspace";
import type { StudioDestination } from "../studio/studioRoutes";
import { cn } from "../lib/cn";
import { GuideChat } from "./GuideChat";
import { GuideFacts } from "./GuideFacts";
import { canvasDestination } from "./guideCanvas";

/** Which pane a narrow screen is showing. Both are on screen from `lg` up. */
type Pane = "chat" | "book";

export function GuideStudio({
  playlist,
  onNavigate,
}: {
  playlist: readonly ResolvedGuideComponent[];
  onNavigate: (destination: StudioDestination) => void;
}) {
  const project = useProjectsStore((s) => s.current());
  const session = useGuideStore((s) => s.session);
  const loaded = useGuideStore((s) => s.loaded);
  const sending = useGuideStore((s) => s.sending);
  const error = useGuideStore((s) => s.error);
  const open = useGuideStore((s) => s.open);
  const send = useGuideStore((s) => s.send);
  const retry = useGuideStore((s) => s.retry);
  const skip = useGuideStore((s) => s.skip);
  const catchUp = useGuideStore((s) => s.catchUp);
  const choose = useGuideStore((s) => s.choose);
  const confirm = useGuideStore((s) => s.confirm);
  const audience = useAppConfigStore((s) => s.audience);
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const [pane, setPane] = useState<Pane>("chat");

  const projectId = project?.id ?? null;

  // Load this book's conversation. Keyed on the id rather than the project so a
  // render landing mid-sentence doesn't re-read the transcript from storage.
  useEffect(() => {
    if (projectId) void open(projectId);
  }, [projectId, open]);

  const cursor = useMemo(
    () => (project ? nextGuideStep(playlist, project, session.skipped) : null),
    [playlist, project, session.skipped],
  );
  const progress = useMemo(
    () => (project ? guideProgress(playlist, project, session.skipped) : null),
    [playlist, project, session.skipped],
  );
  const covered = useMemo(
    () => (project ? coveredGuideSlots(playlist, project, session.skipped) : []),
    [playlist, project, session.skipped],
  );
  const widget = useMemo(
    () =>
      cursor && project
        ? guideWidget(cursor, project, { audience, artStyles })
        : ({ kind: "text", placeholder: "" } as const),
    [cursor, project, audience, artStyles],
  );

  /**
   * A surface the reader asked to see, which overrides the one the cursor implies.
   *
   * Cleared whenever the conversation moves on: a pin is "show me that again", not a
   * mode, and leaving it set would mean answering the next question while looking at
   * the answer to the last one. This is also the seed of phase 6's jump-back.
   */
  const [pinned, setPinned] = useState<GuideCanvasKind | null>(null);
  const activeId = cursor?.component?.id ?? null;
  useEffect(() => {
    setPinned(null);
  }, [activeId]);

  const canvas = pinned ?? cursor?.component?.canvas ?? "none";
  const destination = canvasDestination(canvas);

  // Keep the address bar on the surface being shown, so a refresh or a shared link
  // comes back to it. The route is not the source of truth here — the cursor is —
  // which is why this is an effect rather than the pane reading the route.
  useEffect(() => {
    onNavigate(destination);
  }, [destination, onNavigate]);

  const openSlot = useCallback(
    (slot: GuideSlotId) => {
      const owner = playlist.find((component) => component.slots.includes(slot));
      if (owner) setPinned(owner.canvas);
    },
    [playlist],
  );

  // Say the next thing whenever there is a next thing to say. Deliberately keyed on
  // the cursor rather than on any event: the book moves on its own — a render
  // finishes, a page plan arrives, the reader edits a fact in the pane on the right
  // — and all of those should advance the conversation. `catchUp` is idempotent, so
  // running it on every change is the simplest correct thing.
  useEffect(() => {
    if (loaded) catchUp(playlist);
  }, [loaded, catchUp, playlist, cursor?.component?.id, cursor?.status]);

  if (!project) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Pane switch, small screens only. Two columns don't fit a phone, and a chat
          squeezed beside a book page serves neither. */}
      <div className="flex shrink-0 gap-1 border-b border-ink-100 bg-white px-3 py-2 lg:hidden">
        <PaneTab active={pane === "chat"} onClick={() => setPane("chat")} icon={<MessageCircle className="size-4" />}>
          Chat
        </PaneTab>
        <PaneTab active={pane === "book"} onClick={() => setPane("book")} icon={<BookOpen className="size-4" />}>
          Your book
        </PaneTab>
      </div>

      <aside
        className={cn(
          "flex min-h-0 min-w-0 flex-col border-ink-100 bg-canvas lg:w-[26rem] lg:shrink-0 lg:border-r xl:w-[30rem]",
          pane === "chat" ? "flex-1" : "hidden lg:flex",
        )}
      >
        {/* A hairline rather than a labelled bar: it answers "how far along am I"
            at a glance and says nothing when there is nothing to say. Terminal
            components are already excluded, so full really does mean finished. */}
        {progress && progress.total > 0 && (
          <div className="h-0.5 shrink-0 bg-ink-100" role="presentation">
            <div
              className="h-full bg-brand-400 transition-[width] duration-500 ease-out"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
        )}

        <GuideFacts
          project={project}
          slots={covered}
          onOpen={openSlot}
          className="shrink-0 px-4 pt-3"
        />

        <GuideChat
          project={project}
          messages={session.messages}
          cursor={cursor}
          widget={widget}
          sending={sending}
          error={error}
          onSend={(text) => void send(playlist, text)}
          onChoose={(option) => void choose(playlist, option)}
          onConfirm={(action) => void confirm(playlist, action)}
          onRetry={() => void retry(playlist)}
          onSkip={() => cursor?.component && skip(playlist, cursor.component.id)}
        />
      </aside>

      <div
        className={cn(
          "min-h-0 min-w-0 flex-col bg-ink-50/30 lg:flex lg:flex-1",
          pane === "book" ? "flex flex-1" : "hidden",
        )}
      >
        <StudioWorkspace
          key={project.id}
          project={project}
          destination={destination}
          onNavigate={onNavigate}
          chrome="bare"
        />
      </div>
    </div>
  );
}

function PaneTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-ink-50",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
