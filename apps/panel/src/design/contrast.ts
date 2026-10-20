import { colorValue } from "./tokens.ts";
import type { ColorRole } from "./tokens.ts";

/** WCAG 2.x relative luminance of a `#RRGGBB` color. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new TypeError(`not a #RRGGBB color: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => {
    const channel = Number.parseInt(part ?? "0", 16) / 255;
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** One row of the DESIGN.md contrast table. */
export interface ContrastPair {
  readonly foreground: ColorRole;
  readonly background: ColorRole;
  readonly use: string;
  readonly min: number;
}

/**
 * The load-bearing pairs from DESIGN.md "Colors", by role. Each is checked in
 * light mode and, mapped to its `-dark` counterparts, in dark mode. The row
 * "`ink-dark` on `surface-base-dark`" is the dark mapping of the first pair.
 * The "border is not the only focus or error signal" row is a usage rule, not
 * a ratio: the focus ring is the ink pair below.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { foreground: "ink", background: "surface-base", use: "Body, rows, denials", min: 4.5 },
  { foreground: "ink", background: "surface-raised", use: "Forms, inputs", min: 4.5 },
  { foreground: "ink-secondary", background: "surface-base", use: "Labels, nav", min: 4.5 },
  { foreground: "ink-on-accent", background: "accent", use: "Primary button, alert", min: 4.5 },
  { foreground: "inverse", background: "ink-secondary", use: "Inverse chip", min: 4.5 },
  { foreground: "ink", background: "surface-raised", use: "Large text (title)", min: 3 },
  { foreground: "ink", background: "surface-base", use: "Focus ring (non-text)", min: 3 },
  { foreground: "accent", background: "surface-raised", use: "Series accent marks (non-text)", min: 3 },
  { foreground: "ink-muted", background: "surface-base", use: "secondary labels", min: 4.5 },
  { foreground: "sidebar-muted", background: "sidebar", use: "rail section labels", min: 4.5 },
  { foreground: "sidebar-ink", background: "sidebar", use: "rail text", min: 4.5 },
  { foreground: "ink", background: "surface-subtle", use: "table header text", min: 4.5 },
];

/** A pair DESIGN.md mandates that cannot meet its target with the mandated values. */
export interface ContrastException {
  readonly foreground: ColorRole;
  readonly background: ColorRole;
  readonly mode: "light" | "dark";
  /** Measured ratio, two decimals. */
  readonly measured: number;
  readonly reason: string;
}

/**
 * Declared exceptions. The contrast test fails if any other pair fails or if
 * this list grows.
 */
export const CONTRAST_EXCEPTIONS: readonly ContrastException[] = [
  {
    foreground: "accent",
    background: "surface-raised",
    mode: "light",
    measured: 1.56,
    reason:
      "Known DESIGN.md defect: #FFC700 on #FFFFFF cannot reach 3:1. No adherence-series exists yet; Epic 6 must give accent marks an ink edge or DESIGN.md must change. It passes in dark mode.",
  },
];

/** The ratio of `pair` in `mode`. */
export function pairRatio(pair: Pick<ContrastPair, "foreground" | "background">, mode: "light" | "dark"): number {
  return contrastRatio(colorValue(pair.foreground, mode), colorValue(pair.background, mode));
}
