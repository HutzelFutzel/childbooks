"use client";

/**
 * Whether a change to the story is being prepared, and what to say when one
 * could not be.
 *
 * The job runs on the server for a while after the guide has said it is
 * reworking the story. The Story tab knows about it, but the conversation is
 * always on screen, so the activity indicator and the failure line come from
 * here rather than from that tab: a reader looking at the chat, or at another
 * tab, must still see that something is happening, and must be told when it did
 * not work out instead of waiting on it.
 */
import { useEffect, useState } from "react";
import { STORY_EDIT_SCOPE_ERROR } from "../../core/story/revision";
import { subscribeStoryRevisions } from "../../platform/storyRevisions";
import { useChatStudio } from "../../state/chatStudio";

const ACTIVE = new Set(["pending", "running"]);

/** Revisions seen working in this visit: only those may announce that they failed. */
const seenWorking = new Set<string>();
const announcedFailed = new Set<string>();

/** Written, or written and waiting for the reader's keep-or-drop: the story is not settled yet. */
const UNSETTLED = new Set(["pending", "running", "ready"]);

/**
 * Whether a change to the story is still open, from the moment it is asked for until the reader has
 * finished reviewing it. Until then the book's size and drawing are not offered: they would be
 * decided for a story that is about to change.
 */
export function useStoryRevisionOpen(projectId: string | undefined): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    if (!projectId) return;
    let stop: (() => void) | undefined;
    try {
      stop = subscribeStoryRevisions(projectId, (revisions) => {
        setOpen(revisions.some((revision) => UNSETTLED.has(revision.status)));
      });
    } catch {
      // Not signed in: there are no revisions to wait for.
    }
    return () => stop?.();
  }, [projectId]);

  return open;
}

export function useRevisionActivity(projectId: string | undefined): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
    if (!projectId) return;
    let stop: (() => void) | undefined;
    const watching = Date.now();
    try {
      stop = subscribeStoryRevisions(projectId, (revisions) => {
        const latest = revisions[0];
        setActive(Boolean(latest && ACTIVE.has(latest.status)));
        if (!latest) return;
        if (ACTIVE.has(latest.status)) {
          seenWorking.add(latest.id);
          return;
        }
        // An old failure found on load is not news; one that happened while we
        // watched is, even if it failed before we ever saw it working.
        const fresh = seenWorking.has(latest.id) || latest.updatedAt >= watching;
        if (latest.status === "error" && fresh && !announcedFailed.has(latest.id)) {
          announcedFailed.add(latest.id);
          useChatStudio
            .getState()
            .say(
              [{ key: latest.error === STORY_EDIT_SCOPE_ERROR ? "revisionOutside" : "revisionFailed", priority: "result" }],
              { unprompted: true },
            );
        }
      });
    } catch {
      // Not signed in: there are no revisions to watch.
    }
    return () => stop?.();
  }, [projectId]);

  return active;
}
