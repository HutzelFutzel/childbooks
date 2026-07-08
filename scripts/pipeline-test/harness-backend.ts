/* eslint-disable no-console */
/**
 * Backend harness: exercises the FUNCTIONS glue against the live emulator.
 *  - loadStyleImage("watercolor") -> does downloadPublicBase64 / imageUrl work?
 *  - renderAnchor end-to-end via backendPipelineEnv with a FAKE image provider.
 */
import { ensureAdmin } from "../../functions/src/storage";
import { loadPromptContext } from "../../functions/src/appConfig";
import { backendPipelineEnv } from "../../functions/src/pipelineEnv";
import "../../functions/src/providerHttp"; // sets real provider http (we override below)
import { setProviderHttp } from "../../books-frontend/src/core/providers/httpContext";
import { renderAnchor } from "../../books-frontend/src/core/pipeline/anchorRun";
import { createVersionTree } from "../../books-frontend/src/core/versioning";
import { createDefaultConfig } from "../../books-frontend/src/core/types";
import type { Anchor, AnchorImage, Project } from "../../books-frontend/src/core/types";
import type { ResolvedModels } from "../../books-frontend/src/core/models/registry";

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const calls: { kind: string }[] = [];
setProviderHttp({
  baseUrl: () => "https://fake",
  fetch: async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    let parsed: any = {};
    try {
      parsed = JSON.parse(body);
    } catch {}
    if (parsed?.generationConfig?.responseModalities?.includes?.("IMAGE")) {
      calls.push({ kind: "image" });
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: TINY_PNG } }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const kind = body.includes("obsolete") ? "embedded" : body.includes("extras") ? "binding" : "text";
    calls.push({ kind });
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ subjects: [], embedded: [] }) }] } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  },
});

const models: ResolvedModels = {
  textModel: { provider: "google", id: "gemini-text" },
  imageModel: { provider: "google", id: "gemini-image" },
  anchorImageModel: { provider: "google", id: "gemini-anchor" },
  bindingModel: { provider: "google", id: "gemini-binding" },
  intentModel: { provider: "google", id: "gemini-intent" },
};

async function main() {
  ensureAdmin();
  const prompts = await loadPromptContext();
  console.log("artStyles.examples keys:", Object.keys(prompts.artStyles?.examples ?? {}));
  console.log("watercolor example:", JSON.stringify(prompts.artStyles?.examples?.watercolor));

  const base = backendPipelineEnv("test-uid", models, prompts);

  // --- Test 1: style image loading against live emulator storage ---
  console.log("\n== Test 1: loadStyleImage('watercolor') ==");
  const t0 = Date.now();
  let styleData: { base64: string; mimeType: string } | null = null;
  try {
    styleData = await base.loadStyleImage("watercolor");
  } catch (err) {
    console.log("  loadStyleImage THREW:", (err as Error).message);
  }
  const ms = Date.now() - t0;
  if (styleData) {
    const bytes = Buffer.from(styleData.base64, "base64").length;
    console.log(`  [PASS] style image loaded: ${bytes} bytes, ${styleData.mimeType}, in ${ms}ms`);
    if (bytes > 1_000_000) console.log(`  [WARN] style image is ${(bytes / 1e6).toFixed(1)}MB — sent as reference on EVERY generation (latency).`);
  } else {
    console.log(`  [FAIL] loadStyleImage returned null in ${ms}ms — style silently disabled.`);
  }

  // --- Test 2: renderAnchor (character) — does style ref get included? ---
  console.log("\n== Test 2: renderAnchor(character) with fake image provider ==");
  // Patch apiKeyFor so we don't need real server secrets.
  const env = { ...base, apiKeyFor: () => "test-key", loadBlob: async () => ({ base64: TINY_PNG, mimeType: "image/png" }) };
  const anchor: Anchor = {
    id: "a1",
    name: "Amanda",
    type: "character",
    description: "a young girl",
    importance: "high",
    mode: "creative",
    include: true,
  };
  const project: Project = {
    id: "p1",
    name: "T",
    stage: "studio",
    config: createDefaultConfig(),
    anchors: [anchor],
    createdAt: 0,
    updatedAt: 0,
  } as Project;
  calls.length = 0;
  try {
    const render = await renderAnchor(project, anchor, {}, env as any);
    console.log(`  [${render ? "PASS" : "FAIL"}] renderAnchor returned; image calls=${calls.filter((c) => c.kind === "image").length}`);
    console.log(`  prompt head: ${render?.prompt?.slice(0, 120)}`);
    console.log(`  prompt mentions style ref: ${/style/i.test(render?.prompt ?? "")}`);
  } catch (err) {
    console.log("  [FAIL] renderAnchor THREW:", (err as Error).message);
    console.log((err as Error).stack?.split("\n").slice(0, 4).join("\n"));
  }

  console.log("\nDONE");
  process.exit(0);
}

main().catch((e) => {
  console.error("HARNESS CRASH:", e);
  process.exit(2);
});
