/**
 * In-canvas generation veil. Lives inside the Konva stack at the art's z so
 * text/shapes above the illustration stay visible and editable.
 *
 * Motion is driven by Konva.Animation (no React re-renders). Labels refresh
 * about once a second via direct node updates.
 */
import { useEffect, useMemo, useRef } from "react";
import Konva from "konva";
import { Group, Rect, Text, Arc, Circle } from "react-konva";
import type { ImageActionId } from "../../../core/ai/actions";
import { IMAGE_TIERS } from "../../../core/config/modelConfig";
import {
  estimateTaskRange,
  formatDurationRange,
} from "../../../core/config/latencyStats";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { usePreferredImageTier } from "../../../state/imageTier";
import {
  formatElapsed,
} from "../../generation/useGenerationProgress";

const PHASES: Partial<Record<ImageActionId, string[]>> = {
  pageIllustration: [
    "Composing the scene…",
    "Matching your characters…",
    "Painting in your style…",
    "Adding final touches…",
  ],
  coverIllustration: [
    "Composing the cover…",
    "Matching your characters…",
    "Painting in your style…",
    "Final touches…",
  ],
  anchorImage: ["Designing the reference…", "Locking in the look…", "Polishing details…"],
};

const DEFAULT_PHASES = ["Warming up…", "Generating…", "Almost there…"];

export function KonvaArtBusyVeil({
  x = 0,
  y = 0,
  w,
  h,
  action = "pageIllustration",
  refCount = 0,
  compact = false,
}: {
  x?: number;
  y?: number;
  w: number;
  h: number;
  action?: ImageActionId;
  refCount?: number;
  compact?: boolean;
}) {
  const latencyStats = useAppConfigStore((s) => s.latencyStats);
  const preferred = usePreferredImageTier();

  const { estimateLabel, estimateMaxMs } = useMemo(() => {
    const tiers = preferred ? [preferred] : IMAGE_TIERS;
    const ranges = tiers.map((t) =>
      estimateTaskRange(latencyStats, action, t, "fresh", refCount),
    );
    const minMs = Math.min(...ranges.map((r) => r.minMs));
    const maxMs = Math.max(...ranges.map((r) => r.maxMs));
    return {
      estimateLabel: formatDurationRange({ minMs, maxMs }),
      estimateMaxMs: maxMs,
    };
  }, [latencyStats, action, preferred, refCount]);

  const phases = PHASES[action] ?? DEFAULT_PHASES;

  const groupRef = useRef<Konva.Group>(null);
  const washDarkRef = useRef<Konva.Rect>(null);
  const washLightRef = useRef<Konva.Rect>(null);
  const shimmerRef = useRef<Konva.Rect>(null);
  const arcRef = useRef<Konva.Arc>(null);
  const phaseTextRef = useRef<Konva.Text>(null);
  const timeTextRef = useRef<Konva.Text>(null);
  const progressRef = useRef<Konva.Rect>(null);
  const startedAt = useRef(Date.now());
  const lastLabelAt = useRef(0);
  const lastPhaseIdx = useRef(-1);

  const compactUi = compact || w < 160 || h < 140;
  const cardW = Math.min(w * 0.78, compactUi ? 132 : 200);
  const cardH = compactUi ? 72 : 96;
  const cardX = (w - cardW) / 2;
  const cardY = (h - cardH) / 2;
  const barW = cardW - 28;
  const barX = cardX + 14;
  const barY = cardY + cardH - 18;
  const spinnerR = compactUi ? 10 : 13;
  const shimmerW = Math.max(24, w * 0.28);

  useEffect(() => {
    startedAt.current = Date.now();
    lastLabelAt.current = 0;
    lastPhaseIdx.current = -1;

    const group = groupRef.current;
    const layer = group?.getLayer();
    if (!layer) return;

    const anim = new Konva.Animation((frame) => {
      const t = (frame?.time ?? 0) / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
      const wash = 0.4 + 0.05 * pulse;

      washDarkRef.current?.opacity(wash * 0.5);
      washLightRef.current?.opacity(wash);
      shimmerRef.current?.x((((t * 0.4) % 1.5) - 0.25) * w);
      arcRef.current?.rotation((t * 240) % 360);

      const elapsed = Date.now() - startedAt.current;
      const frac = estimateMaxMs > 0 ? elapsed / estimateMaxMs : 0;
      const overdue = frac >= 1;
      const progress = Math.min(0.92, frac * 0.92);
      const barFill = overdue ? 0.92 + 0.03 * pulse : progress;
      progressRef.current?.width(Math.max(6, barW * barFill));

      // Text updates are comparatively expensive — once a second is enough.
      if (elapsed - lastLabelAt.current >= 1000 || lastLabelAt.current === 0) {
        lastLabelAt.current = elapsed;
        const phaseIdx = overdue
          ? phases.length - 1
          : Math.min(phases.length - 1, Math.floor(frac * phases.length));
        if (!compactUi && phaseIdx !== lastPhaseIdx.current) {
          lastPhaseIdx.current = phaseIdx;
          phaseTextRef.current?.text(phases[phaseIdx] ?? "Generating…");
        }
        const elapsedLabel = formatElapsed(elapsed);
        timeTextRef.current?.text(
          overdue
            ? `${elapsedLabel} · almost done`
            : `${elapsedLabel} · usually ${estimateLabel}`,
        );
      }
    }, layer);

    anim.start();
    return () => {
      anim.stop();
    };
  }, [w, h, barW, estimateMaxMs, estimateLabel, phases, compactUi]);

  return (
    <Group
      ref={groupRef}
      x={x}
      y={y}
      listening={false}
      clipFunc={(ctx) => {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.closePath();
      }}
    >
      <Rect
        ref={washDarkRef}
        width={w}
        height={h}
        fill="#1C1917"
        opacity={0.22}
        listening={false}
      />
      <Rect
        ref={washLightRef}
        width={w}
        height={h}
        fill="#F7F4EF"
        opacity={0.42}
        listening={false}
      />

      <Rect
        ref={shimmerRef}
        x={-shimmerW}
        y={0}
        width={shimmerW}
        height={h}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: shimmerW, y: 0 }}
        fillLinearGradientColorStops={[
          0,
          "rgba(255,255,255,0)",
          0.5,
          "rgba(255,255,255,0.28)",
          1,
          "rgba(255,255,255,0)",
        ]}
        listening={false}
      />

      {/* Card — no shadowBlur (expensive on every frame). */}
      <Rect
        x={cardX}
        y={cardY}
        width={cardW}
        height={cardH}
        fill="rgba(255,255,255,0.94)"
        cornerRadius={14}
        stroke="rgba(28,25,23,0.06)"
        strokeWidth={1}
        listening={false}
      />

      <Circle
        x={cardX + 22}
        y={cardY + (compactUi ? 22 : 26)}
        radius={spinnerR}
        stroke="rgba(184,149,106,0.25)"
        strokeWidth={2.5}
        listening={false}
      />
      <Arc
        ref={arcRef}
        x={cardX + 22}
        y={cardY + (compactUi ? 22 : 26)}
        innerRadius={spinnerR - 1.25}
        outerRadius={spinnerR + 1.25}
        angle={110}
        rotation={0}
        fill="#B8956A"
        listening={false}
      />

      <Text
        ref={phaseTextRef}
        x={cardX + 40}
        y={cardY + (compactUi ? 14 : 16)}
        width={cardW - 52}
        text={compactUi ? "Creating art…" : phases[0] ?? "Generating…"}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize={compactUi ? 11 : 12}
        fontStyle="bold"
        fill="#44403C"
        listening={false}
        wrap="none"
        ellipsis
      />

      <Text
        ref={timeTextRef}
        x={cardX + 40}
        y={cardY + (compactUi ? 32 : 36)}
        width={cardW - 52}
        text={`0s · usually ${estimateLabel}`}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize={10}
        fill="#A8A29E"
        listening={false}
        wrap="none"
        ellipsis
      />

      <Rect
        x={barX}
        y={barY}
        width={barW}
        height={4}
        fill="rgba(28,25,23,0.08)"
        cornerRadius={2}
        listening={false}
      />
      <Rect
        ref={progressRef}
        x={barX}
        y={barY}
        width={6}
        height={4}
        fill="#B8956A"
        cornerRadius={2}
        listening={false}
      />
    </Group>
  );
}
