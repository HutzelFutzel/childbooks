/**
 * The prompt registry: the code-owned contract behind every configurable
 * prompt. It declares, per template key (`actionId` or `actionId/variantId`):
 *   - the ordered default blocks (the exact strings the app shipped with),
 *   - each block's `enabledWhen` runtime predicate (wiring it to pipeline state),
 *   - the variables the pipeline guarantees to supply + sample values for the
 *     admin live-preview.
 *
 * Adding a prompt/variant = add a key here (+ its blocks + metadata) and it
 * flows to the admin dashboard, the renderer and the pipelines automatically.
 * The wording is editable from the dashboard; this structure is not.
 */
import type { PromptBlock, PromptTemplate, PromptsConfig } from "../config/prompts";

function blk(id: string, text: string, enabledWhen?: string): PromptBlock {
  return enabledWhen ? { id, text, enabledWhen } : { id, text };
}

// ---- Default templates (ported verbatim from the pipeline builders) --------

const DEFAULT_TEMPLATES: Record<string, PromptTemplate> = {
  // core/pipeline/analysis.ts → analyzeStory
  storyAnalysis: {
    system: [
      blk(
        "role",
        "You are a children's-book art director. Analyze the story and identify every subject that must look IDENTICAL each time it appears so the illustrations stay consistent. Include recurring CHARACTERS (people, animals, creatures), important PLACES/settings, and significant recurring OBJECTS. Skip one-off background details that never need to match. For each, write a concise but vivid visual description (appearance, colors, distinguishing features) grounded in the story; infer sensible details where the story is silent. Describe only the subject itself — do NOT mention the art style, medium, or rendering technique (that is applied separately). When a subject's appearance is defined by its relationship to another subject (e.g. a sibling, or an object that belongs in a place), reference that other subject by its exact name in the description so the relationship is preserved. Rank importance: high = central/appears often, medium = recurring, low = minor but still needs consistency. Also write a 1-2 sentence summary of the story's visual world.",
      ),
    ],
    user: [
      blk("age", "Target age range: {{age}}."),
      blk("ageGuidance", "{{ageGuidance}}"),
      blk("story", "\nSTORY:\n{{story}}"),
    ],
  },

  // core/pipeline/analysis.ts → generateAnchorDescription
  anchorDescription: {
    system: [
      blk(
        "role",
        'You are a children\'s-book art director. Write a concise but vivid VISUAL description for a single {{type}} named "{{name}}" that must stay consistent across the book. Ground it in the story; infer sensible, specific details (appearance, colors, distinguishing features) where the story is silent. Describe only the subject itself — do NOT mention the art style, medium or rendering technique. If this subject\'s look depends on another listed subject (a relative to resemble, or an object/place it contains), reference that subject by its EXACT name. Reply with ONLY the description text — no preamble, no quotes — in 1-3 sentences.',
      ),
    ],
    user: [
      blk("age", "Target age range: {{age}}."),
      blk("ageGuidance", "{{ageGuidance}}"),
      blk("others", "\nOTHER KNOWN SUBJECTS:\n{{others}}"),
      blk("story", "\nSTORY:\n{{story}}"),
      blk("ask", '\nNow write the visual description for the {{type}} "{{name}}".'),
    ],
  },

  // core/pipeline/screenplay.ts → generateScreenplay
  screenplay: {
    system: [
      blk(
        "role",
        "You are an award-winning children's picture-book author and art director. Produce a complete page-by-page screenplay for the book. For each page/spread provide: the narrative text, a vivid illustration brief, a layout note, and which named anchors appear. Illustration briefs must be concrete and reference the named anchors so the art stays consistent. {{spreadGuidance}} {{textGuidance}} {{ageGuidance}} {{placementGuidance}} Also design the book's covers: a frontCover (catchy title + short subtitle + illustration brief), a backCover (a short blurb as 'title', optional subtitle, illustration brief), and a short spineText (usually the title). Only reference anchors from the provided list, by their exact names. Use an empty array if none appear. Revision requests may mention anchors by name (e.g. 'put Amanda on page 3'); use the ANCHORS list for who/what each name is, and update each spread's anchors accordingly. Pace the story well; keep text age-appropriate in length and complexity per page. PRINTABILITY: page 1 is a single right-hand page. A double-page spread occupies a facing pair, so the number of single pages BEFORE any spread must be even (insert a single page if needed). Never let a spread start on a right-hand page. Write a short overall 'notes' field with art-direction guidance.",
      ),
    ],
    user: [
      blk("settings", "BOOK SETTINGS:\n{{configDescription}}"),
      blk("anchors", "\nANCHORS (use exact names):\n{{anchorsList}}"),
      blk("story", "\nSTORY:\n{{story}}"),
      blk(
        "revision",
        "\nCURRENT SCREENPLAY (JSON) to revise:\n{{previousJson}}\n\nREVISION REQUEST: {{edit}}\nReturn the full revised screenplay.",
        "isRevision",
      ),
    ],
  },

  // core/pipeline/localize.ts → locateSubject
  "localize/single": {
    system: [
      blk(
        "role",
        "You are a precise vision system that locates a single subject in an image and returns its bounding box. Coordinates are normalized between 0 and 1 with the origin at the TOP-LEFT corner. Reply with JSON only.",
      ),
    ],
    user: [
      blk(
        "ask",
        'Locate this subject in the image: "{{name}}"{{descriptionSuffix}}. Return {"found": true|false, "x", "y", "width", "height"} where (x, y) is the TOP-LEFT corner of the tightest box around the subject and width/height are its size, all normalized 0..1. If the subject is not clearly visible, return {"found": false}.',
      ),
    ],
  },

  // core/pipeline/localize.ts → locateSubjects
  "localize/multi": {
    system: [
      blk(
        "role",
        "You are a precise vision system that locates DISTINCT subjects in an image and returns one bounding box per subject. Coordinates are normalized between 0 and 1 with the origin at the TOP-LEFT corner. Each subject is a different entity, so return a different region for each. Reply with JSON only.",
      ),
    ],
    user: [
      blk(
        "ask",
        'Locate each of these subjects in the image and return its tightest bounding box:\n{{list}}\n\nReturn {"subjects": [{"id", "found", "x", "y", "width", "height"}, ...]} with one entry per id above, where (x, y) is the TOP-LEFT corner and width/height the size, all normalized 0..1. For any subject not clearly visible, set "found": false.',
      ),
    ],
  },

  // core/pipeline/localize.ts → locateAndCountSubjects (post-render binding + de-dup)
  "bindingPass/multi": {
    system: [
      blk(
        "role",
        "You are a precise vision system. For each listed subject, locate it in the image and return its tightest bounding box. Each subject must appear EXACTLY ONCE; if the SAME subject is mistakenly drawn more than once, return the best occurrence as the main box and every other occurrence of that same subject in an \"extras\" array (these are duplicates to be removed). Coordinates are normalized 0..1 with the origin at the TOP-LEFT. Reply with JSON only.",
      ),
    ],
    user: [
      blk(
        "ask",
        'Bind each of these subjects to its region in the image:\n{{list}}\n\nReturn {"subjects": [{"id", "found", "x", "y", "width", "height", "extras": [{"x","y","width","height"}, ...]}, ...]} with one entry per id. (x, y) is the TOP-LEFT corner and width/height the size, all normalized 0..1. "extras" holds any ADDITIONAL occurrences of that same subject (empty or omitted when it appears once). Set "found": false for a subject not clearly visible.',
      ),
    ],
  },

  // core/pipeline/localize.ts → locateEmbeddedObsolete (scene illustration)
  "bindingPass/embeddedScene": {
    system: [
      blk(
        "role",
        "You are a precise vision system for children's-book illustrations. A parent place/object contains embedded child objects that must appear with their SPECIFIC anchored design — not a generic default version. For each embedded child, locate its correct anchored instance (primary) and any obsolete generic duplicates of the same object category that should be removed (obsolete). Coordinates normalized 0..1, origin TOP-LEFT. JSON only.",
      ),
    ],
    user: [
      blk(
        "ask",
        'Parent "{{parentName}}"{{parentDescription}} contains these embedded subjects:\n{{childList}}\n\nFor each child id, return {"embedded": [{"id", "found", "primaryX", "primaryY", "primaryWidth", "primaryHeight", "obsolete": [{"x","y","width","height"}, ...]}, ...]}. "primary" is the region matching the anchored design (keep). "obsolete" lists generic/default duplicates of the same object type to erase (empty when none). Set "found": false when the anchored child is not visible.',
      ),
    ],
  },

  // core/pipeline/localize.ts → locateEmbeddedObsolete (multi-angle reference sheet)
  "bindingPass/embeddedSheet": {
    system: [
      blk(
        "role",
        "You are a precise vision system for multi-angle reference sheets. A parent place/object reference contains embedded child objects that must match their anchored design. Legitimate repetitions of a child ACROSS separate angle panels are correct — only flag obsolete generic duplicates WITHIN the same panel/view where both a generic and the anchored version appear. Coordinates normalized 0..1, origin TOP-LEFT. JSON only.",
      ),
    ],
    user: [
      blk(
        "ask",
        'Reference sheet for "{{parentName}}"{{parentDescription}} embeds:\n{{childList}}\n\nReturn {"embedded": [{"id", "found", "primaryX", "primaryY", "primaryWidth", "primaryHeight", "obsolete": [{"x","y","width","height"}, ...]}, ...]}. Per child: "primary" = anchored design region to keep; "obsolete" = generic duplicates to remove within the same panel (NOT cross-panel angle repeats). Set "found": false when not visible.',
      ),
    ],
  },

  // core/pipeline/intentResolve.ts → resolveEditIntent
  "editIntent/resolve": {
    system: [
      blk(
        "role",
        'You classify illustration edit requests into structured operations over a CLOSED set of anchor ids. Pick targets and sources ONLY from the provided lists — never invent ids. Match names semantically: nicknames, pronouns, roles ("mama", "the boy") and MISSPELLINGS (e.g. "athrur" clearly means Arthur) all resolve to the closest candidate. Output JSON only. Operation meanings: "remove" deletes a subject; "replace" swaps one subject for another anchor; "refresh" redraws a subject to match its current reference design; "modify" changes an attribute of ONE subject (hair color, clothing, held item, pose...) — set its "instruction" to the change restated with the anchor\'s CANONICAL name (e.g. "make Arthur\'s hair blue"). Use "freeform" only for scene-level tweaks (lighting, mood, background, weather) that target no listed subject. Set ambiguous:true ONLY when a reference could equally mean two or more candidates and no disambiguation hint was given — a misspelling with one clear match is NOT ambiguous.',
      ),
    ],
    user: [
      blk(
        "ask",
        'Subjects currently depicted (candidates for remove/replace/refresh/modify targets):\n{{candidates}}\n\nAll anchors in the book (valid source ids for replace):\n{{anchors}}\n\nUser edit: "{{edit}}"{{disambiguation}}\n\nReturn {"ops": [{"op": "remove"|"replace"|"refresh"|"modify"|"freeform", "targetAnchorId", "sourceAnchorId", "instruction", "confidence": 0..1}, ...], "ambiguous": boolean, "ambiguousReason": string}. One op per distinct action. replace requires both targetAnchorId and sourceAnchorId; modify requires targetAnchorId and instruction.',
      ),
    ],
  },

  // core/pipeline/intentResolve.ts → resolveMentionedAnchors
  "editIntent/mentions": {
    system: [
      blk(
        "role",
        'You detect which of a CLOSED list of story subjects (anchors) an instruction refers to. Match semantically: names, nicknames, pronouns, family roles ("her brother") and misspellings (e.g. "amnda" means Amanda) all count. Only include an anchor when the instruction clearly refers to it — never guess, never invent ids. Output JSON only.',
      ),
    ],
    user: [
      blk(
        "ask",
        'Available subjects:\n{{anchors}}\n\nInstruction: "{{text}}"\n\nReturn {"mentionedAnchorIds": ["id", ...]} listing every subject the instruction refers to (empty array when none).',
      ),
    ],
  },

  // core/pipeline/anchors.ts → buildAnchorPrompt (from-scratch / iterate)
  "anchorImage/default": {
    single: [
      blk(
        "angleCharacter",
        'full-body character reference sheet showing the same character from multiple angles (front, three-quarter, side, and back), consistent proportions and design of "{{anchorName}}".',
        "isCharacter",
      ),
      blk(
        "anglePlace",
        'environment reference sheet showing the SAME location from a few key viewpoints (wide establishing view and one or two closer angles). Every viewpoint must show the IDENTICAL space — identical architecture, furniture, wall décor, props, layout and color palette. Only the camera angle changes between views; never add, remove, move or alter any element from one view to another of "{{anchorName}}".',
        "isPlace",
      ),
      blk(
        "angleObject",
        'object reference sheet showing the SAME item from multiple angles (front, side, three-quarter). Keep identical shape, proportions, materials, markings and colors across every angle; only the viewpoint changes of "{{anchorName}}".',
        "isObject",
      ),
      blk("description", "{{description}}"),
      blk("userGuidance", "{{userGuidance}}", "hasUserGuidance"),
      blk(
        "contained",
        "This {{anchorType}} contains the following, which must look EXACTLY like their reference images (same shape, materials, colors and details): {{containedList}}.",
        "hasContained",
      ),
      blk(
        "related",
        "Related subjects for resemblance/context only — match the described relationships (e.g. family traits) but do NOT draw them as separate figures in this sheet: {{relatedList}}.",
        "hasRelated",
      ),
      blk(
        "mentioned",
        "The revision refers to these other story subjects (context only — use their descriptions to interpret the request, but do NOT draw them in this sheet): {{mentionedList}}.",
        "hasMentioned",
      ),
      blk(
        "legend",
        "The reference images are provided in this exact order: {{legend}}. Use each reference image ONLY for its stated purpose; every contained subject must be drawn matching its own reference image exactly.",
        "hasLegend",
      ),
      blk(
        "styleRef",
        "The FIRST reference image is an ART-STYLE reference: match ONLY its visual style — medium, rendering technique, linework, shading, color palette, texture and finish. Do NOT copy its subjects or layout.",
        "hasStyleRef",
      ),
      blk("style", "Art style: {{artStyle}}."),
      blk(
        "background",
        "Plain pure-white seamless background, even soft studio lighting, no text, no labels, no watermark, clearly separated angles.",
      ),
      blk("revision", "Revision: {{edit}}.", "hasEdit"),
    ],
  },

  // core/pipeline/anchors.ts → buildAnchorPrompt (minimal edit of the sheet)
  "anchorImage/editFromImage": {
    single: [
      blk("intro", 'Edit the provided reference sheet image of "{{anchorName}}".'),
      blk("change", "Apply ONLY this change: {{edit}}."),
      blk(
        "mentioned",
        "The change refers to these other story subjects (context only — use their descriptions to interpret the request, but do NOT draw them into this sheet): {{mentionedList}}.",
        "hasMentioned",
      ),
      blk(
        "keep",
        "Keep everything else exactly the same: {{identity}}, the multi-angle layout, framing, lighting and the plain white background. Do not add, remove, restyle or redesign anything the change does not explicitly require.",
      ),
      blk("noText", "No text, labels or watermark."),
    ],
  },

  // core/pipeline/illustration.ts → buildIllustrationPrompt
  "pageIllustration/default": {
    single: [
      blk(
        "kindSpread",
        "Full double-page spread illustration: ONE single continuous wide scene that spans both facing pages. Do NOT split it into two panels, do NOT mirror, tile, or duplicate the scene, and do NOT place a divider or seam down the center. Each character and object appears exactly once.",
        "isSpread",
      ),
      blk("kindSingle", "Single-page illustration.", "!isSpread"),
      blk("brief", "{{illustrationBrief}}"),
      blk(
        "styleRef",
        "The FIRST reference image is an ART-STYLE reference: match ONLY its visual style — medium, rendering technique, linework, shading, color palette, texture and finish. Do NOT copy its subjects, characters, objects, composition or layout.",
        "hasStyleRef",
      ),
      blk(
        "bleedSpread",
        "Compose it as a full-bleed image that fills the whole canvas to all four edges, with no borders, frames, or white margins. Keep faces and key details clear of the outer edges (which get trimmed) and clear of the vertical center, where the two pages meet at the binding.",
        "isSpread",
      ),
      blk(
        "bleedSingle",
        "Compose it as a full-bleed image that fills the whole canvas to all four edges, with no borders, frames, or white margins. Keep faces and key details within the central safe area, clear of the outer edges, which get trimmed.",
        "!isSpread",
      ),
      blk(
        "characters",
        "Keep these characters looking exactly like their provided reference images — {{charactersList}}. Match each one's face, hair, colors, outfit and overall design to its own reference image; only their pose, expression and camera angle may change to fit the scene.",
        "hasCharacters",
      ),
      blk(
        "settings",
        "These places/objects must match their reference images EXACTLY — {{settingsList}}. Keep the same architecture, layout, furniture, props, materials and colors; only the camera angle or viewpoint may change. Do not redesign, rearrange, add or remove their elements unless this page's description explicitly says the setting changed.",
        "hasSettings",
      ),
      blk("described", "Also feature these subjects: {{describedList}}.", "hasDescribed"),
      blk(
        "embedded",
        "Containment: {{embeddedList}}. Draw each contained subject exactly ONCE, placed inside/at its parent and matching the contained subject's OWN reference image — never also draw a generic default version of that object.",
        "hasEmbedded",
      ),
      blk(
        "legend",
        "The reference images are provided in this exact order: {{legend}}. Use each reference image ONLY for its matching item above, and update every one of the named subjects to match its own reference.",
        "hasReferenced",
      ),
      blk(
        "cast",
        "The only named subjects that may appear are: {{castNames}}. Do NOT invent or add any other named characters or people. Each named subject must appear EXACTLY ONCE — never draw two copies of the same character. If the requested change involves a subject already in the scene, reposition or adjust that same existing subject instead of adding another.",
        "hasCast",
      ),
      blk(
        "removed",
        "Remove these subjects entirely — they must NOT appear in the image: {{removedList}}.",
        "hasRemoved",
      ),
      blk(
        "kept",
        "These subjects are already correct in the LAST reference image (the previous version of this page) — keep each one EXACTLY as it appears there: same design, pose, position, scale and colors. Do not redraw, restyle, move or duplicate them: {{keptList}}.",
        "hasKept",
      ),
      blk("noText", "Do NOT render any text, letters, captions, words, or numbers in the image."),
      blk(
        "layoutNote",
        "Leave clean, uncluttered negative space for a separate text block: {{layoutNote}}.",
        "hasLayoutNote",
      ),
      blk(
        "layoutGeneric",
        "Leave some clean negative space where a text block can be placed.",
        "!hasLayoutNote",
      ),
      blk("style", "Art style: {{artStyle}}."),
      blk("closing", "Children's picture-book illustration, cohesive composition, no watermark."),
      blk(
        "tailMaskEdit",
        "Inpainting edit: only modify the transparent (masked) region of the LAST reference image — apply this change there: {{edit}}. Keep every pixel outside the mask exactly identical (same characters, colors, lighting, and composition).",
        "tailMaskEdit",
      ),
      blk(
        "tailCompositionEdit",
        "The LAST image is the CURRENT version of this page. Reproduce it faithfully — keep the exact composition, layout, poses, positions, scale, framing, background, lighting and colors. Apply this change: {{edit}}.{{refreshClause}}{{addedClause}} For any named subject that has its own reference image above, match that subject's appearance to its reference while keeping its position and pose. Do not move, add, or remove anything else.",
        "tailCompositionEdit",
      ),
      blk(
        "tailCompositionRefresh",
        "The LAST image is the PREVIOUS version of this page. Reproduce it faithfully — keep the exact composition, poses, positions, framing, background and colors. Update each named subject's appearance to match its own labeled reference image above (e.g. an updated character design).{{changedClause}}{{addedClause}} Do NOT copy outdated character or color details from the last image, and apart from these changes do not re-pose, move, add, or remove anything else.",
        "tailCompositionRefresh",
      ),
      blk("tailPlainEdit", "Revision: {{edit}}.", "tailPlainEdit"),
    ],
  },

  // core/pipeline/illustration.ts → buildRemoveRegionPrompt (duplicate removal)
  "pageIllustration/removeRegion": {
    single: [
      blk("intro", "You are fixing an existing children's-book illustration that mistakenly drew the same subject twice."),
      blk(
        "task",
        'Remove the DUPLICATE "{{subjectName}}" located in {{region}}. There must be only ONE {{subjectName}} left in the scene (the other occurrence stays).',
      ),
      blk(
        "fill",
        "Fill the vacated area with plausible background that seamlessly matches the surrounding scene — continue the existing setting, colors, lighting and textures. Do NOT introduce any new subject there.",
      ),
      blk(
        "keep",
        "Keep EVERYTHING else pixel-identical: all other characters, the remaining {{subjectName}}, background, lighting, colors, composition and framing.",
      ),
      blk("noText", "Do NOT render any text, letters, captions, words, numbers or watermark."),
      blk("style", "Art style: {{artStyle}}."),
    ],
  },

  // core/pipeline/illustration.ts → buildModifySubjectPrompt (surgical attribute edit)
  "pageIllustration/modifySubject": {
    single: [
      blk("intro", "You are modifying ONE subject in an existing children's-book illustration."),
      blk(
        "images",
        'The FIRST image is the current page. "{{anchorName}}" ({{description}}) is the subject inside {{region}}.',
      ),
      blk(
        "sheetRef",
        'The SECOND image is the reference sheet of "{{anchorName}}" — use it to keep the subject\'s identity and design consistent while applying the change.',
        "hasSheetRef",
      ),
      blk("change", "Apply ONLY this change to {{anchorName}}: {{instruction}}."),
      blk(
        "keep",
        "Keep everything else about {{anchorName}} identical — same identity, pose, position, scale and camera angle — and keep EVERYTHING outside {{region}} pixel-identical: background, other characters, lighting, colors, composition and framing.",
      ),
      blk("noText", "Do NOT render any text, letters, captions, words, numbers or watermark."),
      blk("style", "Art style: {{artStyle}}."),
    ],
  },

  // core/pipeline/illustration.ts → buildAnchorSwapPrompt
  "pageIllustration/anchorSwap": {
    single: [
      blk("intro", "You are updating ONE subject in an existing children's-book illustration."),
      blk(
        "images",
        'The FIRST image is the current page. The SECOND image is the NEW reference for "{{anchorName}}" ({{description}}).',
      ),
      blk(
        "redraw",
        "Redraw {{anchorName}} inside {{region}} so it matches the NEW reference exactly — {{identity}}. Keep its existing position, pose, scale and camera angle from the current page; only its appearance changes.",
      ),
      blk(
        "keep",
        "Keep EVERYTHING else pixel-identical: the background, any other characters, lighting, colors, composition and framing. Do not move, add, remove, recolor or restyle anything else.",
      ),
      blk("noText", "Do NOT render any text, letters, captions, words, numbers or watermark."),
      blk("style", "Art style: {{artStyle}}."),
    ],
  },
};

/** Shared, reusable sub-prompts referenced via `{{> id}}`. (None ship by default;
 *  the art-style/age overlays are supplied as computed variables so their own
 *  admin configs stay the single source of truth.) */
export const DEFAULT_PARTIALS: Record<string, string> = {};

export const PROMPT_TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES);

export function defaultTemplate(key: string): PromptTemplate {
  return DEFAULT_TEMPLATES[key] ?? {};
}

export function createDefaultPromptsConfig(): PromptsConfig {
  return {
    version: 1,
    templates: JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)) as Record<string, PromptTemplate>,
    partials: { ...DEFAULT_PARTIALS },
  };
}

// ---- Admin-UI metadata -----------------------------------------------------

export interface PromptVariableMeta {
  name: string;
  description: string;
  /** Sample value used to render the live preview. */
  sample: string;
}

export interface PromptTemplateMeta {
  key: string;
  label: string;
  description: string;
  variables: PromptVariableMeta[];
  /** Flag values for the live preview (predicate-gated blocks). */
  sampleFlags: Record<string, boolean>;
}

export interface PromptActionMeta {
  actionId: string;
  label: string;
  description: string;
  kind: "text" | "image";
  templates: PromptTemplateMeta[];
}

const V = (name: string, description: string, sample: string): PromptVariableMeta => ({
  name,
  description,
  sample,
});

const AGE_SAMPLE = "Keep sentences short and the vocabulary simple.";
const STYLE_SAMPLE = "soft watercolor children's book illustration";

export const PROMPT_ACTIONS: PromptActionMeta[] = [
  {
    actionId: "storyAnalysis",
    label: "Story analysis",
    description: "Extracts the characters, places and objects that must stay consistent.",
    kind: "text",
    templates: [
      {
        key: "storyAnalysis",
        label: "Analysis",
        description: "System + user prompt for extracting anchors from the story.",
        variables: [
          V("age", "Target age-range label.", "6–8"),
          V("ageGuidance", "Age-band writing guidance overlay.", AGE_SAMPLE),
          V("story", "The author's story text.", "Once upon a time…"),
        ],
        sampleFlags: {},
      },
    ],
  },
  {
    actionId: "anchorDescription",
    label: "Anchor description",
    description: "Suggests a single character/place/object's visual description.",
    kind: "text",
    templates: [
      {
        key: "anchorDescription",
        label: "Description",
        description: "Suggest one anchor's visual description from the story.",
        variables: [
          V("type", "Anchor type (character/place/object).", "character"),
          V("name", "Anchor name.", "Amanda"),
          V("age", "Target age-range label.", "6–8"),
          V("ageGuidance", "Age-band writing guidance overlay.", AGE_SAMPLE),
          V("others", "The other known subjects, one per line.", "- Bruno [character]: a small dog"),
          V("story", "The author's story text.", "Once upon a time…"),
        ],
        sampleFlags: {},
      },
    ],
  },
  {
    actionId: "screenplay",
    label: "Screenplay",
    description: "Turns the story into a page-by-page plan with covers.",
    kind: "text",
    templates: [
      {
        key: "screenplay",
        label: "Screenplay",
        description: "Page-by-page plan + covers. The revision block appears only when refining.",
        variables: [
          V("spreadGuidance", "Chosen spread-usage instruction.", "Mix single pages and double-page spreads for good pacing."),
          V("textGuidance", "Chosen text-handling instruction.", "You may adapt and tighten the wording to suit the age range and reading rhythm."),
          V("ageGuidance", "Age-band writing guidance overlay.", AGE_SAMPLE),
          V("placementGuidance", "Text-placement instruction.", "Text is ALWAYS laid out separately from the art as an editable overlay."),
          V("configDescription", "Book-settings summary.", "Age range: 6–8.\nBook size: Square."),
          V("anchorsList", "Included anchors, one per line.", "- Amanda [character]: a curious girl"),
          V("story", "The author's story text.", "Once upon a time…"),
          V("previousJson", "Prior screenplay JSON (revisions only).", "{ …previous screenplay… }"),
          V("edit", "The revision request (revisions only).", "Put Amanda on page 3."),
        ],
        sampleFlags: { isRevision: false },
      },
    ],
  },
  {
    actionId: "localize",
    label: "Subject localization (vision)",
    description: "Finds where a subject sits inside a rendered page (used for in-place edits).",
    kind: "text",
    templates: [
      {
        key: "localize/single",
        label: "Single subject",
        description: "Locate one subject and return its bounding box.",
        variables: [
          V("name", "Subject name.", "Amanda"),
          V("descriptionSuffix", "Optional ' — description' suffix.", " — a curious girl"),
        ],
        sampleFlags: {},
      },
      {
        key: "localize/multi",
        label: "Multiple subjects",
        description: "Locate several subjects in one call.",
        variables: [V("list", "Subjects to locate, one per line.", '- id "a1": "Amanda"')],
        sampleFlags: {},
      },
    ],
  },
  {
    actionId: "bindingPass",
    label: "Anchor binding + de-dup (vision)",
    description: "After a page renders, binds each anchor to its region and flags duplicate occurrences to remove.",
    kind: "text",
    templates: [
      {
        key: "bindingPass/multi",
        label: "Bind & count subjects",
        description: "Locate each subject and report any duplicate occurrences in one call.",
        variables: [V("list", "Subjects to bind, one per line.", '- id "a1": "Amanda"')],
        sampleFlags: {},
      },
      {
        key: "bindingPass/embeddedScene",
        label: "Embedded conflict (scene)",
        description: "Find anchored vs generic duplicates when a child anchor is embedded in a parent on a page.",
        variables: [
          V("parentName", "Parent anchor name.", "Hospital room"),
          V("parentDescription", "Optional parent description suffix.", " — a bright ward"),
          V("childList", "Embedded children, one per line.", '- id "b1": "Hospital bed"'),
        ],
        sampleFlags: {},
      },
      {
        key: "bindingPass/embeddedSheet",
        label: "Embedded conflict (reference sheet)",
        description: "Same as scene variant but respects multi-angle panel layout.",
        variables: [
          V("parentName", "Parent anchor name.", "Hospital room"),
          V("parentDescription", "Optional parent description suffix.", ""),
          V("childList", "Embedded children.", '- id "b1": "Hospital bed"'),
        ],
        sampleFlags: {},
      },
    ],
  },
  {
    actionId: "editIntent",
    label: "Edit intent resolution",
    description: "Classifies a user's free-text page edit into structured remove/replace/refresh operations.",
    kind: "text",
    templates: [
      {
        key: "editIntent/resolve",
        label: "Resolve edit intent",
        description: "Maps natural-language edits to anchor ids and operation types.",
        variables: [
          V("edit", "User's edit instruction.", "Replace Tom with Alex"),
          V("candidates", "Depicted subjects.", '- id "a1": anchor "Tom"'),
          V("anchors", "All anchors.", '- id "a1": "Tom" (character)'),
          V("disambiguation", "Optional disambiguation hint.", ""),
        ],
        sampleFlags: {},
      },
      {
        key: "editIntent/mentions",
        label: "Detect mentioned anchors",
        description:
          "Finds which anchors a free-text instruction refers to (names, pronouns, typos) for cross-referencing context.",
        variables: [
          V("text", "The instruction to scan.", "make him the same age as Amanda"),
          V("anchors", "Candidate anchors.", '- id "a1": "Amanda" (character) — a curious girl'),
        ],
        sampleFlags: {},
      },
    ],
  },
  {
    actionId: "anchorImage",
    label: "Anchor reference images",
    description: "Reference sheets for characters/places/objects.",
    kind: "image",
    templates: [
      {
        key: "anchorImage/default",
        label: "Generate / iterate",
        description: "From-scratch (or variation) reference sheet.",
        variables: [
          V("anchorName", "Anchor name.", "Amanda"),
          V("anchorType", "Anchor type.", "place"),
          V("description", "The anchor's visual description.", "a curious girl with red boots"),
          V("userGuidance", "Optional extra user guidance.", "always wearing a green scarf"),
          V("containedList", "Contained anchors (place/object).", "the bed (a wooden bunk bed)"),
          V("relatedList", "Related anchors (context only).", "her brother Bruno (a small dog)"),
          V("mentionedList", "Anchors the revision text refers to (context only).", "Amanda (a curious girl)"),
          V("legend", "Ordered reference-image legend.", "(1) an art-style reference, (2) Hospital bed (must match this reference exactly)"),
          V("artStyle", "Resolved art-style overlay.", STYLE_SAMPLE),
          V("edit", "Optional revision instruction.", "make her smile"),
        ],
        sampleFlags: {
          isCharacter: true,
          isPlace: false,
          isObject: false,
          hasUserGuidance: false,
          hasContained: false,
          hasRelated: false,
          hasMentioned: false,
          hasStyleRef: false,
          hasEdit: false,
          hasLegend: false,
        },
      },
      {
        key: "anchorImage/editFromImage",
        label: "Edit existing sheet",
        description: "Minimal edit of the current reference sheet (identity preserved).",
        variables: [
          V("anchorName", "Anchor name.", "Amanda"),
          V("edit", "The requested change.", "make her smile"),
          V("mentionedList", "Anchors the change text refers to (context only).", "Amanda (a curious girl)"),
          V("identity", "Identity-preservation clause (by type).", "the same character — identical face, hair, body, colors and outfit"),
        ],
        sampleFlags: { hasMentioned: false },
      },
    ],
  },
  {
    actionId: "pageIllustration",
    label: "Page & cover illustrations",
    description: "The illustration for each page/spread, edits, refreshes and surgical swaps.",
    kind: "image",
    templates: [
      {
        key: "pageIllustration/default",
        label: "Page / edit / refresh",
        description:
          "Whole-page generation plus the mutually-exclusive tail branches (edit, refresh, mask inpaint).",
        variables: [
          V("illustrationBrief", "The page's illustration brief.", "Amanda peeks under the bed."),
          V("charactersList", "Referenced characters with descriptions.", "Amanda (a curious girl)"),
          V("settingsList", "Referenced places/objects.", "the bedroom (a cozy attic room)"),
          V("describedList", "Anchors mentioned by description only.", "Bruno (a small dog)"),
          V("embeddedList", "Containment pairs on this page.", "Hospital bed appears INSIDE Hospital room"),
          V("legend", "Ordered reference-image legend.", "(1) Amanda, (2) the current page of this book"),
          V("castNames", "The closed cast of allowed names.", "Amanda, Bruno"),
          V("removedList", "Subjects to remove.", "the cat"),
          V("keptList", "Unchanged subjects locked to the previous version (no sheet re-sent).", "Bruno"),
          V("layoutNote", "Where the text block should sit.", "bottom band"),
          V("artStyle", "Resolved art-style overlay.", STYLE_SAMPLE),
          V("edit", "Revision instruction.", "make it night-time"),
          V("refreshClause", "Appended when subjects also need refreshing.", ""),
          V("changedClause", "Appended when subjects changed (no-edit refresh).", ""),
          V("addedClause", "Appended when subjects were newly added to the page.", ""),
        ],
        sampleFlags: {
          isSpread: false,
          hasStyleRef: false,
          hasCharacters: true,
          hasSettings: false,
          hasDescribed: false,
          hasEmbedded: false,
          hasReferenced: true,
          hasCast: true,
          hasRemoved: false,
          hasKept: false,
          hasLayoutNote: true,
          tailMaskEdit: false,
          tailCompositionEdit: false,
          tailCompositionRefresh: false,
          tailPlainEdit: false,
        },
      },
      {
        key: "pageIllustration/modifySubject",
        label: "Surgical subject modify",
        description: "Change one attribute of a subject in place, keeping the rest pixel-identical.",
        variables: [
          V("anchorName", "Subject name.", "Arthur"),
          V("description", "Subject description.", "a small boy with brown hair"),
          V("region", "The region to redraw.", "the transparent (masked) region"),
          V("instruction", "The attribute change.", "make Arthur's hair blue"),
          V("artStyle", "Resolved art-style overlay.", STYLE_SAMPLE),
        ],
        sampleFlags: { hasSheetRef: true },
      },
      {
        key: "pageIllustration/anchorSwap",
        label: "Surgical subject swap",
        description: "Replace one subject in place, keeping the rest pixel-identical.",
        variables: [
          V("anchorName", "Subject name.", "Amanda"),
          V("description", "Subject description.", "a curious girl"),
          V("region", "The region to redraw.", "only the area currently showing this subject"),
          V("identity", "Identity clause (by type).", "face, hair, skin, colors, outfit and overall design"),
          V("artStyle", "Resolved art-style overlay.", STYLE_SAMPLE),
        ],
        sampleFlags: {},
      },
      {
        key: "pageIllustration/removeRegion",
        label: "Remove duplicate",
        description: "Erase a duplicate subject occurrence in place and fill the background.",
        variables: [
          V("subjectName", "Duplicated subject name.", "Amanda"),
          V("region", "The region holding the duplicate.", "the transparent (masked) region"),
          V("artStyle", "Resolved art-style overlay.", STYLE_SAMPLE),
        ],
        sampleFlags: {},
      },
    ],
  },
];
