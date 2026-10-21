import { describe, expect, it } from "vitest";
import type { EffectiveStandard, EffectiveStandardSet, StandardEntry } from "@domain-harness/contract";
import { mintUuidV7 } from "../ids.ts";
import { isNpmPackageName, planBoilerplate } from "./plan.ts";

const PROJECT = { id: mintUuidV7(), name: "Web" };

/** One Effective Standard holding `entry`. */
function effective(entry: StandardEntry): EffectiveStandard {
  const code = "category" in entry;
  return {
    slot: {
      moduleKind: code ? "code-stack" : "design-system",
      slotKind: code ? entry.category : entry.kind,
      name: "kind" in entry && entry.kind === "import" ? entry.specifier : entry.name,
    },
    status: "status" in entry ? entry.status : null,
    standard: {
      id: mintUuidV7(),
      version: 1,
      module: { id: mintUuidV7(), kind: code ? "code-stack" : "design-system", name: "M" },
      project: PROJECT,
      entry,
      publishedAt: "2026-10-13T09:00:00.000Z",
      publishedBy: { accountId: mintUuidV7(), name: "Sam" },
    },
    sourceProject: PROJECT,
    locked: false,
  };
}

const stack = (
  category: "language" | "framework" | "library",
  name: string,
  status: "required" | "approved" | "prohibited",
  versionConstraint: string | null = null,
  correctionInstruction: string | null = null,
): StandardEntry => ({ category, name, versionConstraint, status, correctionInstruction });

const set = (...entries: StandardEntry[]): EffectiveStandardSet => ({ project: PROJECT, standards: entries.map(effective) });

describe("planBoilerplate", () => {
  it("pins required entries only: TypeScript as a dev dependency, libraries by lowercased name", () => {
    const result = planBoilerplate(
      set(
        stack("language", " TypeScript ", "required", "~5.6"),
        stack("library", "React", "required", "^19"),
        stack("framework", "@Remix-run/React", "required"),
        stack("library", "zod", "approved", "^3"),
        stack("library", "lodash", "prohibited", null, "Use native\nArray methods."),
        { kind: "import", specifier: "@acme/ui", status: "required" },
        { kind: "import", specifier: "@old/ui", status: "prohibited" },
        { kind: "token", name: "color.brand", status: "required" },
        { kind: "token", name: "color.legacy", status: "prohibited" },
        { kind: "component", name: "Button", usageRule: "Use for actions", tokens: ["color.brand"], correctionInstruction: null },
      ),
    );
    if (!result.ok) throw new Error(result.error.message);
    const { plan } = result;
    expect(plan.dependencies).toEqual({ "@remix-run/react": "*", react: "^19" });
    expect(Object.keys(plan.dependencies)).toEqual(["@remix-run/react", "react"]);
    expect(plan.devDependencies).toEqual({ typescript: "~5.6" });
    expect(plan.approved).toEqual([{ category: "library", name: "zod", versionConstraint: "^3", correctionInstruction: null }]);
    expect(plan.prohibited).toEqual([
      { category: "library", name: "lodash", versionConstraint: null, correctionInstruction: "Use native\nArray methods." },
    ]);
    expect(plan.designSystem).toEqual({
      requiredImports: ["@acme/ui"],
      prohibitedImports: ["@old/ui"],
      requiredTokens: ["color.brand"],
      prohibitedTokens: ["color.legacy"],
      components: [{ name: "Button", usageRule: "Use for actions", tokens: ["color.brand"] }],
    });
  });

  it("accepts JavaScript with no pin", () => {
    const result = planBoilerplate(set(stack("language", "JavaScript", "required")));
    expect(result).toMatchObject({ ok: true, plan: { dependencies: {}, devDependencies: {} } });
  });

  it("refuses unsupported required entries in one sentence naming each, ending with nothing was generated", () => {
    const result = planBoilerplate(
      set(
        stack("language", "Go", "required"),
        stack("framework", "Spring Boot", "required"),
        stack("library", "react", "required"),
        stack("language", "Rust", "approved"),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "unsupported_ecosystem", subject: "standards" });
    expect(result.error.message).toContain("language Go and framework Spring Boot");
    expect(result.error.message).not.toContain("Rust");
    expect(result.error.message).toMatch(/nothing was generated$/);
    expect(result.error.message.split(". ")).toHaveLength(1);
  });

  it("refuses a pin that is a prohibited entry, case-insensitively", () => {
    const result = planBoilerplate(set(stack("library", "react", "required"), stack("framework", "React", "prohibited")));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "boilerplate_conflict", subject: "standards" });
    expect(result.error.message).toContain("library react");
    expect(result.error.message).toContain("framework React");
    expect(result.error.message).toMatch(/nothing was generated$/);
  });

  it("refuses a prohibited TypeScript when TypeScript is required", () => {
    const result = planBoilerplate(set(stack("language", "TypeScript", "required"), stack("library", "typescript", "prohibited")));
    expect(result).toMatchObject({ ok: false, error: { code: "boilerplate_conflict" } });
  });

  it("refuses two required entries pinning one package to different versions", () => {
    const result = planBoilerplate(set(stack("framework", "React", "required", "^18"), stack("library", "react", "required", "^19")));
    expect(result).toMatchObject({ ok: false, error: { code: "boilerplate_conflict" } });
  });

  it("refuses TypeScript required as a language and as a library at another version", () => {
    const result = planBoilerplate(
      set(stack("language", "TypeScript", "required", "~5.6"), stack("library", "typescript", "required", "^4")),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "boilerplate_conflict" } });
  });

  it("pins one package once when two required entries agree on its version", () => {
    const result = planBoilerplate(set(stack("framework", "React", "required", "^19"), stack("library", "react", "required", "^19")));
    expect(result).toMatchObject({ ok: true, plan: { dependencies: { react: "^19" }, devDependencies: {} } });
  });

  it("checks the ecosystem before conflicts", () => {
    const result = planBoilerplate(
      set(stack("language", "Go", "required"), stack("library", "react", "required"), stack("library", "react", "prohibited")),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported_ecosystem" } });
  });
});

describe("isNpmPackageName", () => {
  it.each(["react", "@acme/ui", "lodash.merge", "a-b_c~d"])("accepts %s", (name) => {
    expect(isNpmPackageName(name)).toBe(true);
  });
  it.each(["spring boot", "", "@acme", "a/b", ".hidden", "_x", "x".repeat(215)])("refuses %j", (name) => {
    expect(isNpmPackageName(name)).toBe(false);
  });
});
