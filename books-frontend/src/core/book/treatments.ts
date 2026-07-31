/**
 * Region treatments: what happens to the artwork where text sits.
 *
 * The important field is {@link RegionTreatment.mechanism}, because it decides
 * how reliable the treatment is and whether the image model matters at all:
 *
 *   - `prompt`   — the model paints the calm area. Beautiful, soft-constrained;
 *                  it complies most of the time and sometimes doesn't.
 *   - `post`     — we compute it (scrim, blur, desaturate, feathered edge).
 *                  Exact, and completely model-independent.
 *   - `geometry` — the artwork was never generated there at all. Absolute.
 *
 * A `prompt` treatment names a `fallback`, so when the post-generation check
 * finds the region isn't actually calm, the deterministic version is applied
 * instead. Prompt-first for beauty, measured, post-processed only when needed.
 */

export type TreatmentMechanism = "prompt" | "post" | "geometry";

export interface RegionTreatment {
  id: string;
  label: string;
  description: string;
  mechanism: TreatmentMechanism;
  /**
   * Treatment to apply when a `prompt` mechanism fails verification. Must name
   * a `post` treatment (enforced by {@link validateTreatments}).
   */
  fallback?: string;
  /**
   * How the region should LOOK, as a phrase completing "Treat that area so it
   * …". Deliberately says nothing about *where* the region is — the layout
   * facts already state that, and repeating it dilutes both instructions.
   * Only meaningful for `prompt` treatments.
   */
  promptFragment?: string;
  /** Parameters for `post` treatments, read by the compositor. */
  params?: Record<string, number | string>;
}

export const REGION_TREATMENTS: RegionTreatment[] = [
  {
    id: "calm",
    label: "Calm area",
    description:
      "The illustration stays soft and low-detail where the text sits — the default, and the least intrusive.",
    mechanism: "prompt",
    fallback: "scrim",
    promptFragment: "holds soft, gently varying background tones and nothing else",
  },
  {
    id: "flat-field",
    label: "Flat colour field",
    description:
      "A genuinely flat, poster-like area of one colour behind the words.",
    mechanism: "prompt",
    fallback: "scrim",
    promptFragment:
      "is a flat, unbroken field of a single soft colour drawn from the scene's palette, with no texture, gradient or detail",
  },
  {
    id: "gradient-fade",
    label: "Fade to a wash",
    description:
      "The artwork fades gradually into a pale wash toward the text, with no visible boundary.",
    mechanism: "prompt",
    fallback: "gradient-scrim",
    promptFragment:
      "fades gradually into a pale, airy wash, with a soft transition rather than a visible boundary",
  },
  {
    id: "painted-panel",
    label: "Painted panel",
    description:
      "A crisp-edged panel painted into the artwork — a torn paper strip, a card, a window.",
    mechanism: "prompt",
    fallback: "hard-edge",
    promptFragment:
      "is a clean, crisp-edged panel painted into the scene — like a torn paper strip or a card laid over it — with a plain pale interior and a clearly defined edge",
  },
  {
    id: "depth-of-field",
    label: "Out of focus",
    description:
      "The region is rendered with a shallow depth of field, blurred behind the words.",
    mechanism: "prompt",
    fallback: "backdrop-blur",
    promptFragment:
      "falls softly out of focus under a shallow depth of field, with the sharp detail kept elsewhere",
  },

  // ---- Deterministic (model-independent) ----------------------------------
  {
    id: "none",
    label: "Untouched",
    description: "No treatment — text sits directly on the artwork as generated.",
    mechanism: "post",
    params: {},
  },
  {
    id: "scrim",
    label: "Soft scrim",
    description: "A translucent wash laid over the artwork behind the text.",
    mechanism: "post",
    params: { color: "#ffffff", opacity: 0.72, feather: 0.02, corner: 0.02 },
  },
  {
    id: "gradient-scrim",
    label: "Faded scrim",
    description: "A scrim that fades out toward the artwork, with no visible edge.",
    mechanism: "post",
    params: { color: "#ffffff", opacity: 0.82, feather: 0.35, corner: 0 },
  },
  {
    id: "backdrop-blur",
    label: "Blurred backdrop",
    description: "The artwork under the text is blurred and slightly lightened.",
    mechanism: "post",
    params: { blur: 0.02, lighten: 0.12, feather: 0.04 },
  },
  {
    id: "desaturate",
    label: "Muted backdrop",
    description: "The artwork under the text keeps its shapes but loses most of its colour.",
    mechanism: "post",
    params: { saturation: 0.25, lighten: 0.18, feather: 0.04 },
  },
  {
    id: "hard-edge",
    label: "Hard edge",
    description: "The artwork stops at a crisp line; the text sits on flat page colour.",
    mechanism: "geometry",
    params: { feather: 0 },
  },
  {
    id: "soft-edge",
    label: "Feathered edge",
    description: "The artwork dissolves gradually into the page toward the text.",
    mechanism: "geometry",
    params: { feather: 0.06 },
  },
];

const BY_ID = new Map(REGION_TREATMENTS.map((t) => [t.id, t]));

export const DEFAULT_TREATMENT_ID = "calm";

export function getTreatment(id: string | undefined | null): RegionTreatment {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get(DEFAULT_TREATMENT_ID)!;
}

/** Treatments an admin may pick for a text slot, in catalog order. */
export function selectableTreatments(): RegionTreatment[] {
  return REGION_TREATMENTS.filter((t) => t.id !== "none" || true);
}

/**
 * Resolve a treatment against what the chosen model can actually do.
 *
 * Prompt-directed treatments rely on the model honouring a soft instruction, so
 * a model with weak negative-space control is given the deterministic fallback
 * instead. This is why layouts stay available on every model: the *treatment*
 * degrades, not the layout.
 */
export function resolveTreatmentForModel(
  treatment: RegionTreatment,
  negativeSpaceControl: "weak" | "strong",
): RegionTreatment {
  if (treatment.mechanism !== "prompt") return treatment;
  if (negativeSpaceControl === "strong") return treatment;
  return getTreatment(treatment.fallback ?? "scrim");
}

/** Catalog invariants, asserted by the print-invariants script. */
export function validateTreatments(): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const t of REGION_TREATMENTS) {
    if (ids.has(t.id)) problems.push(`Duplicate treatment id "${t.id}".`);
    ids.add(t.id);
    if (t.mechanism === "prompt") {
      if (!t.promptFragment) problems.push(`Treatment "${t.id}" is prompt-driven but has no promptFragment.`);
      const fb = t.fallback ? BY_ID.get(t.fallback) : undefined;
      if (!fb) problems.push(`Treatment "${t.id}" has no resolvable fallback.`);
      else if (fb.mechanism === "prompt") {
        problems.push(`Treatment "${t.id}" falls back to "${fb.id}", which is also prompt-driven.`);
      }
    }
  }
  return problems;
}
