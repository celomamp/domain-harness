/**
 * HTTP suite for the Company Read API (Story 4.6): an in-process `node:http`
 * server (no database — the InMemory twin) behind the real read handler over
 * `fetch`. Pins the full matrix: credentialed reads of the published
 * Standards and one Project's Effective Standard set quoting the
 * active-pointer hash, Guidance parity (a bound app's `hit` is in the read
 * set; full-set equality with the shared derivation), indistinguishable 401s,
 * 405-on-write with no write handler, unknown/malformed Project 404s, no
 * bundle 404, invalid payload 500 and core's 409 as is.
 */
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  READ_API_PATHS,
  effectiveStandardsPath,
  isReadEffectiveSetResponse,
  isReadStandardsResponse,
} from "@domain-harness/contract";
import type { SignedStandardBundle, StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import { createInMemoryBundleRecordStore } from "../bundles/store.ts";
import { bundleHashOf } from "../bundles/verify.ts";
import { makeBundlePayload, makeSigningKey, signPayload } from "../bundles/test-fixtures.ts";
import { createInMemoryGuidanceEventStore } from "../guidance/events.ts";
import { createInMemoryGuidanceIdentityStore } from "../guidance/store.ts";
import { serveGuidanceCall } from "../guidance/serve.ts";
import { bundledState } from "../bundles/puller.ts";
import { handleReadRequest } from "./server.ts";
import type { ReadApiDeps } from "./server.ts";
import { effectiveSetInputOf, joinEffectiveSet } from "./effective.ts";
import { resolveEffectiveSet } from "@domain-harness/core";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const ROOT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const WEB = "018f3d2a-7000-7000-8000-000000000112" as UuidV7;
const FP_1 = "1".repeat(64);
const CREDENTIAL = "read-secret-4-6-opaque";

const NOW = "2026-10-14T12:00:00.000Z";
const ISSUED = "2026-10-14T06:00:00.000Z";
const PUBLISHER = { accountId: "018f3d2a-7000-7000-8000-000000000140" as UuidV7, name: "Bea" };

let nextId = 500;
function standardId(): UuidV7 {
  nextId += 1;
  return `018f3d2a-7000-7000-8000-0000000${String(nextId).padStart(5, "0")}` as UuidV7;
}

function libraryStandard(project: UuidV7, name: string): StandardBundlePayload["standards"][number] {
  return {
    id: standardId(),
    version: 1,
    module: { id: "018f3d2a-7000-7000-8000-000000000120" as UuidV7, kind: "code-stack", name: "Backend" },
    project: { id: project, name: project === ROOT ? "Root" : "Web" },
    entry: { category: "library", name, versionConstraint: null, status: "approved", correctionInstruction: null },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

function payloadOf(standards: StandardBundlePayload["standards"] = []): StandardBundlePayload {
  return {
    ...makeBundlePayload({ keyId: "read-http-key", sequence: 1, issuedAt: ISSUED }),
    frozen: false,
    standards,
    tree: {
      rootId: ROOT,
      projects: [
        { id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED },
        { id: WEB, name: "Web", levelName: null, parentId: ROOT, createdAt: ISSUED },
      ],
      lockedRules: [],
    },
    applications: [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true, agentTool: null }],
  };
}

interface Fixture {
  readonly baseUrl: string;
  readonly httpServer: HttpServer;
  readonly hash: string;
}

async function setup(
  payload: StandardBundlePayload,
  overrides: {
    credential?: string;
    activate?: boolean;
    signed?: SignedStandardBundle;
    hash?: string;
    getPinnedBundle?: ReadApiDeps["getPinnedBundle"];
  } = {},
): Promise<Fixture> {
  const signed = overrides.signed ?? signPayload(payload, makeSigningKey("read-http-key"));
  const hash = overrides.hash ?? bundleHashOf(signed);
  const bundleStore = createInMemoryBundleRecordStore();
  if (overrides.activate !== false) {
    await bundleStore.activate(signed, hash, TENANT);
  }
  const deps: ReadApiDeps = {
    tenantId: TENANT,
    readCredential: overrides.credential ?? CREDENTIAL,
    getPinnedBundle:
      overrides.getPinnedBundle ??
      (async (tenantId) => {
        const pointer = await bundleStore.getPointer(tenantId);
        if (pointer === null) return null;
        const pinned = await bundleStore.pinnedBundle(pointer.hash);
        if (pinned === null) return null;
        return { payload: pinned.payload, hash: pointer.hash };
      }),
  };
  const httpServer = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://read.invalid").pathname;
    void handleReadRequest(deps, request, response, path).then((read) => {
      if (!read) {
        const body = JSON.stringify({ code: "not_found", message: "only the Guidance MCP endpoint is served", subject: path });
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
        response.end(body);
      }
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = httpServer.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, httpServer, hash };
}

async function stop(fixture: Fixture): Promise<void> {
  await new Promise<void>((resolve) => {
    fixture.httpServer.close(() => {
      resolve();
    });
  });
}

function authHeaders(token: string | undefined, scheme = "Bearer"): Record<string, string> {
  if (token === undefined) return {};
  return { authorization: `${scheme} ${token}` };
}

describe("the Company Read API over HTTP", () => {
  it("answers the published Standards with the active hash quoted", async () => {
    const react = libraryStandard(ROOT, "React");
    const vue = libraryStandard(WEB, "Vue");
    const fixture = await setup(payloadOf([react, vue]));
    try {
      const response = await fetch(`${fixture.baseUrl}${READ_API_PATHS.standards}`, { headers: authHeaders(CREDENTIAL) });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(isReadStandardsResponse(body)).toBe(true);
      expect(body).toEqual({ bundleHash: fixture.hash, standards: [react, vue] });
    } finally {
      await stop(fixture);
    }
  });

  it("answers the Effective Standard set with the active hash quoted, in core order", async () => {
    const rootReact = libraryStandard(ROOT, "React");
    const webReact = libraryStandard(WEB, "React");
    const fixture = await setup(payloadOf([rootReact, webReact]));
    try {
      const response = await fetch(`${fixture.baseUrl}${effectiveStandardsPath(WEB)}`, { headers: authHeaders(CREDENTIAL) });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(isReadEffectiveSetResponse(body)).toBe(true);
      if (!isReadEffectiveSetResponse(body)) throw new Error("the Effective set failed its guard");
      expect(body.bundleHash).toBe(fixture.hash);
      expect(body.project).toEqual({ id: WEB, name: "Web" });
      expect(body.standards.map((entry) => entry.standard.id)).toEqual([webReact.id]);
      // Full-set equality with the shared derivation (core order, never re-sorted).
      const payload = payloadOf([rootReact, webReact]);
      const joined = joinEffectiveSet(payload, WEB);
      expect(joined.ok).toBe(true);
      if (!joined.ok) throw new Error("the join failed");
      const core = resolveEffectiveSet(effectiveSetInputOf(payload, WEB));
      expect(core.ok).toBe(true);
      if (!core.ok) throw new Error("core failed");
      expect(body.standards.map((entry) => entry.standard.id)).toEqual(core.set.map((entry) => entry.standardId));
      expect(body.standards.map((entry) => entry.standard.id)).toEqual(joined.set.standards.map((entry) => entry.standard.id));
    } finally {
      await stop(fixture);
    }
  });

  it("matches Guidance: every bound hit standard is in the read set for the app's project", async () => {
    const react = libraryStandard(ROOT, "React");
    const payload = payloadOf([react]);
    // One signed bundle serves both surfaces: the Guidance call and the read
    // fixture quote the SAME active-pointer hash by construction.
    const signed = signPayload(payload, makeSigningKey("read-http-key"));
    const hash = bundleHashOf(signed);
    const bundleStore = createInMemoryBundleRecordStore();
    await bundleStore.activate(signed, hash, TENANT);
    const identityStore = createInMemoryGuidanceIdentityStore();
    const eventStore = createInMemoryGuidanceEventStore();
    const result = await serveGuidanceCall({
      headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: FP_1 },
      tool: "code_stack_rule",
      subject: "react",
      tenantId: TENANT,
      now: NOW,
      identityStore,
      eventStore,
      getPinnedBundle: () => Promise.resolve({ payload: signed.payload, hash }),
      getBundledState: (now) => bundledState(bundleStore, TENANT, now),
    });
    expect(result.kind).toBe("hit");
    if (result.kind !== "hit") throw new Error("the bound call missed");
    expect(result.bundleHash).toBe(hash);

    const fixture = await setup(signed.payload, { signed, hash });
    try {
      const response = await fetch(`${fixture.baseUrl}${effectiveStandardsPath(WEB)}`, { headers: authHeaders(CREDENTIAL) });
      const body = (await response.json()) as { standards: readonly { standard: { id: string } }[]; bundleHash: string };
      expect(response.status).toBe(200);
      expect(body.bundleHash).toBe(hash);
      expect(fixture.hash).toBe(hash);
      expect(body.standards.map((entry) => entry.standard.id)).toContain(result.standardId);
      const joined = joinEffectiveSet(signed.payload, WEB);
      expect(joined.ok).toBe(true);
      if (!joined.ok) throw new Error("the join failed");
      expect(body.standards.map((entry) => entry.standard.id)).toEqual(joined.set.standards.map((entry) => entry.standard.id));
    } finally {
      await stop(fixture);
    }
  });

  it("refuses missing, malformed and wrong credentials with one indistinguishable 401 envelope", async () => {
    const fixture = await setup(payloadOf([libraryStandard(ROOT, "React")]));
    try {
      const url = `${fixture.baseUrl}${READ_API_PATHS.standards}`;
      const missing = await fetch(url);
      const malformed = await fetch(url, { headers: { authorization: "Token abc" } });
      const blank = await fetch(url, { headers: { authorization: "Bearer " } });
      const wrong = await fetch(url, { headers: authHeaders("wrong-secret") });
      for (const response of [missing, malformed, blank, wrong]) {
        expect(response.status).toBe(401);
      }
      const bodies = await Promise.all([missing, malformed, blank, wrong].map((r) => r.text()));
      for (const text of bodies) {
        expect(JSON.parse(text)).toEqual({ code: "session_invalid", message: "the service credential is not valid", subject: "session" });
      }
      expect(new Set(bodies).size).toBe(1);
      // The credential check runs before anything is parsed: a bad credential
      // on an unknown project is still 401, never 404.
      const badOnUnknown = await fetch(`${fixture.baseUrl}${effectiveStandardsPath(WEB)}`, { headers: authHeaders("wrong-secret") });
      expect(badOnUnknown.status).toBe(401);
    } finally {
      await stop(fixture);
    }
  });

  it("accepts the Bearer scheme in any case", async () => {
    const fixture = await setup(payloadOf([libraryStandard(ROOT, "React")]));
    try {
      const response = await fetch(`${fixture.baseUrl}${READ_API_PATHS.standards}`, { headers: authHeaders(CREDENTIAL, "bearer") });
      expect(response.status).toBe(200);
    } finally {
      await stop(fixture);
    }
  });

  it("refuses every write method on either read path with 405 and no write handler", async () => {
    const fixture = await setup(payloadOf([libraryStandard(ROOT, "React")]));
    try {
      for (const path of [READ_API_PATHS.standards, effectiveStandardsPath(WEB)]) {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          const response = await fetch(`${fixture.baseUrl}${path}`, { method, headers: authHeaders(CREDENTIAL) });
          expect(response.status).toBe(405);
          expect(await response.json()).toMatchObject({ code: "method_not_allowed" });
          expect(response.headers.get("allow")).toBe("GET");
        }
      }
    } finally {
      await stop(fixture);
    }
  });

  it("answers an unknown or malformed Project id with 404 project_not_found", async () => {
    const fixture = await setup(payloadOf([libraryStandard(ROOT, "React")]));
    try {
      const unknown = await fetch(`${fixture.baseUrl}${effectiveStandardsPath("018f3d2a-7000-7000-8000-000000000999")}`, {
        headers: authHeaders(CREDENTIAL),
      });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({ code: "project_not_found", subject: "projectId" });

      const malformed = await fetch(`${fixture.baseUrl}/v1/projects/not-a-uuid/effective-standards`, {
        headers: authHeaders(CREDENTIAL),
      });
      expect(malformed.status).toBe(404);
      expect(await malformed.json()).toMatchObject({ code: "project_not_found", subject: "projectId" });
    } finally {
      await stop(fixture);
    }
  });

  it("answers no active bundle with 404 not_found subject bundle", async () => {
    const fixture = await setup(payloadOf([]), { activate: false });
    try {
      const standards = await fetch(`${fixture.baseUrl}${READ_API_PATHS.standards}`, { headers: authHeaders(CREDENTIAL) });
      expect(standards.status).toBe(404);
      expect(await standards.json()).toMatchObject({ code: "not_found", subject: "bundle" });
      const effective = await fetch(`${fixture.baseUrl}${effectiveStandardsPath(WEB)}`, { headers: authHeaders(CREDENTIAL) });
      expect(effective.status).toBe(404);
      expect(await effective.json()).toMatchObject({ code: "not_found", subject: "bundle" });
    } finally {
      await stop(fixture);
    }
  });

  it("answers an invalid stored payload with 500 bundle_unreadable subject bundle", async () => {
    const valid = payloadOf([libraryStandard(ROOT, "React")]);
    const dropped = { ...valid } as Record<string, unknown>;
    delete dropped["acceptedDeviations"];
    const invalid = dropped as unknown as StandardBundlePayload;
    const fixture = await setup(invalid);
    try {
      const standards = await fetch(`${fixture.baseUrl}${READ_API_PATHS.standards}`, { headers: authHeaders(CREDENTIAL) });
      expect(standards.status).toBe(500);
      expect(await standards.json()).toMatchObject({ code: "bundle_unreadable", subject: "bundle" });
      const effective = await fetch(`${fixture.baseUrl}${effectiveStandardsPath(WEB)}`, { headers: authHeaders(CREDENTIAL) });
      expect(effective.status).toBe(500);
      expect(await effective.json()).toMatchObject({ code: "bundle_unreadable", subject: "bundle" });
    } finally {
      await stop(fixture);
    }
  });

  it("passes core's slot_conflict through as is with 409", async () => {
    const a = libraryStandard(WEB, "React");
    const b = { ...libraryStandard(WEB, "react"), id: standardId() };
    const fixture = await setup(payloadOf([a, b]));
    try {
      const response = await fetch(`${fixture.baseUrl}${effectiveStandardsPath(WEB)}`, { headers: authHeaders(CREDENTIAL) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "slot_conflict" });
      // The Standards read still serves: only the conflicted set fails.
      const standards = await fetch(`${fixture.baseUrl}${READ_API_PATHS.standards}`, { headers: authHeaders(CREDENTIAL) });
      expect(standards.status).toBe(200);
    } finally {
      await stop(fixture);
    }
  });

  it("passes core's project_cycle through as is with 409", async () => {
    // Two projects parenting each other pass the bundle guard (one root, all
    // parents listed) while core reports the cycle.
    const projectA = "018f3d2a-7000-7000-8000-000000000113" as UuidV7;
    const projectB = "018f3d2a-7000-7000-8000-000000000114" as UuidV7;
    const base = payloadOf([libraryStandard(ROOT, "React")]);
    const cyclic: StandardBundlePayload = {
      ...base,
      tree: {
        rootId: ROOT,
        projects: [
          { id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED },
          { id: projectA, name: "A", levelName: null, parentId: projectB, createdAt: ISSUED },
          { id: projectB, name: "B", levelName: null, parentId: projectA, createdAt: ISSUED },
        ],
        lockedRules: [],
      },
    };
    const fixture = await setup(cyclic);
    try {
      const response = await fetch(`${fixture.baseUrl}${effectiveStandardsPath(projectA)}`, { headers: authHeaders(CREDENTIAL) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "project_cycle" });
    } finally {
      await stop(fixture);
    }
  });

  it("answers a failing bundle read with 500 bundle_unreadable subject bundle", async () => {
    const fixture = await setup(payloadOf([]), {
      getPinnedBundle: () => Promise.reject(new Error("down")),
    });
    try {
      const standards = await fetch(`${fixture.baseUrl}${READ_API_PATHS.standards}`, { headers: authHeaders(CREDENTIAL) });
      expect(standards.status).toBe(500);
      expect(await standards.json()).toMatchObject({ code: "bundle_unreadable", subject: "bundle" });
      const effective = await fetch(`${fixture.baseUrl}${effectiveStandardsPath(WEB)}`, { headers: authHeaders(CREDENTIAL) });
      expect(effective.status).toBe(500);
      expect(await effective.json()).toMatchObject({ code: "bundle_unreadable", subject: "bundle" });
    } finally {
      await stop(fixture);
    }
  });

  it("keeps the existing 404 for unmatched paths with the MCP surface unchanged", async () => {
    const fixture = await setup(payloadOf([]));
    try {
      const response = await fetch(`${fixture.baseUrl}/v1/nope`, { headers: authHeaders(CREDENTIAL) });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not_found" });
    } finally {
      await stop(fixture);
    }
  });
});
