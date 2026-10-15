import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UuidV7 } from "@domain-harness/contract";
import {
  createFileBindingLedger,
  readBinding,
  readBindingFile,
  writeBinding,
  writeBindingFile,
} from "./binding-file.ts";

const APP = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const OTHER_APP = "018f3d2a-7000-7000-8000-0000000000e1" as UuidV7;
const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "dh-binding-"));
}

describe("binding-file", () => {
  it("reads a missing file as an empty ledger", () => {
    const path = join(scratch(), "binding.json");
    expect(readBindingFile(path)).toEqual({ bindings: {}, refusals: [] });
    expect(readBinding(path, APP)).toBeNull();
  });

  it("binds on first use and passes through the same fingerprint", async () => {
    const dir = scratch();
    const path = join(dir, "binding.json");
    const ledger = createFileBindingLedger(path);
    expect(await ledger.getBinding(APP)).toBeNull();
    const first = await ledger.bindApplication(APP, FP_A);
    expect(first).toEqual({ applicationId: APP, fingerprint: FP_A });
    expect(await ledger.getBinding(APP)).toEqual({
      applicationId: APP,
      fingerprint: FP_A,
    });
    const again = await ledger.bindApplication(APP, FP_A);
    expect(again).toEqual({ applicationId: APP, fingerprint: FP_A });
    expect(readBinding(path, APP)).toEqual({
      applicationId: APP,
      fingerprint: FP_A,
    });
  });

  it("never overwrites an existing binding (TOFU pass-through)", () => {
    const dir = scratch();
    const path = join(dir, "binding.json");
    expect(writeBinding(path, APP, FP_A)).toEqual({
      applicationId: APP,
      fingerprint: FP_A,
    });
    expect(writeBinding(path, APP, FP_B)).toEqual({
      applicationId: APP,
      fingerprint: FP_A,
    });
    expect(readBinding(path, APP)?.fingerprint).toBe(FP_A);
  });

  it("tolerates a corrupt file and heals it on the next bind", () => {
    const dir = scratch();
    const path = join(dir, "binding.json");
    writeFileSync(path, "{corrupt");
    expect(readBindingFile(path)).toEqual({ bindings: {}, refusals: [] });
    expect(readBinding(path, APP)).toBeNull();
    expect(writeBinding(path, APP, FP_A)?.fingerprint).toBe(FP_A);
    expect(readBinding(path, APP)?.fingerprint).toBe(FP_A);
  });

  it("tolerates non-object content as an empty ledger", () => {
    const dir = scratch();
    const path = join(dir, "binding.json");
    writeFileSync(path, JSON.stringify([1, 2, 3]));
    expect(readBindingFile(path)).toEqual({ bindings: {}, refusals: [] });
    writeFileSync(path, "42");
    expect(readBindingFile(path)).toEqual({ bindings: {}, refusals: [] });
  });

  it("skips malformed binding values while keeping valid ones", () => {
    const dir = scratch();
    const path = join(dir, "binding.json");
    writeFileSync(
      path,
      JSON.stringify({ bindings: { [APP]: FP_A, bad: 42, "": "x" }, refusals: [] }),
    );
    expect(readBinding(path, APP)?.fingerprint).toBe(FP_A);
    expect(readBinding(path, "bad")).toBeNull();
  });

  it("writes atomically with no temp files left behind", () => {
    const dir = scratch();
    const path = join(dir, "nested", "binding.json");
    expect(writeBindingFile(path, { bindings: { [APP]: FP_A }, refusals: [] })).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      bindings: { [APP]: FP_A },
      refusals: [],
    });
    expect(readdirSync(join(dir, "nested")).filter((n) => n.includes(".tmp."))).toEqual([]);
  });

  it("appends refusals without touching bindings", async () => {
    const dir = scratch();
    const path = join(dir, "binding.json");
    const ledger = createFileBindingLedger(path);
    await ledger.bindApplication(APP, FP_A);
    const refusal = await ledger.recordBindingRefusal({
      applicationId: APP,
      presentedFingerprint: FP_B,
      boundFingerprint: FP_A,
    });
    expect(refusal).toEqual({
      applicationId: APP,
      presentedFingerprint: FP_B,
      boundFingerprint: FP_A,
    });
    const file = readBindingFile(path);
    expect(file.bindings[APP]).toBe(FP_A);
    expect(file.refusals).toHaveLength(1);
    expect(file.refusals[0]).toMatchObject({
      applicationId: APP,
      presentedFingerprint: FP_B,
      boundFingerprint: FP_A,
    });
    await ledger.recordBindingRefusal({
      applicationId: OTHER_APP,
      presentedFingerprint: FP_B,
      boundFingerprint: FP_A,
    });
    expect(readBindingFile(path).refusals).toHaveLength(2);
  });

  it("never throws on garbage input", () => {
    const dir = scratch();
    const path = join(dir, "binding.json");
    expect(readBinding("", "")).toBeNull();
    expect(writeBinding(path, "", FP_A)).toBeNull();
    expect(writeBindingFile("", { bindings: {}, refusals: [] })).toBe(false);
  });
});
