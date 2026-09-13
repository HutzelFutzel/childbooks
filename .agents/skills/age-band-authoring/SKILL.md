---
name: age-band-authoring
description: Authors, calibrates, validates, and audits children's-book Audience Profiles and per-band Story Craft configuration. Use when creating or changing age bands, reading modes, editorial guidance, reading-level rubrics, page pacing, protagonist ages, safety rules, inheritance, aliases, creative-choice catalogs, AudienceConfig JSON, or StoryCraftConfig JSON.
---

# Age Band Authoring

Use this skill for any task that creates, edits, reviews, or explains the project's audience profiles.

## Required reference

Before producing a profile or recommendation, read
[the complete framework](../../../docs/AGE_BAND_FRAMEWORK.md). It is the self-contained document
intended for direct use with other LLMs.

If the framework and implementation differ, inspect and follow:

- `books-frontend/src/core/config/audienceCatalog.ts`
- `books-frontend/src/core/config/audience.ts`
- `books-frontend/src/core/prompts/audience.ts`
- `books-frontend/src/core/pipeline/storyValidate.ts`
- `books-frontend/src/core/pipeline/screenplayFit.ts`

Report and correct documentation drift when found.

## Determine the requested artifact

Distinguish these before working:

1. **Full profile** — a resolved `AudienceProfile` with every field, section, and dimension.
2. **Sparse override** — an `AudienceProfileOverride` for an existing shipped profile.
3. **Persisted config** — `{ "version": 1, "profiles": [...] }`.
4. **Story Craft config** — per-band theme, device, and setting catalogs.
5. **Combined config** — separate Audience and Story Craft documents in one review envelope.
6. **Audit** — findings and corrected recommendations without changing configuration.

Do not claim to save or apply a profile unless it was actually persisted.

## Workflow

1. Establish target ages in inclusive months, product format, reading context, language/locale,
   illustration role, accessibility requirements, and neighbouring enabled bands.
2. Choose stable identity, sort order, enabled state, aliases, and any parent. Check overlap
   precedence and hidden/deleted lifecycle compatibility.
3. Set whole-story structure and page density together. Verify the implied page interval overlaps
   the configured page interval.
4. Configure protagonist and age-specific safety. Preserve the mandatory global safety floor.
5. Configure all 14 legal dimensions with valid zero-based levels and observable guidance.
6. Write each needed guardrail section as concise, positive, testable direction for its fixed
   compiler channels.
7. Configure every offered reading mode; remember that the first mode is the UI default.
8. Resolve inheritance and ordinary overrides using their different merge semantics.
9. When Story Craft is in scope, configure its exact-ID theme, device, and setting lists; never
   give a custom band another band's catalog through implicit fallback.
10. Check every cross-field relationship and preview all compiled outputs.
11. Return exactly the requested artifact and include assumptions/evidence gaps unless strict JSON
    only was requested.

## Non-negotiable correctness rules

- Treat developmental guidance as an editorial baseline, not a diagnosis or universal fact.
- Do not invent section IDs, dimension IDs, reading modes, schema fields, or level labels.
- `extendsId` inherits only missing sections and dimensions.
- A blank inherited section does not suppress its parent's section.
- `evaluatedDimensionIds` filters scored rubric rows, not the compiled evaluation overlay.
- An empty `evaluatedDimensionIds` means score every configured dimension.
- Direct ID resolution does not use month containment; month shortcut lookup is separate.
- Disabled profiles remain resolvable for existing books.
- Deleted profiles leave current/admin lists but retain a frozen exact-ID compatibility snapshot;
  never recycle a tombstoned ID.
- At least one current profile must remain.
- Audience `extendsId` does not inherit Story Craft; copying choices is an intentional snapshot.
- Story Craft owns choices only. Structure, protagonist, safety, and art style belong elsewhere.
- Unknown Story Craft option IDs must be removed against the active band's resolved catalog.
- Use strict JSON without comments, fences, or trailing commas when strict JSON is requested.
- Never describe this application's word/page defaults as universal publishing standards.

## Quality gate

Do not finish until:

- the output shape matches the request;
- all schema limits and exact IDs pass;
- enabled month ranges and ordering are intentional;
- modes have guidance and a clear default;
- dimensions, prose sections, structure, density, protagonist, and safety agree;
- inheritance resolves to the intended complete profile;
- story, screenplay, illustration, character-art, evaluation, density, safety, and protagonist
  outputs receive only the intended content;
- every in-scope Story Craft catalog uses the exact band ID, stable unique option IDs, valid
  selection counts, and guidance coherent with the resolved Audience Profile;
- assumptions and unsupported evidence are clearly identified.
