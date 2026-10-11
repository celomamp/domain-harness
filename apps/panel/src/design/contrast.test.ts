import { describe, expect, it } from "vitest";
import { CONTRAST_EXCEPTIONS, CONTRAST_PAIRS, contrastRatio, pairRatio } from "./contrast.ts";

const MODES = ["light", "dark"] as const;

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

describe("DESIGN.md contrast pairs, both modes", () => {
  const isException = (fg: string, bg: string, mode: string) =>
    CONTRAST_EXCEPTIONS.some((e) => e.foreground === fg && e.background === bg && e.mode === mode);

  for (const mode of MODES) {
    for (const pair of CONTRAST_PAIRS) {
      const label = `${pair.foreground} on ${pair.background} (${pair.use}) in ${mode} mode >= ${String(pair.min)}:1`;
      if (isException(pair.foreground, pair.background, mode)) {
        it.skip(`${label}: declared exception`, () => undefined);
      } else {
        it(label, () => {
          expect(pairRatio(pair, mode)).toBeGreaterThanOrEqual(pair.min);
        });
      }
    }
  }

  it("declares exactly one exception: gold marks on white in light mode, at its measured ratio", () => {
    expect(CONTRAST_EXCEPTIONS).toHaveLength(1);
    const [exception] = CONTRAST_EXCEPTIONS;
    expect(exception).toMatchObject({ foreground: "accent", background: "surface-raised", mode: "light" });
    expect(Number(pairRatio({ foreground: "accent", background: "surface-raised" }, "light").toFixed(2))).toBe(
      exception?.measured,
    );
    expect(exception?.reason).toMatch(/Epic 6/);
  });

  it("every declared exception really fails, and only in its own mode", () => {
    for (const exception of CONTRAST_EXCEPTIONS) {
      const pair = CONTRAST_PAIRS.find((p) => p.foreground === exception.foreground && p.background === exception.background);
      expect(pair).toBeDefined();
      expect(pairRatio(exception, exception.mode)).toBeLessThan(pair?.min ?? 0);
      expect(pairRatio(exception, exception.mode === "light" ? "dark" : "light")).toBeGreaterThanOrEqual(pair?.min ?? 99);
    }
  });
});
