import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { colorRoles, colors, colorValue, rounded, spacing, tokenCss, typography } from "./tokens.ts";

const DESIGN_MD = resolve(
  import.meta.dirname,
  "../../../../_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/DESIGN.md",
);

interface FrontMatter {
  colors: Record<string, string>;
  typography: Record<string, Record<string, string>>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
}

async function frontMatter(): Promise<FrontMatter> {
  const text = await readFile(DESIGN_MD, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match?.[1] === undefined) throw new Error("DESIGN.md has no front matter");
  return parse(match[1]) as FrontMatter;
}

describe("design tokens", () => {
  it("colors equal DESIGN.md front matter exactly", async () => {
    expect(colors).toEqual((await frontMatter()).colors);
  });

  it("typography equals DESIGN.md front matter exactly", async () => {
    expect(typography).toEqual((await frontMatter()).typography);
  });

  it("radii and spacing equal DESIGN.md front matter exactly", async () => {
    const fm = await frontMatter();
    expect(rounded).toEqual(fm.rounded);
    expect(spacing).toEqual(fm.spacing);
  });

  it("every color role has a dark counterpart", () => {
    for (const role of colorRoles) {
      expect(colorValue(role, "dark")).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(colorRoles).toHaveLength(Object.keys(colors).length / 2);
  });

  it("has no chromatic color other than gold (chroma above 20%): cream and the near-blacks are tints", () => {
    const chroma = (hex: string) => {
      const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      return (Math.max(...channels) - Math.min(...channels)) / 255;
    };
    const chromatic = Object.entries(colors).filter(([, hex]) => chroma(hex) > 0.2);
    expect(chromatic.map(([name]) => name).sort()).toEqual(["accent", "accent-dark", "accent-strong", "accent-strong-dark"]);
  });

  it("never includes #737373", () => {
    expect(JSON.stringify({ colors, typography })).not.toMatch(/737373/i);
    expect(tokenCss()).not.toMatch(/737373/i);
  });

  describe("tokenCss", () => {
    const css = tokenCss();

    it("emits light colors on :root and dark colors under prefers-color-scheme: dark", () => {
      const [light, dark] = css.split("@media (prefers-color-scheme: dark)");
      expect(light).toContain("--color-surface-base: #FEFBE9;");
      expect(light).toContain("--color-ink: #0A0A0A;");
      expect(dark).toContain("--color-surface-base: #0A0A0A;");
      expect(dark).toContain("--color-ink: #FFFFFF;");
      expect(dark).toContain("--color-surface-raised: #101319;");
      for (const role of colorRoles) {
        expect(light).toContain(`--color-${role}: ${colorValue(role, "light")};`);
        expect(dark).toContain(`--color-${role}: ${colorValue(role, "dark")};`);
      }
    });

    it("emits the type ramp, radii and spacing", () => {
      expect(css).toContain('--type-body-family: "Sora"');
      expect(css).toContain('--type-display-family: "Poppins"');
      expect(css).toContain("--type-label-strong-weight: 600;");
      expect(css).toContain("--radius-sm: 4px;");
      expect(css).toContain("--space-gutter: 24px;");
      expect(css).toContain("--size-rail: 248px;");
    });

    it("emits the new page-title, caption and stat sizes and the card/popover shadows", () => {
      expect(css).toContain("--type-page-title-size: 32px;");
      expect(css).toContain("--type-caption-size: 12px;");
      expect(css).toContain("--type-stat-size: 28px;");
      expect(css).toContain("--shadow-card:");
      expect(css).toContain("--shadow-popover:");
    });
  });
});
