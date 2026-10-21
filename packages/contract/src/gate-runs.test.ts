import { describe, expect, it } from "vitest";
import {
  EXTRACTOR_VERSION,
  FACT_SCHEMA_MAJOR,
  FACT_SCHEMA_VERSION,
  GATE_RUN_PATH,
  isCommitSha,
  isGateRunRequest,
  isGateRunResult,
  type GateRunRequest,
  type RevisionFacts,
} from "./index.ts";

const facts: RevisionFacts = {
  extractorVersion: EXTRACTOR_VERSION,
  schemaVersion: FACT_SCHEMA_VERSION,
  schemaMajor: FACT_SCHEMA_MAJOR,
  dependencies: [{ name: "moment", version: "2.30.1" }],
  imports: [{ specifier: "moment" }],
  tokens: [],
  unreadable: [],
};

const request: GateRunRequest = { revision: "a".repeat(40), facts };

describe("hosted Gate-run contract", () => {
  it("names the route", () => {
    expect(GATE_RUN_PATH).toBe("/v1/gate-runs");
  });

  it("accepts SHA-1 and SHA-256 commit ids only", () => {
    expect(isCommitSha("0123456789abcdef0123456789abcdef01234567")).toBe(true);
    expect(isCommitSha("f".repeat(64))).toBe(true);
    expect(isCommitSha("F".repeat(40))).toBe(false);
    expect(isCommitSha("abc123")).toBe(false);
    expect(isCommitSha("HEAD")).toBe(false);
    expect(isCommitSha(null)).toBe(false);
  });

  it("round-trips a request through JSON", () => {
    expect(isGateRunRequest(JSON.parse(JSON.stringify(request)) as unknown)).toBe(true);
  });

  it("refuses unreadable rows, extra keys, bad facts and bad revisions", () => {
    expect(isGateRunRequest({ ...request, facts: { ...facts, unreadable: [{ path: "a.json", reason: "x" }] } })).toBe(false);
    expect(isGateRunRequest({ ...request, source: "const x = 1" })).toBe(false);
    expect(isGateRunRequest({ ...request, facts: { ...facts, schemaMajor: 2 } })).toBe(false);
    expect(isGateRunRequest({ ...request, revision: "main" })).toBe(false);
    expect(isGateRunRequest({ revision: request.revision })).toBe(false);
    expect(isGateRunRequest(null)).toBe(false);
    expect(isGateRunRequest([])).toBe(false);
  });

  it("accepts the three outcomes with consistent exit codes", () => {
    expect(isGateRunResult({ kind: "pass", exitCode: 0, sentence: "pass", deviationLines: [] })).toBe(true);
    expect(isGateRunResult({ kind: "fail", exitCode: 1, sentence: "fail", deviationLines: ["x"] })).toBe(true);
    expect(isGateRunResult({ kind: "refusal", exitCode: 1, sentence: "unbound Application", deviationLines: [] })).toBe(true);
  });

  it("refuses inconsistent or malformed results", () => {
    expect(isGateRunResult({ kind: "pass", exitCode: 1, sentence: "pass", deviationLines: [] })).toBe(false);
    expect(isGateRunResult({ kind: "fail", exitCode: 0, sentence: "fail", deviationLines: [] })).toBe(false);
    expect(isGateRunResult({ kind: "maybe", exitCode: 1, sentence: "x", deviationLines: [] })).toBe(false);
    expect(isGateRunResult({ kind: "pass", exitCode: 0, sentence: "", deviationLines: [] })).toBe(false);
    expect(isGateRunResult({ kind: "pass", exitCode: 0, sentence: "pass", deviationLines: [1] })).toBe(false);
    expect(isGateRunResult({ kind: "pass", exitCode: 0, sentence: "pass", deviationLines: [], extra: true })).toBe(false);
    expect(isGateRunResult(null)).toBe(false);
  });
});
