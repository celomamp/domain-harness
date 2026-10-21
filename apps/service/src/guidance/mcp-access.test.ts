// Unit tests for the optional `/mcp` Bearer gate: open when unset, and one
// indistinguishable refusal for a missing, malformed or wrong token.
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { SESSION_INVALID } from "@domain-harness/contract";
import { mcpAccessDenied, mcpAccessGranted } from "./mcp-access.ts";

const TOKEN = "t".repeat(48);

function requestWith(authorization?: string): IncomingMessage {
  return { headers: authorization === undefined ? {} : { authorization } } as IncomingMessage;
}

describe("mcpAccessGranted", () => {
  it("lets every request through when no token is configured", () => {
    expect(mcpAccessGranted(requestWith(), null)).toBe(true);
    expect(mcpAccessGranted(requestWith("Bearer anything"), null)).toBe(true);
  });

  it("grants the exact Bearer token, scheme in any case", () => {
    expect(mcpAccessGranted(requestWith(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
    expect(mcpAccessGranted(requestWith(`bearer ${TOKEN}`), TOKEN)).toBe(true);
  });

  it("refuses a missing, malformed, shorter, longer or different token", () => {
    for (const header of [undefined, TOKEN, `Basic ${TOKEN}`, `Bearer ${TOKEN.slice(1)}`, `Bearer ${TOKEN}x`, `Bearer ${"u".repeat(48)}`]) {
      expect(mcpAccessGranted(requestWith(header), TOKEN)).toBe(false);
    }
  });

  it("refuses with the session_invalid envelope", () => {
    expect(mcpAccessDenied()).toEqual({ code: SESSION_INVALID, message: "the Guidance access token is not valid", subject: "session" });
  });
});
