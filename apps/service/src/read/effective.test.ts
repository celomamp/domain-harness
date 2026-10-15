/**
 * Unit suite for the shared Effective Standard set derivation (Story 4.6):
 * `effectiveSetInputOf` mirrors the `serve.ts` derivation, and
 * `joinEffectiveSet` mirrors the registry join shape — locked winner,
 * component null-status, core order — with core-error passthrough.
 */
import { describe, expect, it } from "vitest";
import { isEffectiveStandardSet } from "@domain-harness/contract";
import type { StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import { resolveEffectiveSet } from "@domain-harness/core";
import { makeBundlePayload } from "../bundles/test-fixtures.ts";
import { effectiveSetInputOf, joinEffectiveSet } from "./effective.ts";

const ROOT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const WEB = "018f3d2a-7000-7000-8000-000000000112" as UuidV7;
const ISSUED = "2026-10-14T06:00:00.000Z";
const PUBLISHER = { accountId: "018f3d2a-7000-7000-8000-000000000140" as UuidV7, name: "Bea" };
const CODE_MODULE = { id: "018f3d2a-7000-7000-8000-000000000120" as UuidV7, kind: "code-stack" as const, name: "Backend" };
const DESIGN_MODULE = { id: "018f3d2a-7000-7000-8000-000000000121" as UuidV7, kind: "design-system" as const, name: "Web" };

let nextId = 400;
function standardId(): UuidV7 {
  nextId += 1;
  return `018f3d2a-7000-7000-8000-0000000${String(nextId).padStart(5, "0")}` as UuidV7;
}

function libraryStandard(id: UuidV7, project: UuidV7, name: string): StandardBundlePayload["standards"][number] {
  return {
    id,
    version: 1,
    module: CODE_MODULE,
    project: { id: project, name: project === ROOT ? "Root" : "Web" },
    entry: { category: "library", name, versionConstraint: null, status: "approved", correctionInstruction: null },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

function componentStandard(id: UuidV7, project: UuidV7, name: string): StandardBundlePayload["standards"][number] {
  return {
    id,
    version: 1,
    module: DESIGN_MODULE,
    project: { id: project, name: "Web" },
    entry: { kind: "component", name, usageRule: `Use ${name} for everything.`, tokens: [], correctionInstruction: null },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

function payloadOf(spec: {
  standards?: StandardBundlePayload["standards"];
  lockedRules?: StandardBundlePayload["tree"]["lockedRules"];
} = {}): StandardBundlePayload {
  return {
    ...makeBundlePayload({ keyId: "effective-test-key", sequence: 1, issuedAt: ISSUED }),
    standards: spec.standards ?? [],
    tree: {
      rootId: ROOT,
      projects: [
        { id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED },
        { id: WEB, name: "Web", levelName: null, parentId: ROOT, createdAt: ISSUED },
      ],
      lockedRules: spec.lockedRules ?? [],
    },
    applications: [],
  };
}

describe("effectiveSetInputOf", () => {
  it("derives holders, tree and deduped locked ids in payload order", () => {
    const a = standardId();
    const b = standardId();
    const payload = payloadOf({
      standards: [libraryStandard(a, ROOT, "React"), libraryStandard(b, WEB, "Vue")],
      lockedRules: [
        { standardId: b, projectId: WEB, markedAt: ISSUED, markedBy: PUBLISHER },
        { standardId: b, projectId: WEB, markedAt: ISSUED, markedBy: PUBLISHER },
        { standardId: a, projectId: ROOT, markedAt: ISSUED, markedBy: PUBLISHER },
      ],
    });
    const input = effectiveSetInputOf(payload, WEB);
    expect(input.projectId).toBe(WEB);
    expect(input.projects).toEqual([
      { id: ROOT, parentId: null },
      { id: WEB, parentId: ROOT },
    ]);
    expect(input.standards.map((holder) => holder.standardId)).toEqual([a, b]);
    expect(input.standards[0]).toMatchObject({ projectId: ROOT });
    expect(input.lockedStandardIds).toEqual([b, a]);
  });
});

describe("joinEffectiveSet", () => {
  it("joins the registry shape: live StandardInfo, source names, null status for components, core order", () => {
    const reactRoot = standardId();
    const reactWeb = standardId();
    const button = standardId();
    const payload = payloadOf({
      standards: [
        libraryStandard(reactRoot, ROOT, "React"),
        libraryStandard(reactWeb, WEB, "React"),
        componentStandard(button, WEB, "Button"),
      ],
    });
    const joined = joinEffectiveSet(payload, WEB);
    expect(joined.ok).toBe(true);
    if (!joined.ok) throw new Error("the join failed");
    expect(isEffectiveStandardSet(joined.set)).toBe(true);
    expect(joined.set.project).toEqual({ id: WEB, name: "Web" });
    // Core order: Module kind, slot kind, normalised name, Standard id.
    const core = resolveEffectiveSet(effectiveSetInputOf(payload, WEB));
    expect(core.ok).toBe(true);
    if (!core.ok) throw new Error("core failed");
    expect(joined.set.standards.map((entry) => entry.standard.id)).toEqual(core.set.map((entry) => entry.standardId));
    // The WEB-scoped React wins over the ROOT one; the component carries null status.
    const react = joined.set.standards.find((entry) => entry.slot.name === "React");
    expect(react?.standard.id).toBe(reactWeb);
    expect(react?.sourceProject).toEqual({ id: WEB, name: "Web" });
    expect(react?.status).toBe("approved");
    expect(react?.locked).toBe(false);
    const component = joined.set.standards.find((entry) => entry.slot.name === "Button");
    expect(component?.status).toBeNull();
  });

  it("marks the locked winner from the entry and never re-sorts core's order", () => {
    const rootLib = standardId();
    const webLib = standardId();
    const payload = payloadOf({
      standards: [libraryStandard(rootLib, ROOT, "Lodash"), libraryStandard(webLib, WEB, "Lodash")],
      lockedRules: [{ standardId: rootLib, projectId: ROOT, markedAt: ISSUED, markedBy: PUBLISHER }],
    });
    const joined = joinEffectiveSet(payload, WEB);
    expect(joined.ok).toBe(true);
    if (!joined.ok) throw new Error("the join failed");
    expect(joined.set.standards).toHaveLength(1);
    expect(joined.set.standards[0]).toMatchObject({ locked: true, standard: { id: rootLib } });
  });

  it("passes core's slot_conflict error through as is", () => {
    const a = standardId();
    const b = standardId();
    const payload = payloadOf({
      standards: [libraryStandard(a, WEB, "React"), libraryStandard(b, WEB, "react")],
    });
    const joined = joinEffectiveSet(payload, WEB);
    expect(joined.ok).toBe(false);
    if (joined.ok) throw new Error("the conflict resolved");
    expect(joined.error.code).toBe("slot_conflict");
  });

  it("passes core's project_not_found through for a project outside the tree", () => {
    const payload = payloadOf({ standards: [libraryStandard(standardId(), ROOT, "React")] });
    const joined = joinEffectiveSet(payload, "018f3d2a-7000-7000-8000-000000000999");
    expect(joined.ok).toBe(false);
    if (joined.ok) throw new Error("the unknown project resolved");
    expect(joined.error).toMatchObject({ code: "project_not_found", subject: "projectId" });
  });
});
