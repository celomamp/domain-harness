import { describe, expect, it } from "vitest";
import { codeStackSlot, designSystemSlot, entrySlot, formatSlot, normalizeSlotName, sameSlot, validatePublication } from "./index.ts";
import type { ConflictSlot, SlotHolder } from "./index.ts";

const ROOT = "root-project";
const OTHER_PROJECT = "other-project";

const holder = (standardId: string, slot: ConflictSlot, projectId = ROOT): SlotHolder => ({ standardId, projectId, slot });
const library = (name: string): ConflictSlot => ({ moduleKind: "code-stack", slotKind: "library", name });

describe("Conflict slot", () => {
  it("is (code stack, category, name) for a code-stack entry", () => {
    expect(codeStackSlot({ category: "framework", name: "Next.js" })).toEqual({
      moduleKind: "code-stack",
      slotKind: "framework",
      name: "Next.js",
    });
  });

  it("compares names trimmed, NFC and case-insensitively", () => {
    expect(normalizeSlotName("  React ")).toBe("react");
    expect(normalizeSlotName("Café")).toBe(normalizeSlotName("CAFÉ"));
    expect(sameSlot(library("React"), library(" REACT "))).toBe(true);
    expect(sameSlot(library("React"), library("Preact"))).toBe(false);
  });

  it("never matches across slot kinds or Module kinds", () => {
    expect(sameSlot(library("react"), { moduleKind: "code-stack", slotKind: "framework", name: "react" })).toBe(false);
    expect(sameSlot(library("react"), { moduleKind: "design-system", slotKind: "library", name: "react" })).toBe(false);
    expect(sameSlot(library("primary"), { moduleKind: "design-system", slotKind: "token", name: "primary" })).toBe(false);
  });

  it("formats a slot in panel wording", () => {
    expect(formatSlot(library(" React "))).toBe('(code stack, library, "React")');
    expect(formatSlot({ moduleKind: "design-system", slotKind: "token", name: "primary" })).toBe(
      '(design system, token, "primary")',
    );
  });
});

describe("validatePublication", () => {
  it("passes an empty live set and distinct slots", () => {
    expect(validatePublication([], holder("b", library("react")))).toEqual({ ok: true });
    expect(validatePublication([holder("a", library("vue"))], holder("b", library("react")))).toEqual({ ok: true });
  });

  it("lets library react, framework react and a design-system react be live together", () => {
    const live = [
      holder("a", library("react")),
      holder("b", { moduleKind: "code-stack", slotKind: "framework", name: "react" }),
    ];
    expect(validatePublication(live, holder("c", { moduleKind: "design-system", slotKind: "component", name: "react" })))
      .toEqual({ ok: true });
    expect(validatePublication(live.slice(0, 1), live[1] as SlotHolder)).toEqual({ ok: true });
  });

  it("fails when two different Standards hold equal slots at one scope, naming both", () => {
    const result = validatePublication([holder("a", library("react"))], holder("b", library(" REACT ")));
    expect(result).toEqual({
      ok: false,
      standards: ["b", "a"],
      slot: library("react"),
      error: {
        code: "slot_conflict",
        subject: "a",
        message:
          'Standard b and Standard a would both hold the Conflict slot (code stack, library, "react") at Project root-project; nothing was published',
      },
    });
  });

  it("never conflicts when a Standard is re-published in its own slot (its live version is replaced)", () => {
    const live = [holder("a", library("react")), holder("x", library("vue"))];
    expect(validatePublication(live, holder("a", library("React")))).toEqual({ ok: true });
  });

  it("re-validates a Standard that moves into a slot held by another", () => {
    const live = [holder("a", library("react")), holder("b", library("vue"))];
    const result = validatePublication(live, holder("b", library("react")));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.standards).toEqual(["b", "a"]);
  });

  it("frees the old slot when a Standard moves away from it", () => {
    const live = [holder("a", library("react"))];
    expect(validatePublication(live, holder("a", library("preact")))).toEqual({ ok: true });
  });

  it("does not compare different Project scopes", () => {
    expect(validatePublication([holder("a", library("react"), OTHER_PROJECT)], holder("b", library("react")))).toEqual({
      ok: true,
    });
  });

  it("reports a conflict already inside the rest of the set rather than passing it", () => {
    const live = [holder("a", library("react")), holder("b", library("React"))];
    const result = validatePublication(live, holder("c", library("vue")));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.subject).toBe("a");
  });
});

describe("Design-system slots (Story 1.6)", () => {
  const button = { kind: "component", name: "Button", usageRule: "Use", tokens: [], correctionInstruction: null } as const;
  const token = { kind: "token", name: "primary", status: "required" } as const;
  const muiImport = { kind: "import", specifier: "@mui/material", status: "prohibited" } as const;

  it("is (design system, entry kind, name or specifier)", () => {
    expect(designSystemSlot(button)).toEqual({ moduleKind: "design-system", slotKind: "component", name: "Button" });
    expect(designSystemSlot(muiImport)).toEqual({ moduleKind: "design-system", slotKind: "import", name: "@mui/material" });
  });

  it("dispatches on the entry shape", () => {
    expect(entrySlot(token)).toEqual({ moduleKind: "design-system", slotKind: "token", name: "primary" });
    expect(
      entrySlot({ category: "library", name: "primary", versionConstraint: null, status: "approved", correctionInstruction: null }),
    ).toEqual(library("primary"));
  });

  it("lets token primary and library primary be live together", () => {
    expect(validatePublication([holder("a", library("primary"))], holder("b", entrySlot(token)))).toEqual({ ok: true });
  });

  it("lets a component and a token share a name", () => {
    const live = [holder("a", entrySlot({ ...button, name: "primary" }))];
    expect(validatePublication(live, holder("b", entrySlot(token)))).toEqual({ ok: true });
  });

  it("fails two components Button and button in different Standards, naming both", () => {
    const result = validatePublication([holder("a", entrySlot(button))], holder("b", entrySlot({ ...button, name: "button" })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.standards).toEqual(["b", "a"]);
      expect(result.error.subject).toBe("a");
      expect(result.error.message).toContain('(design system, component, "Button")');
    }
  });

  it("fails an import specifier clash", () => {
    const result = validatePublication(
      [holder("a", entrySlot(muiImport))],
      holder("b", entrySlot({ ...muiImport, specifier: " @MUI/material ", status: "required" })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.standards).toEqual(["b", "a"]);
  });
});
