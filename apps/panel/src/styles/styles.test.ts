import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenCss } from "../design/tokens.ts";

const SRC = resolve(import.meta.dirname, "..");
const STYLES = resolve(import.meta.dirname);

async function stylesheets(): Promise<[string, string][]> {
  const names = (await readdir(STYLES)).filter((name) => name.endsWith(".css"));
  return Promise.all(names.map(async (name) => [name, await readFile(join(STYLES, name), "utf8")] as [string, string]));
}

async function sourceFiles(dir: string = SRC): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}

/** Each rule's selector and body, comments removed. */
function rules(css: string): { selector: string; body: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").trim(),
    body: m[2] ?? "",
  }));
}

describe("stylesheets", () => {
  it("exist", async () => {
    expect((await stylesheets()).length).toBeGreaterThan(0);
  });

  it("contain no hex color, rgb() or hsl() literal (colors come only from tokens)", async () => {
    for (const [name, css] of await stylesheets()) {
      const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(clean, name).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(clean, name).not.toMatch(/\b(rgba?|hsla?|oklch|lab)\(/i);
    }
  });

  it("contain no px literal (sizes come only from tokens)", async () => {
    for (const [name, css] of await stylesheets()) {
      expect(css.replace(/\/\*[\s\S]*?\*\//g, ""), name).not.toMatch(/\d+(\.\d+)?px\b/);
    }
  });

  it("use only custom properties the token source defines", async () => {
    const defined = new Set([...tokenCss().matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
    for (const [name, css] of await stylesheets()) {
      for (const [, used] of css.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        expect(defined.has(used), `${name} uses ${String(used)}`).toBe(true);
      }
    }
  });

  it("never color text with an accent variable", async () => {
    for (const [name, css] of await stylesheets()) {
      expect(css, name).not.toMatch(/(^|[^-])color:\s*var\(--color-accent/m);
      expect(css, name).not.toMatch(/(outline|border)[a-z-]*:[^;]*--color-accent/);
    }
  });

  it("fill with gold only on button-primary and the accepted-deviation-alert band", async () => {
    const GOLD_SELECTORS = /^(\.button-primary|\.accepted-deviation-alert)(:hover)?$/;
    for (const [name, css] of await stylesheets()) {
      for (const rule of rules(css)) {
        if (rule.body.includes("--color-accent")) {
          const selectors = rule.selector.split(",").map((s) => s.trim());
          for (const selector of selectors) expect(selector, name).toMatch(GOLD_SELECTORS);
          expect(rule.body, name).toMatch(/^\s*background:\s*var\(--color-accent(-strong)?\);/m);
        }
      }
    }
  });

  it("never animates or transitions the accepted-deviation-alert band's rules (the pause/hide rule holds vacuously)", async () => {
    for (const [name, css] of await stylesheets()) {
      for (const rule of rules(css)) {
        if (!rule.selector.includes("accepted-deviation-alert")) continue;
        expect(rule.body, name).not.toMatch(/\b(animation|transition)\b/);
      }
    }
  });

  it("set the current nav destination at weight 600 and never in gold", async () => {
    const all = (await stylesheets()).map(([, css]) => css).join("\n");
    const current = rules(all).find((r) => r.selector.includes('[aria-current="page"]'));
    expect(current?.body).toMatch(/font-weight:\s*var\(--type-label-strong-weight\)/);
    expect(current?.body).not.toContain("accent");
    expect(tokenCss()).toContain("--type-label-strong-weight: 600;");
  });

  it("use no all-caps transform and no positive tabindex anywhere in the panel source", async () => {
    for (const file of await sourceFiles()) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/text-transform:\s*uppercase/i);
      expect(text, file).not.toMatch(/tabIndex=\{?["']?[1-9]/);
      expect(text, file).not.toMatch(/737373/);
    }
  });

  it("request no third-party resource (no font CDN)", async () => {
    for (const file of await sourceFiles()) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/fonts\.(googleapis|gstatic)\.com|https?:\/\/(?!127\.0\.0\.1)/);
    }
  });

  it("render the page in English", async () => {
    expect(await readFile(join(SRC, "root.tsx"), "utf8")).toContain('<html lang="en">');
  });
});
