/**
 * The one design-token source for the management panel. Values are identical
 * to the DESIGN.md front matter (a test parses DESIGN.md and compares), and
 * every stylesheet reads them only through the CSS custom properties that
 * {@link tokenCss} emits. Light values sit on `:root`; each `<name>-dark`
 * color replaces `<name>` under `prefers-color-scheme: dark`.
 */

export const colors = {
  "surface-base": "#FEFBE9",
  "surface-raised": "#FFFFFF",
  ink: "#0A0A0A",
  "ink-secondary": "#171717",
  "ink-on-accent": "#000000",
  accent: "#FFC700",
  "accent-strong": "#FBBF24",
  border: "#E5E5E5",
  inverse: "#FAFAFA",
  "surface-subtle": "#F7F3E4",
  "surface-sunken": "#F1ECD8",
  "ink-muted": "#525252",
  "border-strong": "#C9C4B4",
  sidebar: "#0A0A0A",
  "sidebar-ink": "#FAFAFA",
  "sidebar-muted": "#A3A3A3",
  "sidebar-active": "#1F1F1F",
  "surface-base-dark": "#0A0A0A",
  "surface-raised-dark": "#101319",
  "ink-dark": "#FFFFFF",
  "ink-secondary-dark": "#FAFAFA",
  "ink-on-accent-dark": "#000000",
  "accent-dark": "#FFC700",
  "accent-strong-dark": "#FBBF24",
  "border-dark": "#171717",
  "inverse-dark": "#171717",
  "surface-subtle-dark": "#15181E",
  "surface-sunken-dark": "#0D1015",
  "ink-muted-dark": "#A3A3A3",
  "border-strong-dark": "#2A2E36",
  "sidebar-dark": "#101319",
  "sidebar-ink-dark": "#FFFFFF",
  "sidebar-muted-dark": "#A3A3A3",
  "sidebar-active-dark": "#1A1E25",
} as const;

export type ColorName = keyof typeof colors;
/** A color role: a name that has a light value and a `-dark` counterpart. */
export type ColorRole = Exclude<ColorName, `${string}-dark`>;

export interface TypeStyle {
  readonly fontFamily: "Sora" | "Poppins";
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly letterSpacing?: string;
}

export const typography = {
  display: { fontFamily: "Poppins", fontSize: "52px", fontWeight: "400", lineHeight: "1.3" },
  title: { fontFamily: "Sora", fontSize: "48px", fontWeight: "600", lineHeight: "1.11", letterSpacing: "-0.01em" },
  headline: { fontFamily: "Sora", fontSize: "36px", fontWeight: "700", lineHeight: "1.11" },
  "title-sm": { fontFamily: "Sora", fontSize: "22px", fontWeight: "700", lineHeight: "1.2" },
  body: { fontFamily: "Sora", fontSize: "16px", fontWeight: "400", lineHeight: "1.5" },
  "body-light": { fontFamily: "Poppins", fontSize: "16px", fontWeight: "300", lineHeight: "1.3" },
  label: { fontFamily: "Sora", fontSize: "14px", fontWeight: "400", lineHeight: "1.4", letterSpacing: "0.005em" },
  "label-strong": {
    fontFamily: "Sora",
    fontSize: "14px",
    fontWeight: "600",
    lineHeight: "1.85",
    letterSpacing: "0.033em",
  },
  "page-title": { fontFamily: "Sora", fontSize: "32px", fontWeight: "600", lineHeight: "1.15" },
  "section-title": { fontFamily: "Sora", fontSize: "20px", fontWeight: "600", lineHeight: "1.3" },
  "body-sm": { fontFamily: "Sora", fontSize: "14px", fontWeight: "400", lineHeight: "1.5" },
  caption: { fontFamily: "Sora", fontSize: "12px", fontWeight: "500", lineHeight: "1.4" },
  stat: { fontFamily: "Sora", fontSize: "28px", fontWeight: "600", lineHeight: "1.1" },
} as const satisfies Record<string, TypeStyle>;

export type TypeName = keyof typeof typography;

export const rounded = { sm: "4px", md: "8px" } as const;

export const spacing = {
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "5": "24px",
  "6": "32px",
  "7": "48px",
  "8": "64px",
  gutter: "24px",
  "margin-desktop": "76px",
} as const;

/**
 * Panel-only sizes DESIGN.md states in prose rather than front matter: the
 * site form shadow, the 1px hairline, the ink focus ring, the 24px minimum
 * target, the 40px field height, and the reading measure for forms.
 */
export const sizes = {
  hairline: "1px",
  "focus-ring": "2px",
  "focus-offset": "2px",
  "target-min": "24px",
  "field-min": "40px",
  "button-padding-inline": "22px",
  "form-measure": "28rem",
  "content-measure": "80rem",
} as const;

export const shadow = {
  form: "rgba(0, 0, 0, 0.1) 0 1px 2px",
  card: "0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)",
  popover: "0 8px 24px rgba(0,0,0,0.16)",
} as const;

/** Fallbacks after the self-hosted families; no remote font is ever requested. */
const FONT_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** The light and dark color roles: every name without `-dark`. */
export const colorRoles = (Object.keys(colors) as ColorName[]).filter(
  (name): name is ColorRole => !name.endsWith("-dark"),
);

/** The value of `role` in `mode`. */
export function colorValue(role: ColorRole, mode: "light" | "dark"): string {
  return mode === "light" ? colors[role] : colors[`${role}-dark`];
}

/** `name: value` declarations for every non-color token. */
function staticDeclarations(): string[] {
  const lines: string[] = [];
  for (const [name, style] of Object.entries(typography) as [TypeName, TypeStyle][]) {
    lines.push(`--type-${name}-family: "${style.fontFamily}", ${FONT_FALLBACK};`);
    lines.push(`--type-${name}-size: ${style.fontSize};`);
    lines.push(`--type-${name}-weight: ${style.fontWeight};`);
    lines.push(`--type-${name}-line-height: ${style.lineHeight};`);
    lines.push(`--type-${name}-letter-spacing: ${style.letterSpacing ?? "normal"};`);
  }
  for (const [name, value] of Object.entries(rounded)) lines.push(`--radius-${name}: ${value};`);
  for (const [name, value] of Object.entries(spacing)) lines.push(`--space-${name}: ${value};`);
  for (const [name, value] of Object.entries(sizes)) lines.push(`--size-${kebab(name)}: ${value};`);
  for (const [name, value] of Object.entries(shadow)) lines.push(`--shadow-${name}: ${value};`);
  return lines;
}

/**
 * The CSS custom properties for every token: light colors and all other
 * tokens on `:root`, dark colors under `prefers-color-scheme: dark`.
 */
export function tokenCss(): string {
  const light = colorRoles.map((role) => `--color-${role}: ${colorValue(role, "light")};`);
  const dark = colorRoles.map((role) => `--color-${role}: ${colorValue(role, "dark")};`);
  return [
    ":root {",
    "  color-scheme: light dark;",
    ...[...light, ...staticDeclarations()].map((line) => `  ${line}`),
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    ...dark.map((line) => `    ${line}`),
    "  }",
    "}",
    "",
  ].join("\n");
}
