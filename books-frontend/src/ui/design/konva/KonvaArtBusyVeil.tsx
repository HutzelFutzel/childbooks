/**
 * Quiet in-canvas generation state. It lives at the artwork's z so text and
 * shapes stay visible and editable above it.
 *
 * One lightweight orbit animation replaces the old stack of shimmer, pulsing
 * washes, fake progress and changing labels. It remains obvious without making
 * the artwork flicker or forcing several expensive canvas effects per frame.
 */
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import Konva from "konva";
import { Circle, Group, Rect, Star, Text } from "react-konva";
import type { ImageActionId } from "../../../core/ai/actions";

export function KonvaArtBusyVeil({
  x = 0,
  y = 0,
  w,
  h,
  action = "pageIllustration",
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
  const reduceMotion = useReducedMotion();
  const orbitRef = useRef<Konva.Group>(null);
  const compactUi = compact || w < 160 || h < 140;
  const pillW = Math.min(Math.max(76, w - 16), compactUi ? 118 : 196);
  const pillH = compactUi ? 34 : 52;
  const pillX = (w - pillW) / 2;
  const pillY = (h - pillH) / 2;
  const iconX = pillX + (compactUi ? 20 : 26);
  const iconY = pillY + pillH / 2;
  const label = action === "coverIllustration" ? "Creating cover" : "Creating artwork";

  useEffect(() => {
    const orbit = orbitRef.current;
    const layer = orbit?.getLayer();
    if (!orbit || !layer || reduceMotion) return;
    const animation = new Konva.Animation((frame) => {
      orbit.rotation(((frame?.time ?? 0) * 0.075) % 360);
    }, layer);
    animation.start();
    return () => {
      animation.stop();
    };
  }, [reduceMotion]);

  return (
    <Group
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
        width={w}
        height={h}
        fill="#F7F4EF"
        opacity={0.4}
        listening={false}
      />

      <Rect
        x={pillX}
        y={pillY}
        width={pillW}
        height={pillH}
        fill="rgba(255,255,255,0.94)"
        cornerRadius={pillH / 2}
        stroke="rgba(184,149,106,0.24)"
        strokeWidth={1}
        listening={false}
      />
      <Group ref={orbitRef} x={iconX} y={iconY} listening={false}>
        <Circle x={0} y={-9} radius={2} fill="#D97745" />
        <Circle x={7.8} y={4.5} radius={1.65} fill="#B8956A" opacity={0.82} />
        <Circle x={-7.8} y={4.5} radius={1.3} fill="#7C6CF2" opacity={0.68} />
      </Group>
      <Star
        x={iconX}
        y={iconY}
        numPoints={4}
        innerRadius={2.2}
        outerRadius={4.5}
        fill="#D97745"
        rotation={45}
        listening={false}
      />
      <Text
        x={iconX + (compactUi ? 15 : 18)}
        y={pillY + (compactUi ? 0 : 10)}
        width={pillW - (iconX - pillX) - (compactUi ? 22 : 28)}
        height={compactUi ? pillH : 16}
        text={compactUi ? "Creating…" : label}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize={compactUi ? 10 : 12}
        fontStyle="bold"
        fill="#44403C"
        verticalAlign="middle"
        listening={false}
        wrap="none"
        ellipsis
      />
      {!compactUi && (
        <Text
          x={iconX + 18}
          y={pillY + 29}
          width={pillW - (iconX - pillX) - 28}
          text="You can keep editing"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize={9}
          fill="#8C8177"
          listening={false}
          wrap="none"
        />
      )}
    </Group>
  );
}
