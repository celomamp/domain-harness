import { describe, expect, it } from "vitest";
import { agentToolName, formatDate, formatDateTime } from "./format.ts";

describe("format", () => {
  it("formats a UTC instant as a short date", () => {
    expect(formatDate("2026-10-13T23:30:00.000Z")).toBe("13 Oct 2026");
  });
  it("formats a UTC instant with the time", () => {
    expect(formatDateTime("2026-10-13T23:30:00.000Z")).toBe("13 Oct 2026, 23:30 UTC");
  });
  it("returns an em dash for an unparseable value", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("agentToolName", () => {
  it("names the known agent tools and passes any other value through", () => {
    expect(agentToolName("claude-code")).toBe("Claude Code");
    expect(agentToolName("cursor")).toBe("Cursor");
    expect(agentToolName("windsurf")).toBe("windsurf");
  });
});
