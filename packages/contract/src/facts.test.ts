import { describe, expect, it } from "vitest";
import {
  EXTRACTOR_VERSION,
  FACT_SCHEMA_MAJOR,
  FACT_SCHEMA_VERSION,
  isRevisionFacts,
  type RevisionFacts,
} from "./index.ts";

const validFacts: RevisionFacts = {
  extractorVersion: EXTRACTOR_VERSION,
  schemaVersion: FACT_SCHEMA_VERSION,
  schemaMajor: FACT_SCHEMA_MAJOR,
  dependencies: [
    { name: "react", version: "18.2.0" },
    { name: "@types/node", version: "20.0.0" },
  ],
  imports: [{ specifier: "react" }, { specifier: "./helpers" }],
  tokens: [{ name: "--color-primary" }, { name: "--spacing-md" }],
  unreadable: [{ path: "broken.json", reason: "not valid JSON" }],
};

describe("fact schema contract", () => {
  it("exposes the schema and extractor version constants", () => {
    expect(FACT_SCHEMA_VERSION).toBe("1.0.0");
    expect(FACT_SCHEMA_MAJOR).toBe(1);
    expect(EXTRACTOR_VERSION).toBe("1.0.0");
  });

  it("round-trips a valid facts object through isRevisionFacts", () => {
    const serialized = JSON.stringify(validFacts);
    const parsed = JSON.parse(serialized) as unknown;
    expect(isRevisionFacts(parsed)).toBe(true);
  });

  it("rejects malformed facts objects", () => {
    expect(isRevisionFacts(null)).toBe(false);
    expect(isRevisionFacts("facts")).toBe(false);
    expect(isRevisionFacts([])).toBe(false);
    expect(isRevisionFacts({})).toBe(false);

    const missingVersion = { ...validFacts, schemaVersion: undefined } as unknown;
    expect(isRevisionFacts(missingVersion)).toBe(false);

    const wrongMajor = { ...validFacts, schemaMajor: "1" } as unknown;
    expect(isRevisionFacts(wrongMajor)).toBe(false);

    const badDependency = {
      ...validFacts,
      dependencies: [{ name: "react" }],
    } as unknown;
    expect(isRevisionFacts(badDependency)).toBe(false);

    const badImport = {
      ...validFacts,
      imports: [{ specifier: 123 }],
    } as unknown;
    expect(isRevisionFacts(badImport)).toBe(false);

    const badToken = {
      ...validFacts,
      tokens: [{ name: null }],
    } as unknown;
    expect(isRevisionFacts(badToken)).toBe(false);

    const badUnreadable = {
      ...validFacts,
      unreadable: [{ path: "x" }],
    } as unknown;
    expect(isRevisionFacts(badUnreadable)).toBe(false);

    const extraKey = { ...validFacts, extra: true } as unknown;
    expect(isRevisionFacts(extraKey)).toBe(false);

    const wrongMajorNumber = { ...validFacts, schemaMajor: 2 } as unknown;
    expect(isRevisionFacts(wrongMajorNumber)).toBe(false);

    const wrongMajorVersion = { ...validFacts, schemaVersion: "2.0.0" } as unknown;
    expect(isRevisionFacts(wrongMajorVersion)).toBe(false);
  });
});
