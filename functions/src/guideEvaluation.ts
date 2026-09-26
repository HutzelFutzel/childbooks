import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { ALL_SECRETS } from "./secrets";
import { ensureAdmin } from "./storage";
import {
  getArtStylesConfig,
  getAudienceConfig,
  getGuideConfig,
  getStoryCraftConfig,
  loadPromptContext,
} from "./appConfig";
import { apiKeyFor, resolveTextAction } from "./modelResolve";
import { interpretGuideTurn } from "../../books-frontend/src/core/pipeline/guideInterpret";
import { guidePatchContext } from "../../books-frontend/src/core/guide/patch";
import { resolveGuidePlaylist } from "../../books-frontend/src/core/guide/playlist";
import type { Project } from "../../books-frontend/src/core/types";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Daily live-model replay of the small, admin-reviewed extraction corpus. */
export const evaluateGuideExtractionDaily = onSchedule(
  {
    schedule: "30 4 * * *",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: ALL_SECRETS,
  },
  async () => {
    ensureAdmin();
    const db = getFirestore();
    const examples = await db
      .collection("appConfig/guideEval/examples")
      .orderBy("createdAt", "desc")
      .limit(25)
      .get();
    if (examples.empty) return;
    const [guide, model, prompts, audience, artStyles, storyCraft] =
      await Promise.all([
        getGuideConfig(),
        resolveTextAction("guideInterpret"),
        loadPromptContext(),
        getAudienceConfig(),
        getArtStylesConfig(),
        getStoryCraftConfig(),
      ]);
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ exampleId: string; reason: string }> = [];
    for (const exampleDoc of examples.docs) {
      const example = exampleDoc.data() as {
        sourceUid?: string;
        projectId?: string;
        message?: string;
        expectedClaims?: unknown[];
      };
      if (!example.sourceUid || !example.projectId || !example.message) {
        skipped += 1;
        continue;
      }
      const projectDoc = await db
        .doc(`users/${example.sourceUid}/projects/${example.projectId}`)
        .get();
      if (!projectDoc.exists) {
        skipped += 1;
        continue;
      }
      try {
        const result = await interpretGuideTurn({
          project: projectDoc.data() as Project,
          message: example.message,
          playlist: resolveGuidePlaylist(guide.playlist),
          patchContext: guidePatchContext({ audience, artStyles, storyCraft }),
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          providerId: model.provider,
          prompts,
          thresholds: guide.extraction.thresholds,
          repairAttempts: guide.extraction.repairAttempts,
          temperature: 0,
        });
        const expected = canonical(example.expectedClaims ?? []);
        const actual = canonical(
          result.claims.map((claim) => ({
            slot: claim.slot,
            value: claim.value,
          })),
        );
        if (actual === expected) passed += 1;
        else {
          failed += 1;
          failures.push({ exampleId: exampleDoc.id, reason: "Claims differed." });
        }
      } catch (error) {
        failed += 1;
        failures.push({
          exampleId: exampleDoc.id,
          reason: error instanceof Error ? error.message.slice(0, 300) : "Evaluation failed.",
        });
      }
    }
    const now = Date.now();
    await db.doc(`appConfig/guideEval/runs/${now}`).set({
      createdAt: now,
      model,
      total: examples.size,
      passed,
      failed,
      skipped,
      failures: failures.slice(0, 25),
    });
  },
);
