/* eslint-disable no-console */
/**
 * Offline pipeline harness: drives the REAL core orchestration
 * (renderIllustration / renderAnchor) with a mock PipelineEnv and a fake
 * provider HTTP, so we can trace which steps fire and catch wiring/logic bugs
 * without spending on real image models.
 */
import { setProviderHttp } from "../../books-frontend/src/core/providers/httpContext";
import {
  renderIllustration,
  type PipelineEnv,
} from "../../books-frontend/src/core/pipeline/illustrationRun";
import { renderAnchor } from "../../books-frontend/src/core/pipeline/anchorRun";
import { createVersionTree } from "../../books-frontend/src/core/versioning";
import { createDefaultConfig } from "../../books-frontend/src/core/types";
import type {
  Anchor,
  AnchorImage,
  DepictedSubject,
  IllustrationImage,
  Project,
  ScreenplaySpread,
} from "../../books-frontend/src/core/types";
import type { ResolvedModels } from "../../books-frontend/src/core/models/registry";

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

// ---- Fake provider HTTP -----------------------------------------------------
interface FakeState {
  binding: { id: string; found: boolean; x: number; y: number; width: number; height: number; extras?: { x: number; y: number; width: number; height: number }[] }[];
  embedded: { id: string; found: boolean; primaryX: number; primaryY: number; primaryWidth: number; primaryHeight: number; obsolete?: { x: number; y: number; width: number; height: number }[] }[];
  intent: { ops: unknown[]; ambiguous?: boolean; ambiguousReason?: string };
  localize: { id: string; found: boolean; x: number; y: number; width: number; height: number }[];
  calls: { kind: string }[];
}

const fake: FakeState = {
  binding: [],
  embedded: [],
  intent: { ops: [] },
  localize: [],
  calls: [],
};

function resetCalls() {
  fake.calls = [];
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function googleText(payload: unknown): Response {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  });
}

function googleImage(): Response {
  return jsonResponse({
    candidates: [
      { content: { parts: [{ inlineData: { mimeType: "image/png", data: TINY_PNG } }] } },
    ],
  });
}

setProviderHttp({
  baseUrl: () => "https://fake",
  fetch: async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    let parsed: any = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* multipart or empty */
    }
    const isImage = parsed?.generationConfig?.responseModalities?.includes?.("IMAGE");
    if (isImage) {
      fake.calls.push({ kind: "image" });
      return googleImage();
    }
    // Text/structured — discriminate by the JSON keys the prompt asks for.
    if (body.includes('"ops"') && body.includes("ambiguous")) {
      fake.calls.push({ kind: "intent" });
      return googleText(fake.intent);
    }
    if (body.includes("obsolete") || body.includes("primaryX")) {
      fake.calls.push({ kind: "embedded" });
      return googleText({ embedded: fake.embedded });
    }
    if (body.includes("extras")) {
      fake.calls.push({ kind: "binding" });
      return googleText({ subjects: fake.binding });
    }
    fake.calls.push({ kind: "localize" });
    return googleText({ subjects: fake.localize });
  },
});

// ---- Mock env ---------------------------------------------------------------
const models: ResolvedModels = {
  textModel: { provider: "google", id: "gemini-text" },
  imageModel: { provider: "google", id: "gemini-image" },
  anchorImageModel: { provider: "google", id: "gemini-anchor" },
  bindingModel: { provider: "google", id: "gemini-binding" },
  intentModel: { provider: "google", id: "gemini-intent" },
};

let styleImageEnabled = true;
const saved: string[] = [];

const env: PipelineEnv = {
  models,
  apiKeyFor: () => "test-key",
  loadBlob: async () => ({ base64: TINY_PNG, mimeType: "image/png" }),
  saveImage: async () => {
    const id = `blob_${saved.length}`;
    saved.push(id);
    return id;
  },
  loadStyleImage: async () => (styleImageEnabled ? { base64: TINY_PNG, mimeType: "image/png" } : null),
  composite: {
    compositeMaskedRegion: async () => ({ base64: TINY_PNG, mimeType: "image/png" }),
    buildHoleMask: async () => ({ base64: TINY_PNG, mimeType: "image/png" }),
  },
  runStep: async (_step, fn) => fn(),
  prompts: undefined,
};

// ---- Fixtures ---------------------------------------------------------------
function anchorWithImage(
  id: string,
  name: string,
  type: Anchor["type"],
  extra: Partial<Anchor> = {},
): Anchor {
  const content: AnchorImage = { blobId: `${id}_img`, mimeType: "image/png" };
  return {
    id,
    name,
    type,
    description: `${name} description`,
    importance: "high",
    mode: "creative",
    include: true,
    versions: createVersionTree(content, { label: "Initial" }),
    ...extra,
  };
}

function baseProject(anchors: Anchor[]): Project {
  return {
    id: "proj1",
    name: "Test",
    stage: "studio",
    config: createDefaultConfig(),
    anchors,
    createdAt: 0,
    updatedAt: 0,
  } as Project;
}

function spread(anchorIds: string[]): ScreenplaySpread {
  return {
    id: "sp1",
    kind: "single",
    text: "Once upon a time.",
    illustration: "A scene.",
    layoutNote: "",
    anchorIds,
  };
}

// ---- Assertions -------------------------------------------------------------
let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
}
function callCount(kind: string): number {
  return fake.calls.filter((c) => c.kind === kind).length;
}

// ---- Scenarios --------------------------------------------------------------
async function scenarioFreshPage() {
  console.log("\n== Scenario A: fresh page render (style + binding) ==");
  resetCalls();
  styleImageEnabled = true;
  const a1 = anchorWithImage("a1", "Amanda", "character");
  const project = baseProject([a1]);
  fake.binding = [{ id: "a1", found: true, x: 0.1, y: 0.1, width: 0.3, height: 0.5 }];
  const render = await renderIllustration(project, spread(["a1"]), {}, env);
  check("render returned", !!render);
  check("image generation fired", callCount("image") >= 1, `image calls=${callCount("image")}`);
  check("binding pass fired", callCount("binding") === 1, `binding calls=${callCount("binding")}`);
  check(
    "depicted captured for a1",
    !!render?.depicted?.some((d) => d.anchorId === "a1"),
    `depicted=${JSON.stringify(render?.depicted)}`,
  );
}

async function scenarioDuplicateRepair() {
  console.log("\n== Scenario B: duplicate repair on fresh page ==");
  resetCalls();
  const a1 = anchorWithImage("a1", "Amanda", "character");
  const project = baseProject([a1]);
  // Binding reports a1 drawn twice (one extra region).
  fake.binding = [
    { id: "a1", found: true, x: 0.1, y: 0.1, width: 0.3, height: 0.5, extras: [{ x: 0.6, y: 0.1, width: 0.3, height: 0.5 }] },
  ];
  const before = saved.length;
  const render = await renderIllustration(project, spread(["a1"]), {}, env);
  check("render returned", !!render);
  check("dedupe removal image call fired", callCount("image") >= 2, `image calls=${callCount("image")}`);
  check("saved final image", saved.length > before);
}

async function scenarioStructuredEdit() {
  console.log("\n== Scenario C: structured edit (replace) with prior depicted ==");
  resetCalls();
  const a1 = anchorWithImage("a1", "Amanda", "character");
  const a2 = anchorWithImage("a2", "Bruno", "character");
  const project = baseProject([a1, a2]);
  // Prior illustration version WITH depicted binding for a1.
  const depicted: DepictedSubject[] = [
    { anchorId: "a1", box: { x: 0.1, y: 0.1, width: 0.3, height: 0.5 }, brief: "girl", confidence: 1 },
  ];
  const content: IllustrationImage = {
    blobId: "prev_img",
    mimeType: "image/png",
    references: [{ anchorId: "a1", versionId: a1.versions!.cursorId }],
    depicted,
  };
  project.illustrations = { sp1: createVersionTree(content, { label: "Initial" }) };
  fake.intent = {
    ops: [{ op: "replace", targetAnchorId: "a1", sourceAnchorId: "a2", confidence: 0.9 }],
    ambiguous: false,
  };
  fake.binding = [{ id: "a1", found: true, x: 0.1, y: 0.1, width: 0.3, height: 0.5 }];
  const render = await renderIllustration(
    project,
    { ...spread(["a1", "a2"]) },
    { edit: "replace Amanda with Bruno", useReference: true },
    env,
  );
  check("render returned", !!render);
  check("intent resolution fired", callCount("intent") === 1, `intent calls=${callCount("intent")}`);
  check("label is Edit", render?.label === "Edit", `label=${render?.label}`);
  check("prompt reflects structured op", !!render?.prompt?.includes("replaced"), `prompt=${render?.prompt}`);
}

async function scenarioToggleOffRemoval() {
  console.log("\n== Scenario D: system toggle-off removal via boxes ==");
  resetCalls();
  const a1 = anchorWithImage("a1", "Amanda", "character");
  const a2 = anchorWithImage("a2", "Bruno", "character");
  const project = baseProject([a1, a2]);
  const depicted: DepictedSubject[] = [
    { anchorId: "a1", box: { x: 0.1, y: 0.1, width: 0.3, height: 0.5 } },
    { anchorId: "a2", box: { x: 0.6, y: 0.1, width: 0.3, height: 0.5 } },
  ];
  const content: IllustrationImage = {
    blobId: "prev_img",
    mimeType: "image/png",
    references: [
      { anchorId: "a1", versionId: a1.versions!.cursorId },
      { anchorId: "a2", versionId: a2.versions!.cursorId },
    ],
    depicted,
  };
  project.illustrations = { sp1: createVersionTree(content, { label: "Initial" }) };
  fake.binding = [{ id: "a1", found: true, x: 0.1, y: 0.1, width: 0.3, height: 0.5 }];
  // a2 toggled OFF: spread now only has a1.
  const render = await renderIllustration(project, spread(["a1"]), { useReference: true }, env);
  check("render returned", !!render);
  check("removal image call fired", callCount("image") >= 1, `image calls=${callCount("image")}`);
  check("prompt mentions removal", !!render?.prompt?.toLowerCase().includes("removed"), `prompt=${render?.prompt}`);
}

async function scenarioEmbeddedAnchorSheet() {
  console.log("\n== Scenario E: embedded de-dup on anchor reference sheet ==");
  resetCalls();
  const bed = anchorWithImage("bed", "Bed", "object");
  const room = anchorWithImage("room", "Room", "place", { containedIds: ["bed"] });
  const project = baseProject([bed, room]);
  fake.embedded = [
    { id: "bed", found: true, primaryX: 0.1, primaryY: 0.5, primaryWidth: 0.3, primaryHeight: 0.3, obsolete: [{ x: 0.6, y: 0.5, width: 0.3, height: 0.3 }] },
  ];
  const render = await renderAnchor(project, room, {}, env);
  check("render returned", !!render);
  check("embedded vision pass fired", callCount("embedded") === 1, `embedded calls=${callCount("embedded")}`);
  check("obsolete removal image call fired", callCount("image") >= 2, `image calls=${callCount("image")}`);
}

async function scenarioStyleDisabled() {
  console.log("\n== Scenario F: style image unavailable (fallback) ==");
  resetCalls();
  styleImageEnabled = false;
  const a1 = anchorWithImage("a1", "Amanda", "character");
  const project = baseProject([a1]);
  fake.binding = [{ id: "a1", found: true, x: 0.1, y: 0.1, width: 0.3, height: 0.5 }];
  const render = await renderIllustration(project, spread(["a1"]), {}, env);
  check("render returned even without style image", !!render);
  styleImageEnabled = true;
}

async function main() {
  await scenarioFreshPage();
  await scenarioDuplicateRepair();
  await scenarioStructuredEdit();
  await scenarioToggleOffRemoval();
  await scenarioEmbeddedAnchorSheet();
  await scenarioStyleDisabled();
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nHARNESS CRASH:", err);
  process.exit(2);
});
