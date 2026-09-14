/**
 * The conversation's state machine.
 *
 * Holds one book's transcript and the components its reader declined, and owns the
 * three ways the guide can speak: answering a message, asking the next question,
 * and acknowledging a skip. What it deliberately does *not* hold is any notion of
 * "which step we're on" — that comes from `nextGuideStep` against the live project
 * every time it is needed, so a render finishing in the background, a second tab,
 * or the reader editing a fact in the artifact pane all move the conversation
 * forward without this store being told.
 *
 * The one piece of bookkeeping that does live here is which question the guide has
 * already asked, and even that is read back off the transcript rather than tracked
 * separately (see `lastSpokenAbout`). The guide speaks unprompted whenever the book
 * changes under it, so without that comparison it would re-ask the question the
 * reader is looking at every time a page render landed.
 */
"use client";

import { create } from "zustand";
import type { ResolvedGuideComponent } from "../core/guide/playlist";
import { nextGuideStep, type GuideCursor } from "../core/guide/engine";
import { GUIDE_COMPONENTS, type GuideComponentId } from "../core/guide/components";
import {
  appendGuideMessage,
  createGuideSession,
  guideMessage,
  guideTranscriptWindow,
  withGuideSkips,
  type GuideSession,
} from "../core/guide/session";
import { guideAsk, guideSkipAck, nextGuideSay } from "../core/guide/voice";
import { sendGuideTurn } from "./guideTurn";
import { useProjectsStore } from "./projectsStore";
import { getRepos } from "./repos";
import { describeError } from "../core/errors";

/** Turns of history handed to the interpreter. Enough for "yes"; not enough to drift. */
const TRANSCRIPT_WINDOW = 8;

interface GuideStoreState {
  /** The book this conversation belongs to, or null when none is open. */
  projectId: string | null;
  session: GuideSession;
  /** False until the stored transcript has been read, so nothing speaks early. */
  loaded: boolean;
  sending: boolean;
  /** Set when a turn failed to reach the backend. Cleared by a retry. */
  error: string | null;

  open: (projectId: string) => Promise<void>;
  close: () => void;
  /** Send what the reader typed and fold the result into the book. */
  send: (playlist: Playlist, text: string) => Promise<void>;
  /** Re-send the last message that failed. */
  retry: (playlist: Playlist) => Promise<void>;
  /** Decline an optional component and move on. */
  skip: (playlist: Playlist, id: GuideComponentId) => void;
  /**
   * Say the next thing, if there is anything new to say. Idempotent — safe to call
   * from an effect on every render, which is what makes it react to the book
   * changing rather than to any particular event.
   */
  catchUp: (playlist: Playlist) => void;
  /** Forget the conversation. The book is untouched. */
  clear: () => Promise<void>;
}

type Playlist = readonly ResolvedGuideComponent[];

/**
 * Where the guide is, derived fresh from the live book every time.
 *
 * The playlist is passed in rather than read from the config store, even though the
 * store could reach it. The surface that rendered the question is holding the
 * playlist it rendered from, and asking again here would be a second answer to "which
 * flow is this" — one that differs for the moment before the live config arrives, or
 * whenever an admin saves a reorder mid-sentence. The reply the reader gets should be
 * about the question they were actually asked.
 */
function cursorAt(playlist: Playlist, skipped: readonly GuideComponentId[]): GuideCursor | null {
  const project = useProjectsStore.getState().current();
  if (!project) return null;
  return nextGuideStep(playlist, project, skipped);
}

export const useGuideStore = create<GuideStoreState>((set, get) => {
  /**
   * Write the transcript out. Fire-and-forget on purpose: this is scrollback, the
   * book holds every fact, and a failed write is not worth interrupting someone
   * mid-conversation to report.
   */
  const persist = (): void => {
    const { projectId, session } = get();
    if (!projectId) return;
    void getRepos()
      .then((repos) => repos.guide.save(projectId, session))
      .catch(() => {});
  };

  /** Append something the guide says, stamped with the question it addresses. */
  const speak = (text: string, cursor: GuideCursor | null, extra: { skipped?: GuideComponentId[] } = {}): void => {
    if (!text.trim()) return;
    set((state) => ({
      session: appendGuideMessage(
        state.session,
        guideMessage("guide", text, {
          ...extra,
          ...(cursor?.component ? { about: cursor.component.id } : {}),
        }),
      ),
    }));
    persist();
  };

  return {
    projectId: null,
    session: createGuideSession(),
    loaded: false,
    sending: false,
    error: null,

    open: async (projectId) => {
      if (get().projectId === projectId && get().loaded) return;
      set({ projectId, session: createGuideSession(), loaded: false, sending: false, error: null });
      const repos = await getRepos();
      const session = await repos.guide.load(projectId);
      // Another book may have been opened while this read was in flight.
      if (get().projectId !== projectId) return;
      set({ session, loaded: true });
    },

    close: () => {
      set({ projectId: null, session: createGuideSession(), loaded: false, sending: false, error: null });
    },

    catchUp: (playlist) => {
      const { loaded, sending, session } = get();
      if (!loaded || sending) return;
      const cursor = cursorAt(playlist, session.skipped);
      if (!cursor) return;
      // Whether there's anything new to say is `nextGuideSay`'s decision, not this
      // store's — see the note there on why that logic is pure.
      const line = nextGuideSay(session, cursor);
      if (line) speak(line, cursor);
    },

    send: async (playlist, text) => {
      const message = text.trim();
      const { projectId, sending } = get();
      if (!projectId || !message || sending) return;

      // Captured before the reader's message is appended: the interpreter takes
      // the new message separately from the history it is read against.
      const history = guideTranscriptWindow(get().session, TRANSCRIPT_WINDOW);
      set((state) => ({
        session: appendGuideMessage(state.session, guideMessage("reader", message)),
        sending: true,
        error: null,
      }));
      persist();

      try {
        const outcome = await sendGuideTurn(message, history);
        // The book has been patched by now, so the cursor is asked again rather
        // than reused — the reply is about wherever the conversation has got to.
        const session = withGuideSkips(
          get().session,
          outcome.skip,
          (id) => GUIDE_COMPONENTS[id].skippable,
        );
        set({ session, sending: false });
        const cursor = cursorAt(playlist, session.skipped);
        speak(outcome.reply || guideAsk(cursor ?? { component: null, status: "done", blockers: [] }), cursor, {
          ...(outcome.applied.length > 0 ? { applied: outcome.applied } : {}),
          ...(outcome.skip.length > 0 ? { skipped: outcome.skip } : {}),
        });
      } catch (err) {
        // The reader's words stay on screen and are marked, so the composer can
        // offer to send them again rather than making them retype.
        set((state) => ({
          sending: false,
          error: describeError(err),
          session: {
            ...state.session,
            messages: state.session.messages.map((entry, index) =>
              index === state.session.messages.length - 1 && entry.role === "reader"
                ? { ...entry, failed: true }
                : entry,
            ),
          },
        }));
        persist();
      }
    },

    retry: async (playlist) => {
      const { session } = get();
      const last = session.messages[session.messages.length - 1];
      if (!last || last.role !== "reader" || !last.failed) return;
      set({
        session: { ...session, messages: session.messages.slice(0, -1) },
        error: null,
      });
      await get().send(playlist, last.text);
    },

    skip: (playlist, id) => {
      if (!GUIDE_COMPONENTS[id].skippable) return;
      const session = withGuideSkips(get().session, [id], (candidate) => GUIDE_COMPONENTS[candidate].skippable);
      if (session === get().session) return;
      set({ session });
      const cursor = cursorAt(playlist, session.skipped);
      speak(
        guideSkipAck(GUIDE_COMPONENTS[id], cursor ?? { component: null, status: "done", blockers: [] }),
        cursor,
        { skipped: [id] },
      );
    },

    clear: async () => {
      const { projectId } = get();
      if (!projectId) return;
      set({ session: createGuideSession(), error: null });
      const repos = await getRepos();
      await repos.guide.remove(projectId);
    },
  };
});
