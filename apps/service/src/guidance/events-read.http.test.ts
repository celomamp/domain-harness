// HTTP suite for the Guidance-event read endpoint (Story 6.7): an
// in-process `node:http` server (no database — the InMemory twin) behind the
// real read handler over `fetch`. Pins the full matrix: token-gated reads of
// stored events with the application and gaps filters, one indistinguishable
// 401 for every token failure with no content attached, 400s naming the bad
// filter, and 405-on-write with no write handler.
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  encodeRoleTokenBody,
  GUIDANCE_EVENT_READ_PATH,
  isGuidanceEvent,
  toBase64Url,
} from "@domain-harness/contract";
import type { GuidanceRoleTokenPayload, UuidV7 } from "@domain-harness/contract";
import { createInMemoryGuidanceEventStore } from "./events.ts";
import type { GuidanceEventInput } from "./events.ts";
import { handleGuidanceEventRead, isGuidanceEventReadPath } from "./events-read.ts";
import type { GuidanceEventReadDeps } from "./events-read.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const OTHER_TENANT = "018f3d2a-7000-7000-8000-000000000200" as UuidV7;
const APP_A = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const APP_B = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const KEY_ID = "registry-key-2026-10";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { privateKey: rogueKey } = generateKeyPairSync("ed25519");

function mint(payload: GuidanceRoleTokenPayload, key: typeof privateKey = privateKey, keyId: string = KEY_ID): string {
  const body = encodeRoleTokenBody(payload);
  return `${keyId}.${body}.${toBase64Url(sign(null, Buffer.from(body, "utf8"), key).toString("base64"))}`;
}

function freshToken(role: "Buyer" | "Standard owner" | "Builder" = "Standard owner", atMs = Date.now()): string {
  const issued = new Date(atMs).toISOString();
  return mint({
    tenantId: TENANT,
    role,
    issuedAt: issued,
    expiresAt: new Date(atMs + 5 * 60 * 1000).toISOString(),
  });
}

function hit(app: UuidV7): GuidanceEventInput {
  return {
    applicationId: app,
    tool: "code_stack_rule",
    subject: "React",
    outcome: { kind: "hit", standardId: "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8", version: 2 },
    agentTool: null,
    bundleHash: HASH,
  };
}

function miss(app: UuidV7): GuidanceEventInput {
  return {
    applicationId: app,
    tool: "code_stack_rule",
    subject: "Svelte",
    outcome: { kind: "miss" },
    agentTool: null,
    bundleHash: HASH,
  };
}

interface Fixture {
  readonly base: string;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Fixture> {
  const store = createInMemoryGuidanceEventStore();
  await store.appendGuidanceEvent(hit(APP_A));
  await store.appendGuidanceEvent(miss(APP_A));
  await store.appendGuidanceEvent(miss(APP_B));
  const deps: GuidanceEventReadDeps = {
    tenantId: TENANT,
    trustSet: new Map([[KEY_ID, publicKey]]),
    eventStore: store,
  };
  const server: HttpServer = createServer((request: IncomingMessage, response: ServerResponse) => {
    const target = request.url ?? "/";
    const path = new URL(target, "http://guidance.invalid").pathname;
    void handleGuidanceEventRead(deps, request, response, path).then((read) => {
      if (!read) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    base,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

const auth = (token: string | undefined) => (token === undefined ? {} : { authorization: `Bearer ${token}` });

describe("Guidance-event reads", () => {
  it("routes only the read path", () => {
    expect(isGuidanceEventReadPath(GUIDANCE_EVENT_READ_PATH)).toBe(true);
    expect(isGuidanceEventReadPath("/v1/guidance-events/extra")).toBe(false);
    expect(isGuidanceEventReadPath("/v1/standards")).toBe(false);
  });

  it("reads every stored event with a valid token", async () => {
    const { base, close } = await setup();
    try {
      const response = await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}`, { headers: auth(freshToken()) });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(typeof body === "object" && body !== null && Array.isArray((body as { events: unknown }).events)).toBe(true);
      const events = (body as { events: unknown[] }).events;
      expect(events).toHaveLength(3);
      for (const event of events) expect(isGuidanceEvent(event)).toBe(true);
    } finally {
      await close();
    }
  });

  it("filters by application and projects the gaps", async () => {
    const { base, close } = await setup();
    try {
      const token = freshToken("Buyer");
      const appA = await (await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}?applicationId=${APP_A}`, { headers: auth(token) })).json();
      expect((appA as { events: unknown[] }).events).toHaveLength(2);
      const gaps = await (
        await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}?gaps=true`, { headers: auth(token) })
      ).json();
      expect((gaps as { events: unknown[] }).events).toHaveLength(2);
      const noGaps = await (
        await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}?gaps=false`, { headers: auth(token) })
      ).json();
      expect((noGaps as { events: unknown[] }).events).toHaveLength(3);
      const appBGaps = await (
        await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}?applicationId=${APP_B}&gaps=true`, { headers: auth(token) })
      ).json();
      expect((appBGaps as { events: unknown[] }).events).toHaveLength(1);
      const unknown = await (
        await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}?applicationId=018f3d2a-7000-7000-8000-000000009999`, {
          headers: auth(token),
        })
      ).json();
      expect((unknown as { events: unknown[] }).events).toEqual([]);
    } finally {
      await close();
    }
  });

  it("answers one content-free 401 for every token failure", async () => {
    const { base, close } = await setup();
    try {
      const stale = mint({
        tenantId: TENANT,
        role: "Builder",
        issuedAt: "2026-10-16T11:50:00.000Z",
        expiresAt: "2026-10-16T11:55:00.000Z",
      });
      const foreign = mint({ tenantId: OTHER_TENANT, role: "Buyer", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString() });
      const forged = mint(
        { tenantId: TENANT, role: "Builder", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString() },
        rogueKey,
      );
      for (const token of [undefined, "not-a-token", stale, foreign, forged]) {
        const response = await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}`, { headers: auth(token) });
        expect(response.status).toBe(401);
        const body: unknown = await response.json();
        expect(body).toEqual({ code: "session_invalid", message: "the role token is not valid", subject: "session" });
      }
    } finally {
      await close();
    }
  });

  it("answers 400 naming a bad filter, with no content", async () => {
    const { base, close } = await setup();
    try {
      const token = freshToken();
      const badApp = await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}?applicationId=nope`, { headers: auth(token) });
      expect(badApp.status).toBe(400);
      expect(await badApp.json()).toMatchObject({ code: "invalid_input", subject: "applicationId" });
      const badGaps = await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}?gaps=maybe`, { headers: auth(token) });
      expect(badGaps.status).toBe(400);
      expect(await badGaps.json()).toMatchObject({ code: "invalid_input", subject: "gaps" });
    } finally {
      await close();
    }
  });

  it("answers 405 with Allow for a wrong method and 404 off the path", async () => {
    const { base, close } = await setup();
    try {
      const written = await fetch(`${base}${GUIDANCE_EVENT_READ_PATH}`, { method: "POST", headers: auth(freshToken()) });
      expect(written.headers.get("allow")).toBe("GET");
      expect(written.status).toBe(405);
      expect(await written.json()).toMatchObject({ code: "method_not_allowed" });
      const off = await fetch(`${base}/v1/nope`, { headers: auth(freshToken()) });
      expect(off.status).toBe(404);
    } finally {
      await close();
    }
  });
});
