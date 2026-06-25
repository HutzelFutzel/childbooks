import type { CSSProperties, ReactNode } from "react";

export interface PresetColors {
  fill: string;
  stroke: string;
  text: string;
}

export interface PresetDef {
  id: string;
  label: string;
  defaults: PresetColors;
  /** Default inner padding as a fraction of the box's smaller side. */
  padding: number;
  /** Background chrome rendered behind the text (fills the box). */
  chrome?: (c: PresetColors) => ReactNode;
  /** Extra style applied to the text wrapper. */
  textStyle?: (c: PresetColors) => CSSProperties;
}

const fullAbs: CSSProperties = { position: "absolute", inset: 0 };

export const TEXT_PRESETS: PresetDef[] = [
  {
    id: "plain",
    label: "Plain",
    defaults: { fill: "rgba(255,255,255,0)", stroke: "rgba(0,0,0,0)", text: "#1f2430" },
    padding: 0.04,
  },
  {
    id: "shadowed",
    label: "Soft shadow",
    defaults: { fill: "rgba(255,255,255,0)", stroke: "rgba(0,0,0,0)", text: "#ffffff" },
    padding: 0.04,
    textStyle: () => ({ textShadow: "0 2px 8px rgba(0,0,0,0.55)" }),
  },
  {
    id: "solid",
    label: "Solid",
    defaults: { fill: "rgba(99,102,241,0.92)", stroke: "rgba(0,0,0,0)", text: "#ffffff" },
    padding: 0.07,
    chrome: (c) => <div style={{ ...fullAbs, background: c.fill, borderRadius: 16 }} />,
  },
  {
    id: "card",
    label: "Soft card",
    defaults: { fill: "rgba(255,255,255,0.96)", stroke: "rgba(0,0,0,0)", text: "#1f2430" },
    padding: 0.08,
    chrome: (c) => (
      <div style={{ ...fullAbs, background: c.fill, borderRadius: 18, boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }} />
    ),
  },
  {
    id: "outline",
    label: "Outline",
    defaults: { fill: "rgba(255,255,255,0)", stroke: "#1f2430", text: "#1f2430" },
    padding: 0.07,
    chrome: (c) => (
      <div style={{ ...fullAbs, background: c.fill, border: `3px solid ${c.stroke}`, borderRadius: 16 }} />
    ),
  },
  {
    id: "badge",
    label: "Pill",
    defaults: { fill: "rgba(236,72,153,0.95)", stroke: "rgba(0,0,0,0)", text: "#ffffff" },
    padding: 0.06,
    chrome: (c) => <div style={{ ...fullAbs, background: c.fill, borderRadius: 999 }} />,
  },
  {
    id: "sticker",
    label: "Sticker",
    defaults: { fill: "rgba(250,204,21,0.97)", stroke: "#ffffff", text: "#1f2430" },
    padding: 0.08,
    chrome: (c) => (
      <div
        style={{ ...fullAbs, background: c.fill, border: `6px solid ${c.stroke}`, borderRadius: 20, boxShadow: "0 6px 16px rgba(0,0,0,0.2)" }}
      />
    ),
  },
  {
    id: "ribbon",
    label: "Ribbon",
    defaults: { fill: "rgba(239,68,68,0.95)", stroke: "rgba(0,0,0,0)", text: "#ffffff" },
    padding: 0.08,
    chrome: (c) => (
      <div
        style={{
          ...fullAbs,
          background: c.fill,
          clipPath:
            "polygon(0 15%, 6% 50%, 0 85%, 94% 85%, 100% 50%, 94% 15%)",
        }}
      />
    ),
  },
  {
    id: "bubble",
    label: "Speech bubble",
    defaults: { fill: "rgba(255,255,255,0.97)", stroke: "rgba(0,0,0,0)", text: "#1f2430" },
    padding: 0.08,
    chrome: (c) => (
      <>
        <div style={{ ...fullAbs, background: c.fill, borderRadius: 22, boxShadow: "0 6px 16px rgba(0,0,0,0.14)" }} />
        <div
          style={{
            position: "absolute",
            left: "16%",
            bottom: -14,
            width: 0,
            height: 0,
            borderLeft: "10px solid transparent",
            borderRight: "18px solid transparent",
            borderTop: `18px solid ${c.fill}`,
          }}
        />
      </>
    ),
  },
  {
    id: "highlight",
    label: "Marker",
    defaults: { fill: "rgba(253,224,71,0.85)", stroke: "rgba(0,0,0,0)", text: "#1f2430" },
    padding: 0.05,
    chrome: (c) => (
      <div
        style={{
          ...fullAbs,
          background: c.fill,
          borderRadius: 6,
          transform: "rotate(-1deg)",
        }}
      />
    ),
  },
  {
    id: "underline",
    label: "Underline",
    defaults: { fill: "rgba(99,102,241,0.9)", stroke: "rgba(0,0,0,0)", text: "#1f2430" },
    padding: 0.04,
    chrome: (c) => (
      <div style={{ position: "absolute", left: "6%", right: "6%", bottom: "10%", height: 8, background: c.fill, borderRadius: 8 }} />
    ),
  },
  {
    id: "frame",
    label: "Double frame",
    defaults: { fill: "rgba(255,255,255,0.9)", stroke: "#1f2430", text: "#1f2430" },
    padding: 0.09,
    chrome: (c) => (
      <div
        style={{
          ...fullAbs,
          background: c.fill,
          border: `2px solid ${c.stroke}`,
          outline: `2px solid ${c.stroke}`,
          outlineOffset: 5,
          borderRadius: 6,
        }}
      />
    ),
  },
  {
    id: "note",
    label: "Lined note",
    defaults: { fill: "rgba(255,251,235,0.98)", stroke: "rgba(0,0,0,0.08)", text: "#3a3320" },
    padding: 0.08,
    chrome: (c) => (
      <div
        style={{
          ...fullAbs,
          background: c.fill,
          borderRadius: 8,
          boxShadow: "0 6px 14px rgba(0,0,0,0.12)",
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 22px, ${c.stroke} 22px 23px)`,
        }}
      />
    ),
  },
  {
    id: "cloud",
    label: "Cloud",
    defaults: { fill: "rgba(255,255,255,0.97)", stroke: "rgba(0,0,0,0)", text: "#334155" },
    padding: 0.1,
    chrome: (c) => (
      <div
        style={{
          ...fullAbs,
          background: c.fill,
          borderRadius: "48% 52% 56% 44% / 56% 50% 50% 44%",
          boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
        }}
      />
    ),
  },
  {
    id: "tape",
    label: "Taped",
    defaults: { fill: "rgba(255,255,255,0.95)", stroke: "rgba(148,163,184,0.55)", text: "#1f2430" },
    padding: 0.08,
    chrome: (c) => (
      <>
        <div style={{ ...fullAbs, background: c.fill, borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }} />
        <div style={{ position: "absolute", top: -8, left: "12%", width: "26%", height: 18, background: c.stroke, transform: "rotate(-6deg)" }} />
        <div style={{ position: "absolute", top: -8, right: "12%", width: "26%", height: 18, background: c.stroke, transform: "rotate(5deg)" }} />
      </>
    ),
  },
];

export function getPreset(id: string): PresetDef {
  return TEXT_PRESETS.find((p) => p.id === id) ?? TEXT_PRESETS[0];
}
