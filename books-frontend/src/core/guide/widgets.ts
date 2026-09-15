/**
 * How the reader answers — the input affordance for whichever question is live.
 *
 * `voice.ts` decides what the guide *says*; this decides what the reader can *do*
 * about it. They are separate because the answer differs in kind: a question with a
 * closed list of valid answers should be a row of options, and typing "the four to
 * five one" so a model can map it back to `age-4-5` is a worse interface than
 * tapping it. Free text is the fallback for genuinely open questions, not the
 * default for all of them.
 *
 * **A tapped option is not a model call.** It carries the patch it produces, and
 * that patch goes through `applyGuidePatch` like any other — so the option list and
 * the validator are fed from the same `GuidePatchContext`, and an option the reader
 * can see is an option the writer will accept. This is the whole reason widgets are
 * worth building: every question answerable by a tap is a question with no
 * interpretation step, no latency, no token cost and no ambiguity.
 *
 * **Confirmations are not patches.** "The story is good" and "the cast looks right"
 * aren't facts a conversation states about a book, they are the reader's go-ahead,
 * and they write flags that have no slot (`stage`, `config.castReady`). Those use the
 * same store actions the wizard's own buttons use — see `GuideConfirmAction`. The
 * closed world in `patch.ts` exists to contain *untrusted* input; a button this
 * reader pressed is trusted exactly as much as the wizard's button, and routing it
 * through a validator built for model output would be theatre.
 *
 * Keyed by component id, in a table rather than on the components themselves,
 * because the options need the live admin config and the catalog is meant to stay a
 * description of the book. `scripts/guide-widget-invariants.ts` checks that the
 * table only names real components, writes only their own slots, and offers only
 * values the validator accepts.
 */
import { STORY_MODES } from "../config/storyCraftCatalog";
import { enabledAudienceProfiles, type AudienceConfig } from "../config/audience";
import { resolveArtStyles, type ArtStylesConfig } from "../config/artStyles";
import type { Project } from "../types";
import {
  castAwaitingConfirmation,
  type GuideComponentId,
  type GuideEffectId,
} from "./components";
import {
  guideEffectState,
  type GuideEffectSignals,
  type GuideEffectState,
} from "./effects";
import type { GuideCursor } from "./engine";
import type { GuideSlotId } from "./slots";

/** A flag the reader sets directly, using the same action the wizard's button does. */
export type GuideConfirmAction = "approveStory" | "confirmCast";

export interface GuideChoiceOption {
  /** Stable id — the config value, not a label. */
  id: string;
  label: string
  /** One supporting line. Omitted where the label says everything. */
  hint?: string;
  /** The patch a tap produces, ready for `applyGuidePatch`. */
  patch: Record<string, unknown>;
  /** What the transcript records the reader as having said. */
  said: string;
}

export type GuideWidget =
  | { kind: "text"; placeholder: string }
  | { kind: "choice"; slot: GuideSlotId; options: GuideChoiceOption[]; placeholder: string }
  | { kind: "confirm"; action: GuideConfirmAction; affirm: string; placeholder: string }
  /**
   * Generation, with its progress. Nothing to answer, but the reader may still talk —
   * and when `state.resumable` they can start or retry it. Carries the whole
   * {@link GuideEffectState} rather than a copy of its fields so the pane cannot
   * disagree with the count.
   */
  | { kind: "reveal"; effect: GuideEffectId; state: GuideEffectState; placeholder: string }
  /** Waiting on something the reader cannot start and no effect explains. */
  | { kind: "wait"; message: string; placeholder: string };

/** The live worlds an option list is drawn from. Same sources as the patch context. */
export interface GuideWidgetSources {
  audience?: AudienceConfig | null;
  artStyles?: ArtStylesConfig | null;
  /** Live job state, so a reveal can tell "running" from "not started". */
  signals?: GuideEffectSignals;
}

/**
 * The options for a component, or null when its question is genuinely open.
 *
 * Only the closed-list questions appear here. `story-idea` deliberately does not:
 * its catalog of themes is scoped per age band and runs to dozens, and "a birthday
 * trip to the sea" is a better answer than anything a picker would offer.
 */
function optionsFor(
  id: GuideComponentId,
  sources: GuideWidgetSources,
): { slot: GuideSlotId; options: GuideChoiceOption[] } | null {
  switch (id) {
    case "story-mode":
      return {
        slot: "storyMode",
        options: STORY_MODES.map((mode) => ({
          id: mode.id,
          label: mode.label,
          hint: mode.tagline,
          patch: { storyMode: mode.id },
          said: mode.label,
        })),
      };

    case "audience":
      return {
        slot: "audience",
        options: enabledAudienceProfiles(sources.audience ?? null).map((profile) => ({
          id: profile.id,
          label: profile.label,
          patch: { audience: { ageRangeId: profile.id } },
          said: `Pitch it at ${profile.label}`,
        })),
      };

    case "art-style":
      return {
        slot: "artStyle",
        // No hint, deliberately. A style's description is a full sentence and there
        // can be a dozen of them, so as chip subtitles they truncate to unreadable
        // half-phrases — and "Soft Watercolor" already says it. The pane alongside is
        // showing the actual preview images, which is what anyone choosing a look is
        // really going on.
        options: resolveArtStyles(sources.artStyles ?? null).map((style) => ({
          id: style.id,
          label: style.label,
          patch: { artStyle: { presetId: style.id } },
          said: `Draw it in ${style.label}`,
        })),
      };

    default:
      return null;
  }
}

/**
 * What the reader can do about the current question.
 *
 * Order matters: a component waiting on generation has nothing to answer even if it
 * would otherwise offer options, and a confirmation only appears at the moment it is
 * actually being asked for.
 */
export function guideWidget(
  cursor: GuideCursor,
  project: Project,
  sources: GuideWidgetSources = {},
): GuideWidget {
  const component = cursor.component;
  if (!component) {
    return { kind: "text", placeholder: "Anything you'd like to change?" };
  }

  /**
   * Generation takes precedence over every other affordance.
   *
   * A component with an effect that hasn't finished is a component whose question is
   * "shall I get on with it" — offering a picker or a confirm button there would ask
   * the reader about something the guide is in the middle of. The effect's own state
   * decides whether that reads as progress or as an offer to start.
   */
  if (component.effect) {
    const state = guideEffectState(component.effect, project, sources.signals);
    if (state.status !== "done") {
      return {
        kind: "reveal",
        effect: component.effect,
        state,
        placeholder:
          state.status === "running"
            ? "Ask me anything while this finishes…"
            : placeholderFor(component.id),
      };
    }
  }

  // Blocked with no effect to explain it: waiting on something the reader cannot
  // supply and cannot start. Offering a choice here would be a control that does
  // nothing.
  if (cursor.status === "blocked") {
    return {
      kind: "wait",
      message: cursor.blockers[0] ?? `Getting ${component.title.toLowerCase()} ready.`,
      placeholder: "Ask me anything while this finishes…",
    };
  }

  if (component.id === "story-approve") {
    return {
      kind: "confirm",
      action: "approveStory",
      affirm: "Yes — let's illustrate it",
      placeholder: "Or tell me what to change",
    };
  }

  if (component.id === "cast-looks" && castAwaitingConfirmation(project)) {
    return {
      kind: "confirm",
      action: "confirmCast",
      affirm: "They look right",
      placeholder: "Or tell me what to redraw",
    };
  }

  const choice = optionsFor(component.id, sources);
  if (choice && choice.options.length > 0) {
    return { ...choice, kind: "choice", placeholder: placeholderFor(component.id) };
  }

  return { kind: "text", placeholder: placeholderFor(component.id) };
}

/**
 * The prompt in the empty composer.
 *
 * A placeholder is the cheapest hint about what a good answer looks like, and
 * "Message…" wastes it. Demonstrating one — "It's for Maya, she's 5" — teaches the
 * shape of a useful reply better than instructions above the box would.
 */
function placeholderFor(id: GuideComponentId): string {
  switch (id) {
    case "story-mode":
      return "Or tell me in your own words";
    case "story-cast":
      return "It's for Maya, she's 5";
    case "audience":
      return "Or: she's just starting to read";
    case "story-idea":
      return "A birthday trip to the sea";
    case "story-draft":
      return "Paste your story, or ask me to write it";
    case "art-style":
      return "Or describe the look you want";
    case "review":
      return "Anything you'd like to change?";
    default:
      return "Tell me, or ask me anything";
  }
}
