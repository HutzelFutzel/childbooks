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
  rewoundGuideSession,
  withGuideSkips,
  type GuideSession,
} from "../core/guide/session";
import { guideAsk, guideSkipAck, nextGuideSay, composeGuideReply } from "../core/guide/voice";
import type { GuideChoiceOption, GuideConfirmAction } from "../core/guide/widgets";
import { applyGuidePatch, captureGuideFacts, guidePatchContext } from "../core/guide/patch";
import type { GuideSlotId } from "../core/guide/slots";
import { sendGuideTurn } from "./guideTurn";
import { useAppConfigStore } from "./appConfigStore";
import { useProjectsStore } from "./projectsStore";
import type { Project } from "../core/types";
import { withGuidedBriefIfMissing } from "../core/story/brief";
import { getRepos } from "./repos";
import { describeError } from "../core/errors";
import { notify } from "../ui/lib/notify";

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
  /**
   * Take a tapped option. No model call: the option carries its own patch, so this
   * is a local write and the reply comes from `voice.ts`.
   */
  choose: (playlist: Playlist, option: GuideChoiceOption) => Promise<void>;
  /** Give the go-ahead a component is waiting on. */
  confirm: (playlist: Playlist, action: GuideConfirmAction) => Promise<void>;
  /** Restore the facts as they were before a turn, and cut the transcript there. */
  jumpBack: (playlist: Playlist, messageId: string) => Promise<void>;
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
/**
 * Returns the project alongside the cursor because the narration needs both, and
 * both have to come from the same snapshot. `guideAsk` asks whether the active
 * component's generation has finished; resolving the project a second time at the
 * call site would let a render landing in between produce a line about a state the
 * cursor was never computed from.
 */
function cursorAt(
  playlist: Playlist,
  skipped: readonly GuideComponentId[],
): { cursor: GuideCursor; project: Project } | null {
  const project = useProjectsStore.getState().current();
  if (!project) return null;
  return { cursor: nextGuideStep(playlist, project, skipped), project };
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

  /**
   * Mark the reader's most recent turn as a point they can return to.
   *
   * Applied after the write rather than before, because only a turn that actually
   * changed something is worth going back to — a restated fact lands nothing, and
   * offering to undo it would be a button that does nothing. The facts are captured
   * before the write and stamped afterwards for the same reason.
   */
  const checkpoint = (before: Record<string, unknown>): void => {
    set((state) => {
      const index = state.session.messages.findLastIndex((entry) => entry.role === "reader");
      if (index < 0) return state;
      const messages = [...state.session.messages];
      messages[index] = { ...messages[index]!, before };
      return { session: { ...state.session, messages } };
    });
    persist();
  };

  /** Append something the guide says, stamped with the question it addresses. */
  const speak = (
    text: string,
    cursor: GuideCursor | null,
    extra: { skipped?: GuideComponentId[]; applied?: GuideSlotId[] } = {},
  ): void => {
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
      // Guided AI is the default. Persist a brief before the first catch-up so
      // story-mode is already satisfied and the picker never appears. Do not
      // overwrite a brief the wizard (or an earlier visit) already wrote.
      const current = useProjectsStore.getState().current();
      if (current?.id === projectId && !current.config.storyBrief) {
        try {
          await useProjectsStore.getState().patchCurrent((live) => withGuidedBriefIfMissing(live));
        } catch (err) {
          notify.error(err);
        }
      }
      if (get().projectId !== projectId) return;
      set({ session, loaded: true });
    },

    close: () => {
      set({ projectId: null, session: createGuideSession(), loaded: false, sending: false, error: null });
    },

    catchUp: (playlist) => {
      const { loaded, sending, session } = get();
      if (!loaded || sending) return;
      // An empty playlist is "the flow hasn't arrived", not "the book is
      // finished". Speaking the done line here would greet a new book with
      // "that's everything" and then go quiet, which is the empty chat.
      if (playlist.length === 0) return;
      const at = cursorAt(playlist, session.skipped);
      if (!at) return;
      // Whether there's anything new to say is `nextGuideSay`'s decision, not this
      // store's — see the note there on why that logic is pure.
      const line = nextGuideSay(session, at.cursor, at.project);
      if (line) speak(line, at.cursor);
    },

    send: async (playlist, text) => {
      const message = text.trim();
      const { projectId, sending, loaded } = get();
      if (!projectId || !loaded || !message || sending) return;

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
        // The book has been patched by now. Keep `sending` true until the line is
        // in the transcript: dropping it first lets `catchUp` speak the engine's
        // next question, and then this speaks too.
        const session = withGuideSkips(
          get().session,
          outcome.skip,
          (id) => GUIDE_COMPONENTS[id].skippable,
        );
        set({ session });
        if (outcome.applied.length > 0) checkpoint(outcome.before);
        const at = cursorAt(playlist, session.skipped);
        const statingFacts = outcome.intent === "answer" || outcome.intent === "revise";
        const line = at
          ? composeGuideReply({
              acknowledgement: outcome.reply,
              statingFacts,
              landed: outcome.applied.length > 0 || outcome.skip.length > 0,
              cursor: at.cursor,
              project: at.project,
            })
          : outcome.reply;
        speak(line, at?.cursor ?? null, {
          ...(outcome.applied.length > 0 ? { applied: outcome.applied } : {}),
          ...(outcome.skip.length > 0 ? { skipped: outcome.skip } : {}),
        });
        set({ sending: false });
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

    /**
     * A tapped option, applied locally.
     *
     * The whole reason widgets are worth having: the option was built from the same
     * context the validator uses, so there is nothing to interpret. The reader's
     * choice goes into the transcript as if they had said it, the patch goes through
     * `applyGuidePatch` for its no-op detection and receipt, and the next question
     * comes from the catalog. No round trip, no cost, no ambiguity.
     */
    choose: async (playlist, option) => {
      const { projectId, sending, loaded } = get();
      if (!projectId || !loaded || sending) return;

      set((state) => ({
        session: appendGuideMessage(state.session, guideMessage("reader", option.said)),
        sending: true,
        error: null,
      }));

      const { audience, artStyles } = useAppConfigStore.getState();
      const context = guidePatchContext({ audience, artStyles });
      let applied: GuideSlotId[] = [];
      let before: Record<string, unknown> = {};
      try {
        await useProjectsStore.getState().patchCurrent((live) => {
          before = captureGuideFacts(live);
          const outcome = applyGuidePatch(live, option.patch, context);
          applied = outcome.applied;
          return outcome.project;
        });
      } catch (err) {
        set({ sending: false, error: describeError(err) });
        notify.error(err);
        return;
      }
      if (applied.length > 0) checkpoint(before);

      const at = cursorAt(playlist, get().session.skipped);
      speak(at ? guideAsk(at.cursor, at.project) : "", at?.cursor ?? null, {
        ...(applied.length > 0 ? { applied } : {}),
      });
      set({ sending: false });
    },

    /**
     * The reader's go-ahead. Writes through the same store action the wizard's own
     * button uses, so approving in one flow means exactly what it means in the other
     * — see the note in `core/guide/widgets.ts` on why this is not a patch.
     */
    confirm: async (playlist, action) => {
      const { projectId, sending, loaded } = get();
      if (!projectId || !loaded || sending) return;

      const said = action === "approveStory" ? "The story's good — let's illustrate it" : "The cast looks right";
      set((state) => ({
        session: appendGuideMessage(state.session, guideMessage("reader", said)),
        sending: true,
        error: null,
      }));

      try {
        if (action === "approveStory") {
          await useProjectsStore.getState().advanceStage("studio");
        } else {
          await useProjectsStore.getState().updateConfig({ castReady: true });
        }
      } catch (err) {
        set({ sending: false, error: describeError(err) });
        notify.error(err);
        return;
      }

      const at = cursorAt(playlist, get().session.skipped);
      speak(at ? guideAsk(at.cursor, at.project) : "", at?.cursor ?? null);
      set({ sending: false });
    },

    /**
     * Take the reader back to how things were before one of their turns.
     *
     * Two things happen together and neither works alone: the facts go back to the
     * captured checkpoint, and the transcript is cut at that turn. Restoring the book
     * while leaving the conversation would show them a history describing a book that
     * no longer exists; cutting the conversation without restoring would lose the
     * record of a change that is still in effect.
     *
     * Artifacts are not restored — that is the design, not a shortcut. The story and
     * pictures made from the newer facts stay exactly where they are, and the staleness
     * notice then reports that they no longer match and offers to redo them. Handing
     * back the old pictures would be guessing that the reader wants a different book
     * rather than a corrected one.
     */
    jumpBack: async (playlist, messageId) => {
      const { projectId, sending, session } = get();
      if (!projectId || sending) return;

      const target = session.messages.find((entry) => entry.id === messageId);
      if (!target?.before) return;

      set({ sending: true });

      const { audience, artStyles } = useAppConfigStore.getState();
      const context = guidePatchContext({ audience, artStyles });
      let applied: GuideSlotId[] = [];
      try {
        await useProjectsStore.getState().patchCurrent((live) => {
          const outcome = applyGuidePatch(live, target.before!, context);
          applied = outcome.applied;
          return outcome.project;
        });
      } catch (err) {
        set({ sending: false, error: describeError(err) });
        notify.error(err);
        return;
      }

      const rewound = rewoundGuideSession(get().session, messageId);
      set({ session: rewound, error: null });
      persist();

      const at = cursorAt(playlist, rewound.skipped);
      // Speaks unconditionally rather than through `nextGuideSay`: the transcript was
      // just cut, so whatever the guide last said about this question is gone and the
      // reader would otherwise be left with a composer and no prompt.
      speak(at ? guideAsk(at.cursor, at.project) : "", at?.cursor ?? null, {
        ...(applied.length > 0 ? { applied } : {}),
      });
      set({ sending: false });
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
      const at = cursorAt(playlist, session.skipped);
      if (!at) return;
      speak(guideSkipAck(GUIDE_COMPONENTS[id], at.cursor, at.project), at.cursor, { skipped: [id] });
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
