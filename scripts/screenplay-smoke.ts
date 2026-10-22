/* eslint-disable no-console */
/**
 * Live smoke run for the page plan. NOT part of CI: it calls the real model and
 * costs a few cents per story.
 *
 *   yarn smoke:screenplay                   all stories, with the review
 *   yarn smoke:screenplay --case verse-de   one story (by name)
 *   yarn smoke:screenplay --case identity   only the translation check: does the lamp stay the lamp
 *                                           (read, translate, read again) and the cast stay one cast
 *   yarn smoke:screenplay --no-review       skip the second reading
 *   yarn smoke:screenplay --dry             print the prompts, call nothing
 *   yarn smoke:screenplay --model gpt-6-luna
 *
 * The key is read from OPENAI_API_KEY, or from functions/.env.local.
 *
 * What it answers, which the stubbed invariants cannot: does the real model
 * accept the schema, keep the author's words, stay inside the cast, answer the
 * review in time, and write pictures a person would want to look at. It prints
 * what the plan looks like and exits non-zero when a plan loses the words, cuts
 * a stanza, or fails to come back.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setProviderHttp } from "../books-frontend/src/core/providers/httpContext";
import { openaiTextProvider } from "../books-frontend/src/core/providers/openai";
import { generateScreenplay, pagePlanInput } from "../books-frontend/src/core/pipeline/screenplay";
import { analyzeStory } from "../books-frontend/src/core/pipeline/analysis";
import { translateStory } from "../books-frontend/src/core/pipeline/storyTranslate";
import { withTranslatedStory } from "../books-frontend/src/core/guide/storyLanguage";
import { reconcileAnchorIds } from "../books-frontend/src/core/book/anchorRefs";
import { inspectScreenplay, wordlessAllowance } from "../books-frontend/src/core/pipeline/screenplayCheck";
import { buildIllustrationPrompt } from "../books-frontend/src/core/pipeline/illustration";
import { resolveAudienceProfile } from "../books-frontend/src/core/config/audience";
import { getBookLanguage } from "../books-frontend/src/core/config/bookLanguages";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { createDefaultConfig, type Anchor, type BookConfig, type Project, type ScreenplayDoc } from "../books-frontend/src/core/types";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const DRY = flag("dry");
const REVIEW = !flag("no-review");
const MODEL = option("model") ?? process.env.SMOKE_MODEL ?? "gpt-6-sol";
const ONLY = option("case");

function apiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const file = readFileSync(join(here, "..", "functions", ".env.local"), "utf8");
    const line = file.split("\n").find((l) => l.startsWith("OPENAI_API_KEY="));
    const value = line?.slice("OPENAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  } catch {
    /* no file */
  }
  throw new Error("Set OPENAI_API_KEY, or put it in functions/.env.local.");
}

setProviderHttp({
  baseUrl: () => "https://api.openai.com",
  fetch: (url, init) => fetch(url, init),
});

function anchor(name: string, type: Anchor["type"], description: string): Anchor {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    type,
    description,
    importance: "high",
    mode: "creative",
    include: true,
    ...(type === "character" ? { ageYears: 30 } : {}),
  };
}

interface Story {
  name: string;
  about: string;
  config: Partial<BookConfig>;
  anchors: Anchor[];
}

const MIA = anchor("Mia", "character", "A four-year-old girl with dark curls, a yellow raincoat and red boots.");
const MOM = anchor("Mia's Mom", "character", "A tall woman with a green scarf and a warm smile.");
const TEDDY = anchor("Teddy", "object", "A small brown teddy bear with one button eye.");
const GARDEN = anchor("The garden", "place", "A small back garden with an apple tree and a wooden gate.");

const PROSE = [
  "Mia woke up early. The house was quiet, and a pale light came through the curtains.",
  "She pressed her nose to the window. The whole garden was white with frost, every leaf and every blade of grass.",
  "\"Teddy,\" she whispered, \"come and look!\" Teddy did not answer, but Mia knew he was looking too.",
  "Mia's Mom came in with two warm mugs. \"Cocoa,\" she said, \"before the sun melts it all.\"",
  "They put on their boots and tiptoed outside. The grass crunched like biscuits under their feet.",
  "Mia drew a big, round smile in the frost on the gate. Then she drew another for Teddy.",
  "By the time the sun came over the apple tree, the smiles had begun to shine and then to melt, one drop at a time.",
  "\"Will they come back?\" asked Mia. \"Tomorrow,\" said her Mom, \"if it's cold enough.\"",
  "That night Mia pulled the curtain back one more time, and asked the moon to make it cold.",
].join("\n\n");

const VERSE_DE = [
  "Der Mond schien hell,\nder Wind ging schnell,\ndie Nacht war still und weit.",
  "Die Katze lief fort,\nan einen stillen Ort,\nzur Zeit der Dunkelheit.",
  "Sie sah einen Stern,\nganz nah und doch fern,\ner blinkte ihr zu: Komm mit!",
  "Da kam der Morgen, rosa und weit, und alle Tiere waren bereit für den neuen Tag.",
  "Der Hase hüpft,\nder Igel schlüpft,\nder Spatz singt laut: Hallo!",
  "Und die Katze, zu Hause,\nmachte eine Pause\nund schlief im Körbchen froh.",
].join("\n\n");

const OLDER = [
  "On the last day of the summer holidays, Jonas found a key in the pocket of an old coat.",
  "It was small and heavy and the colour of tea. Nobody at home knew what it opened.",
  "He asked his grandfather, who looked at it for a long time and said only, \"Try the lighthouse.\"",
  "The lighthouse stood at the end of the pier, and the door was painted the same green as the sea in winter.",
  "The key turned. Inside, a spiral of stairs led up into the dark, and Jonas climbed until his legs ached.",
  "At the top there was no lamp at all, only a round room full of paper boats, each with a name on its sail.",
  "One of them said JONAS. Under it, in his grandfather's neat writing: \"For the day you were brave enough to climb.\"",
  "Jonas carried the boat down the stairs and set it on the water. It floated away towards the evening, and he watched it until it was a speck.",
].join("\n\n");

const STORIES: Story[] = [
  {
    name: "prose-3-5",
    about: "Plain prose, three named subjects, a page target. The words must come back exactly.",
    config: {
      ageRangeId: "3-5",
      storyText: PROSE,
      storyBrief: {
        ...createDefaultStoryBrief("guided"),
        cast: [
          { id: "c1", name: "Mia", kind: "child", age: 4 },
          { id: "c2", name: "Mia's Mom", kind: "adult" },
        ] as never,
      },
      pageTarget: { pages: 12, wordsPerPage: 28, case: "natural" },
    },
    anchors: [MIA, MOM, TEDDY, GARDEN],
  },
  {
    name: "verse-de",
    about: "German rhyme. Every stanza must stay whole on one page and keep its line breaks.",
    config: {
      ageRangeId: "3-5",
      contentLocale: "de-DE",
      storyText: VERSE_DE,
      storyBrief: createDefaultStoryBrief("guided"),
      // The chat always plans toward a page count; six stanzas are six pages.
      pageTarget: { pages: 6, wordsPerPage: 19, case: "natural" },
    },
    anchors: [anchor("Die Katze", "character", "A small grey cat with white paws and green eyes.")],
  },
  {
    name: "older-6-8",
    about: "Longer prose for an independent reader. Checks pacing and the cast limit.",
    config: {
      ageRangeId: "6-8",
      storyText: OLDER,
      storyBrief: createDefaultStoryBrief("own"),
      pageTarget: { pages: 12, wordsPerPage: 40, case: "natural" },
    },
    anchors: [
      anchor("Jonas", "character", "A ten-year-old boy with short sandy hair, a blue sweatshirt and scuffed trainers."),
      anchor("Grandfather", "character", "An old man with a white beard, a flat cap and a grey cardigan."),
      anchor("The lighthouse", "place", "A tall white lighthouse with a green door at the end of a wooden pier."),
    ],
  },
];

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

async function runStory(story: Story): Promise<boolean> {
  console.log(`\n══ ${story.name} — ${story.about}`);
  const config: BookConfig = {
    ...createDefaultConfig("en-US"),
    textModel: { provider: "openai", id: MODEL },
    ...story.config,
  };

  const provider = openaiTextProvider as unknown as {
    generateStructured: (creds: unknown, req: { schemaName?: string; messages: { content: string }[] }) => Promise<unknown>;
  };
  const original = provider.generateStructured;
  const calls: { name: string; ms: number; failed?: boolean }[] = [];
  provider.generateStructured = async (creds, req) => {
    const name = req.schemaName ?? "call";
    const startedAt = Date.now();
    if (DRY) {
      // The retry wrapper asks again; one printout is enough.
      if (calls.length > 0) throw new Error("dry run: nothing was sent");
      calls.push({ name, ms: 0 });
      console.log(`\n── ${name}: system (${req.messages[0]!.content.length} chars)\n${req.messages[0]!.content}\n\n── ${name}: user (${req.messages[1]!.content.length} chars)\n${req.messages[1]!.content}`);
      throw new Error("dry run: nothing was sent");
    }
    let failed = false;
    try {
      return await original.call(provider, creds, req);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      calls.push({ name, ms: Date.now() - startedAt, ...(failed ? { failed } : {}) });
    }
  };

  const startedAt = Date.now();
  let doc: ScreenplayDoc;
  try {
    doc = await generateScreenplay({
      config,
      anchors: story.anchors,
      creds: { apiKey: DRY ? "dry" : apiKey() },
      model: MODEL,
      review: REVIEW,
    });
  } catch (error) {
    if (DRY) return true;
    console.log(`FAILED after ${secs(Date.now() - startedAt)}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    provider.generateStructured = original;
  }

  const total = Date.now() - startedAt;
  const { story: planStory, exact } = pagePlanInput(config);
  const profile = resolveAudienceProfile(config.ageRangeId);
  const language = getBookLanguage(config.contentLocale);
  const check = inspectScreenplay({
    doc,
    anchors: story.anchors,
    story: planStory,
    exact,
    checkText: true,
    profile,
    wordFactor: language.wordCountFactor,
    names: [],
    wordlessAllowed: wordlessAllowance(doc.spreads.length, { exact, independent: config.readingModeId === "independent" }),
  });

  const words = doc.spreads.map((s) => s.text.split(/\s+/).filter(Boolean).length);
  console.log(
    `${doc.spreads.length} pages, ${Math.min(...words)}–${Math.max(...words)} words a page, ${doc.spreads.filter((s) => s.kind === "spread").length} spreads, ${doc.spreads.filter((s) => s.wordless).length} wordless`,
  );
  console.log(`calls: ${calls.map((c) => `${c.name}${c.failed ? " (failed)" : ""} ${secs(c.ms)}`).join(", ")} — ${secs(total)} in all (the task allows 240s)`);
  console.log(`art direction: ${doc.notes}`);
  console.log(check.problems.length === 0 ? "problems left: none" : `problems left:\n${check.problems.map((p) => `  - [${p.code}] ${p.message}`).join("\n")}`);

  const byId = new Map(story.anchors.map((a) => [a.id, a]));
  doc.spreads.slice(0, 3).forEach((s, i) => {
    console.log(`\n  page ${i + 1} (${s.kind}) — ${s.anchorIds.map((id) => byId.get(id)?.name).join(", ") || "nobody"}`);
    console.log(`    words:    ${s.text.replace(/\n/g, " / ")}`);
    console.log(`    picture:  ${s.illustration}`);
    console.log(`    setting:  ${s.continuity ?? ""}${s.wardrobe?.length ? `  [outfits: ${s.wardrobe.map((w) => `${byId.get(w.anchorId)?.name} ${w.outfit}`).join("; ")}]` : ""}`);
  });

  const page = doc.spreads[1] ?? doc.spreads[0]!;
  console.log("\n  what the illustrator is told for page 2:");
  console.log(
    buildIllustrationPrompt({
      spread: page,
      config,
      referencedAnchors: page.anchorIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
      artDirection: doc.notes,
    })
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
  );

  // The plan is a failure when the words are not the author's or a stanza was cut.
  return !check.problems.some((p) => p.code === "text-mismatch" || p.code === "verse-split");
}

/**
 * Read a story, carry it into German, and read it again: every subject the book
 * had must still be the same one (same id) afterwards, the cast must still be
 * one cast, and what the author left out must still be left out.
 */
async function runIdentity(): Promise<boolean> {
  console.log("\n══ identity — read, translate to German, read again. The same subjects, not new ones.");
  if (DRY) {
    console.log("(not part of a dry run: it needs three real answers)");
    return true;
  }
  const creds = { apiKey: apiKey() };
  const config: BookConfig = {
    ...createDefaultConfig("en-US"),
    textModel: { provider: "openai", id: MODEL },
    ageRangeId: "3-5",
    storyText: PROSE,
    storyBrief: {
      ...createDefaultStoryBrief("guided"),
      cast: [
        { id: "c1", name: "Mia", kind: "child", age: 4 },
        { id: "c2", name: "Mia's Mom", kind: "adult" },
      ] as never,
    },
  };
  const startedAt = Date.now();
  try {
    const first = await analyzeStory({ story: config.storyText, config, creds, model: MODEL });
    // The author leaves one thing out: it has to stay out.
    const left = first.anchors.find((a) => a.type !== "character");
    const read = first.anchors.map((a) => (a === left ? { ...a, include: false } : a));
    const project: Project = {
      id: "smoke",
      title: "Mia",
      createdAt: 0,
      updatedAt: 0,
      stage: "setup",
      furthestStage: "setup",
      config,
      anchors: read,
    };
    console.log(`read:        ${read.map((a) => `${a.name} [${a.type}]${a.include ? "" : " (left out)"}`).join(", ")}`);

    const german = { ...config, contentLocale: "de-DE" as const };
    const translated = await translateStory({ config: german, story: config.storyText, title: "Mia", sourceLocale: "en-US", anchors: read, creds, model: MODEL });
    console.log(`translation: reports ${translated.names.length} renames: ${translated.names.map((n) => `${n.from} → ${n.to}`).join("; ") || "none"}`);
    const moved = withTranslatedStory(project, translated, "de-DE");
    console.log(`book now:    ${moved.anchors!.map((a) => a.name).join(", ")}`);

    const again = await analyzeStory({ story: moved.config.storyText, config: moved.config, creds, model: MODEL, previousAnchors: moved.anchors });
    const merged = reconcileAnchorIds(again.anchors, moved.anchors!);
    console.log(`read again:  ${merged.map((a) => `${a.name} [${a.type}]${a.include ? "" : " (left out)"}`).join(", ")}`);

    const problems: string[] = [];
    for (const before of read) {
      const after = merged.find((a) => a.id === before.id);
      if (!after) problems.push(`"${before.name}" is gone, or is a new subject now`);
      else if (before.include !== after.include) problems.push(`"${before.name}" ${before.include ? "was left out" : "came back"}`);
    }
    const people = merged.filter((a) => a.type === "character");
    const linked = new Set(people.map((a) => a.castId).filter(Boolean));
    if (people.length > 2 + 1 || linked.size < 2) problems.push(`the cast is not one cast (${people.map((a) => a.name).join(", ")})`);
    console.log(problems.length === 0 ? `kept every subject, in ${secs(Date.now() - startedAt)}` : `PROBLEMS:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    return problems.length === 0;
  } catch (error) {
    console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

const chosen = STORIES.filter((s) => !ONLY || s.name === ONLY);
const withIdentity = !ONLY || ONLY === "identity";
if (chosen.length === 0 && ONLY !== "identity") {
  console.error(`No story called "${ONLY}". Choose from: ${[...STORIES.map((s) => s.name), "identity"].join(", ")}.`);
  process.exit(2);
}
console.log(`Page plan smoke run — model ${MODEL}${DRY ? ", dry run" : ""}${REVIEW ? "" : ", no review"}`);

let ok = true;
for (const story of ONLY === "identity" ? [] : chosen) ok = (await runStory(story)) && ok;
if (withIdentity) ok = (await runIdentity()) && ok;
console.log(ok ? "\nAll plans kept the words, and the subjects stayed the same." : "\nAt least one plan lost the author's words or cut a stanza, or a subject was lost.");
process.exit(ok ? 0 : 1);
