import type { ReactNode } from "react";
import { Group, Line, Rect } from "react-konva";
import type { PresetColors } from "../presets";

/**
 * Konva renderings of the 15 text-box presets. These approximate the CSS chrome
 * used by the DOM/print renderer (`presets.tsx`) closely enough for editing;
 * the print path still uses the exact CSS version.
 *
 * Returned nodes are drawn in the box's local pixel space (0..w, 0..h).
 */
export function chromeFor(presetId: string, w: number, h: number, c: PresetColors): ReactNode {
  switch (presetId) {
    case "solid":
      return <Rect width={w} height={h} fill={c.fill} cornerRadius={16} />;
    case "card":
      return (
        <Rect
          width={w}
          height={h}
          fill={c.fill}
          cornerRadius={18}
          shadowColor="black"
          shadowOpacity={0.15}
          shadowBlur={24}
          shadowOffsetY={8}
        />
      );
    case "outline":
      return <Rect width={w} height={h} fill={c.fill} stroke={c.stroke} strokeWidth={3} cornerRadius={16} />;
    case "badge":
      return <Rect width={w} height={h} fill={c.fill} cornerRadius={Math.min(w, h) / 2} />;
    case "sticker":
      return (
        <Rect
          width={w}
          height={h}
          fill={c.fill}
          stroke={c.stroke}
          strokeWidth={6}
          cornerRadius={20}
          shadowColor="black"
          shadowOpacity={0.2}
          shadowBlur={16}
          shadowOffsetY={6}
        />
      );
    case "ribbon":
      return (
        <Line
          closed
          points={[0, 0.15 * h, 0.06 * w, 0.5 * h, 0, 0.85 * h, 0.94 * w, 0.85 * h, w, 0.5 * h, 0.94 * w, 0.15 * h]}
          fill={c.fill}
        />
      );
    case "bubble":
      return (
        <Group>
          <Rect
            width={w}
            height={h}
            fill={c.fill}
            cornerRadius={22}
            shadowColor="black"
            shadowOpacity={0.14}
            shadowBlur={16}
            shadowOffsetY={6}
          />
          <Line closed points={[0.16 * w, h - 2, 0.16 * w + 28, h - 2, 0.16 * w + 10, h + 16]} fill={c.fill} />
        </Group>
      );
    case "highlight":
      return <Rect width={w} height={h} fill={c.fill} cornerRadius={6} rotation={-1} />;
    case "underline":
      return <Rect x={0.06 * w} y={h - 0.1 * h - 8} width={0.88 * w} height={8} fill={c.fill} cornerRadius={8} />;
    case "frame":
      return (
        <Group>
          <Rect x={-5} y={-5} width={w + 10} height={h + 10} stroke={c.stroke} strokeWidth={2} cornerRadius={6} />
          <Rect width={w} height={h} fill={c.fill} stroke={c.stroke} strokeWidth={2} cornerRadius={6} />
        </Group>
      );
    case "note": {
      const gap = 23;
      const lines: ReactNode[] = [];
      for (let yy = gap; yy < h; yy += gap) {
        lines.push(<Line key={yy} points={[0, yy, w, yy]} stroke={c.stroke} strokeWidth={1} listening={false} />);
      }
      return (
        <Group>
          <Rect
            width={w}
            height={h}
            fill={c.fill}
            cornerRadius={8}
            shadowColor="black"
            shadowOpacity={0.12}
            shadowBlur={14}
            shadowOffsetY={6}
          />
          <Group clipFunc={(ctx) => ctx.rect(0, 0, w, h)}>{lines}</Group>
        </Group>
      );
    }
    case "cloud":
      return (
        <Rect
          width={w}
          height={h}
          fill={c.fill}
          cornerRadius={Math.min(w, h) * 0.5}
          shadowColor="black"
          shadowOpacity={0.12}
          shadowBlur={16}
          shadowOffsetY={6}
        />
      );
    case "tape":
      return (
        <Group>
          <Rect
            width={w}
            height={h}
            fill={c.fill}
            cornerRadius={4}
            shadowColor="black"
            shadowOpacity={0.12}
            shadowBlur={12}
            shadowOffsetY={4}
          />
          <Rect x={0.12 * w} y={-8} width={0.26 * w} height={18} fill={c.stroke} rotation={-6} />
          <Rect x={0.62 * w} y={-8} width={0.26 * w} height={18} fill={c.stroke} rotation={5} />
        </Group>
      );
    default:
      return null; // "plain" and "shadowed" have no chrome
  }
}
