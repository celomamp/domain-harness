import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  isErrorEnvelope,
  isModuleInfo,
  isModuleList,
  isSessionCreated,
  isSessionInfo,
  isStandardInfo,
  isStandardList,
  isStandardVersionList,
} from "@domain-harness/contract";
import type {
  ModuleInfo,
  ModuleList,
  SessionCreated,
  SessionInfo,
  StandardInfo,
  StandardList,
  StandardVersionList,
} from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import { assertBuyer } from "../modules/service.ts";
import type { ModuleCreateInput, ModuleOwnerAssignInput, ModuleService } from "../modules/service.ts";
import type { SignInLinkReport, SignInService } from "../sign-in/service.ts";
import type { StandardService } from "../standards/service.ts";
import { validatePublishBody } from "../standards/validate.ts";
import { createRegistryServer, MAX_BODY_BYTES } from "./server.ts";
import type { LogEvent } from "./server.ts";

const tenantId = mintUuidV7();
const session: SessionInfo = { accountId: mintUuidV7(), tenantId, role: "Buyer" };
const GOOD_LINK = `${tenantId}.${"L".repeat(43)}`;
const GOOD_SESSION = `${tenantId}.${"S".repeat(43)}`;
const BUILDER_SESSION = `${tenantId}.${"B".repeat(43)}`;
const builder: SessionInfo = { accountId: mintUuidV7(), tenantId, role: "Builder" };
const MODULE_ID = mintUuidV7();
const OWNER_ID = mintUuidV7();
const moduleInfo: ModuleInfo = {
  id: MODULE_ID,
  kind: "code-stack",
  name: "Code stack",
  owner: null,
  createdAt: "2026-10-11T09:00:00.000Z",
};

const STANDARD_ID = mintUuidV7();
const standardInfo: StandardInfo = {
  id: STANDARD_ID,
  version: 1,
  module: { id: MODULE_ID, kind: "code-stack", name: "Code stack" },
  project: { id: mintUuidV7(), name: "Acme" },
  entry: { category: "library", name: "React", versionConstraint: "^18", status: "approved", correctionInstruction: null },
  publishedAt: "2026-10-11T09:00:00.000Z",
  publishedBy: { accountId: OWNER_ID, name: "Sam" },
};

/** A fake service: one known email, one valid link token, one valid session token. */
class FakeService implements SignInService {
  requested: string[] = [];
  requestSignInLinks(email: string): Promise<SignInLinkReport> {
    this.requested.push(email);
    const known = email.trim().toLowerCase() === "bea@acme.io";
    return Promise.resolve({ links: known ? 1 : 0, sent: known ? 1 : 0, failed: 0 });
  }
  createSession(token: string): Promise<SessionCreated> {
    if (token === "boom") return Promise.reject(new Error("driver said bea@acme.io"));
    if (token !== GOOD_LINK) {
      return Promise.reject(new EnvelopeError({ code: "sign_in_link_invalid", message: "invalid", subject: "token" }));
    }
    return Promise.resolve({ sessionToken: GOOD_SESSION, expiresAt: "2026-10-10T12:00:00.000Z", session });
  }
  getSession(token: string): Promise<SessionInfo> {
    if (token === BUILDER_SESSION) return Promise.resolve(builder);
    if (token !== GOOD_SESSION) {
      return Promise.reject(new EnvelopeError({ code: "session_invalid", message: "invalid", subject: "session" }));
    }
    return Promise.resolve(session);
  }
}

/** A fake Module service that records what reached it and enforces the Buyer rule like the real one. */
class FakeModules implements ModuleService {
  calls: unknown[] = [];
  listModules(caller: SessionInfo): Promise<ModuleList> {
    this.calls.push(["list", caller.role]);
    return Promise.resolve({ modules: [moduleInfo], standardOwners: [{ accountId: OWNER_ID, name: "Sam" }] });
  }
  createModule(caller: SessionInfo, input: ModuleCreateInput): Promise<ModuleInfo> {
    this.calls.push(["create", input]);
    assertBuyer(caller);
    if (input.name === "Taken") {
      return Promise.reject(new EnvelopeError({ code: "module_name_taken", message: "m", subject: "name" }));
    }
    if (input.kind !== "code-stack" && input.kind !== "design-system") {
      return Promise.reject(new EnvelopeError({ code: "invalid_input", message: "m", subject: "kind" }));
    }
    return Promise.resolve(moduleInfo);
  }
  assignModuleOwner(caller: SessionInfo, moduleId: string, input: ModuleOwnerAssignInput): Promise<ModuleInfo> {
    this.calls.push(["assign", moduleId, input]);
    assertBuyer(caller);
    if (moduleId !== MODULE_ID) {
      return Promise.reject(new EnvelopeError({ code: "module_not_found", message: "m", subject: "moduleId" }));
    }
    const owner = {
      accountId: OWNER_ID,
      name: "Sam",
      assignedAt: "2026-10-11T09:00:00.000Z",
      assignedBy: { accountId: session.accountId, name: "Bea" },
    };
    return Promise.resolve({ ...moduleInfo, owner });
  }
}

/**
 * A fake Standards service that records what reached it. One Module and one
 * Standard exist; the Buyer session publishes as the owner, the Builder is
 * refused; entry names pick a refusal.
 */
class FakeStandards implements StandardService {
  calls: unknown[] = [];
  listStandards(caller: SessionInfo, moduleId: string): Promise<StandardList> {
    this.calls.push(["list", caller.role, moduleId]);
    if (moduleId !== MODULE_ID) return Promise.reject(notFound("module_not_found", "moduleId"));
    return Promise.resolve({ module: moduleInfo, standards: [standardInfo] });
  }
  listStandardVersions(caller: SessionInfo, standardId: string): Promise<StandardVersionList> {
    this.calls.push(["versions", caller.role, standardId]);
    if (standardId !== STANDARD_ID) return Promise.reject(notFound("standard_not_found", "standardId"));
    return Promise.resolve({ standardId: STANDARD_ID, versions: [standardInfo, { ...standardInfo, version: 2 }] });
  }
  publishStandard(caller: SessionInfo, moduleId: string, body: unknown): Promise<StandardInfo> {
    this.calls.push(["publish", moduleId, body]);
    if (moduleId !== MODULE_ID) return Promise.reject(notFound("module_not_found", "moduleId"));
    return this.publishAs(caller, body, 1);
  }
  publishStandardVersion(caller: SessionInfo, standardId: string, body: unknown): Promise<StandardInfo> {
    this.calls.push(["republish", standardId, body]);
    if (standardId !== STANDARD_ID) return Promise.reject(notFound("standard_not_found", "standardId"));
    return this.publishAs(caller, body, 2);
  }
  private publishAs(caller: SessionInfo, body: unknown, version: number): Promise<StandardInfo> {
    return Promise.resolve().then(() => {
      if (caller.role !== "Buyer") throw new EnvelopeError({ code: "not_module_owner", message: "m", subject: "role" });
      const entry = validatePublishBody(body);
      if (entry.name === "Ownerless") {
        throw new EnvelopeError({ code: "module_has_no_owner", message: "m", subject: "moduleId" });
      }
      if (entry.name === "Taken") throw new EnvelopeError({ code: "slot_conflict", message: "m", subject: STANDARD_ID });
      return { ...standardInfo, version, entry };
    });
  }
}

const notFound = (code: string, subject: string) => new EnvelopeError({ code, message: "m", subject });

describe("registry HTTP API", () => {
  const service = new FakeService();
  const modules = new FakeModules();
  const standards = new FakeStandards();
  const events: LogEvent[] = [];
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createRegistryServer({ signIn: service, modules, standards }, (event) => events.push(event));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    service.requested = [];
    modules.calls = [];
    standards.calls = [];
    events.length = 0;
  });

  const post = (path: string, body: unknown, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    });

  async function expectEnvelope(response: Response, status: number, code: string): Promise<void> {
    expect(response.status).toBe(status);
    const body: unknown = await response.json();
    expect(isErrorEnvelope(body)).toBe(true);
    expect(body).toMatchObject({ code });
  }

  describe("POST /v1/sign-in-links", () => {
    it("answers 202 {} identically for a known and an unknown email, then does the work", async () => {
      const known = await post("/v1/sign-in-links", { email: " Bea@Acme.io " });
      const unknown = await post("/v1/sign-in-links", { email: "nobody@else.io" });
      expect([known.status, unknown.status]).toEqual([202, 202]);
      expect(await known.text()).toBe("{}");
      expect(await unknown.text()).toBe("{}");
      expect(known.headers.get("content-type")).toBe(unknown.headers.get("content-type"));
      await expect.poll(() => service.requested).toEqual([" Bea@Acme.io ", "nobody@else.io"]);
    });

    it("logs counts only, never the address", async () => {
      await post("/v1/sign-in-links", { email: "bea@acme.io" });
      await expect.poll(() => events.some((e) => e["event"] === "sign_in_links")).toBe(true);
      expect(JSON.stringify(events)).not.toMatch(/acme/i);
      expect(events).toContainEqual({ event: "sign_in_links", links: 1, sent: 1, failed: 0 });
    });

    it.each([
      ["a malformed email", { email: "not-an-email" }],
      ["an empty email", { email: "" }],
      ["a missing email", {}],
      ["an extra field", { email: "bea@acme.io", tenantId: "x" }],
      ["a non-object", ["bea@acme.io"]],
      ["invalid JSON", "{ nope"],
    ])("answers 400 invalid_input for %s and does nothing", async (_label, body) => {
      await expectEnvelope(await post("/v1/sign-in-links", body), 400, "invalid_input");
      expect(service.requested).toEqual([]);
    });

    it("answers 413 for a body over the limit", async () => {
      const big = JSON.stringify({ email: `${"a".repeat(MAX_BODY_BYTES)}@x.io` });
      await expectEnvelope(await post("/v1/sign-in-links", big), 413, "payload_too_large");
    });
  });

  describe("POST /v1/sessions", () => {
    it("answers 201 SessionCreated for a valid link token", async () => {
      const response = await post("/v1/sessions", { token: GOOD_LINK });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      expect(isSessionCreated(body)).toBe(true);
    });

    it("answers 401 sign_in_link_invalid for anything else", async () => {
      await expectEnvelope(await post("/v1/sessions", { token: "garbage" }), 401, "sign_in_link_invalid");
    });

    it("answers 400 for a missing token", async () => {
      await expectEnvelope(await post("/v1/sessions", { token: "" }), 400, "invalid_input");
    });

    it("answers 500 internal_error for an unexpected failure without echoing it", async () => {
      const response = await post("/v1/sessions", { token: "boom" });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toMatch(/acme|driver/i);
      expect(JSON.parse(text)).toMatchObject({ code: "internal_error" });
      expect(JSON.stringify(events)).not.toMatch(/acme|driver/i);
    });
  });

  describe("content type", () => {
    it.each([
      ["text/plain", "text/plain"],
      ["form encoding", "application/x-www-form-urlencoded"],
    ])("answers 415 unsupported_media_type for a %s POST and does nothing", async (_label, type) => {
      const response = await post("/v1/sign-in-links", { email: "bea@acme.io" }, { headers: { "content-type": type } });
      await expectEnvelope(response, 415, "unsupported_media_type");
      expect(service.requested).toEqual([]);
    });

    it("accepts application/json with parameters", async () => {
      const response = await post(
        "/v1/sign-in-links",
        { email: "bea@acme.io" },
        { headers: { "content-type": "Application/JSON; charset=utf-8" } },
      );
      expect(response.status).toBe(202);
    });
  });

  describe("GET /v1/session", () => {
    it("answers 200 SessionInfo for a valid bearer token", async () => {
      const response = await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${GOOD_SESSION}` } });
      expect(response.status).toBe(200);
      expect(isSessionInfo(await response.json())).toBe(true);
    });

    it("accepts the bearer scheme in any case", async () => {
      const response = await fetch(`${base}/v1/session`, { headers: { authorization: `bearer ${GOOD_SESSION}` } });
      expect(response.status).toBe(200);
    });

    it.each([
      ["no header", {}],
      ["a non-bearer header", { authorization: `Basic ${GOOD_SESSION}` }],
      ["an unknown token", { authorization: `Bearer ${tenantId}.${"x".repeat(43)}` }],
    ])("answers 401 session_invalid for %s", async (_label, headers) => {
      await expectEnvelope(await fetch(`${base}/v1/session`, { headers }), 401, "session_invalid");
    });
  });

  describe("Modules", () => {
    const buyer = { authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}` };
    const ownerPath = `/v1/modules/${MODULE_ID}/owner`;

    it("GET /v1/modules answers 200 ModuleList for any role", async () => {
      const response = await fetch(`${base}/v1/modules`, { headers: builderAuth });
      expect(response.status).toBe(200);
      expect(isModuleList(await response.json())).toBe(true);
    });

    it("POST /v1/modules answers 201 ModuleInfo for the Buyer and passes kind and name through", async () => {
      const response = await post("/v1/modules", { kind: "code-stack", name: " Code stack " }, { headers: { ...buyer, "content-type": "application/json" } });
      expect(response.status).toBe(201);
      expect(isModuleInfo(await response.json())).toBe(true);
      expect(modules.calls).toEqual([["create", { kind: "code-stack", name: " Code stack " }]]);
    });

    it("POST /v1/modules/{id}/owner answers 200 with the owner", async () => {
      const response = await post(ownerPath, { accountId: OWNER_ID }, { headers: { ...buyer, "content-type": "application/json" } });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(isModuleInfo(body)).toBe(true);
      expect(modules.calls).toEqual([["assign", MODULE_ID, { accountId: OWNER_ID }]]);
    });

    it.each([
      ["create", "/v1/modules", { kind: "code-stack", name: "x" }],
      ["create with a junk body", "/v1/modules", { nope: 1 }],
      ["assign", `/v1/modules/${MODULE_ID}/owner`, { accountId: OWNER_ID }],
      ["assign on a malformed id with a junk body", "/v1/modules/nope/owner", ["x"]],
    ])("answers 403 role_denied to a Builder (%s) before reading the body", async (_label, path, body) => {
      const response = await post(path, body, { headers: { ...builderAuth, "content-type": "application/json" } });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_denied", subject: "role" });
      expect(modules.calls).toEqual([]);
    });

    it.each([
      ["GET /v1/modules", "GET", "/v1/modules"],
      ["POST /v1/modules", "POST", "/v1/modules"],
      ["POST owner", "POST", `/v1/modules/${MODULE_ID}/owner`],
    ])("answers 401 session_invalid without a bearer token (%s)", async (_label, method, path) => {
      const init: RequestInit = method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: "{}" };
      await expectEnvelope(await fetch(`${base}${path}`, init), 401, "session_invalid");
      await expectEnvelope(
        await fetch(`${base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${tenantId}.unknown` } }),
        401,
        "session_invalid",
      );
      expect(modules.calls).toEqual([]);
    });

    it.each([
      ["an extra field", "/v1/modules", { kind: "code-stack", name: "x", id: MODULE_ID }, "id"],
      ["a non-object", "/v1/modules", ["code-stack"], "body"],
      ["an extra owner field", `/v1/modules/${MODULE_ID}/owner`, { accountId: OWNER_ID, assignedBy: OWNER_ID }, "assignedBy"],
    ])("answers 400 invalid_input for %s and calls no service", async (_label, path, body, subject) => {
      const response = await post(path, body, { headers: { ...buyer, "content-type": "application/json" } });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", subject });
      expect(modules.calls).toEqual([]);
    });

    it("maps the service's envelopes: 400 kind, 409 module_name_taken, 404 module_not_found", async () => {
      const headers = { ...buyer, "content-type": "application/json" };
      const badKind = await post("/v1/modules", { kind: "brand", name: "x" }, { headers });
      expect([badKind.status, await badKind.json()]).toMatchObject([400, { code: "invalid_input", subject: "kind" }]);
      const missing = await post("/v1/modules", { name: "x" }, { headers });
      expect([missing.status, await missing.json()]).toMatchObject([400, { subject: "kind" }]);
      const taken = await post("/v1/modules", { kind: "code-stack", name: "Taken" }, { headers });
      expect([taken.status, await taken.json()]).toMatchObject([409, { code: "module_name_taken", subject: "name" }]);
      const unknown = await post(`/v1/modules/${mintUuidV7()}/owner`, { accountId: OWNER_ID }, { headers });
      expect([unknown.status, await unknown.json()]).toMatchObject([404, { code: "module_not_found" }]);
    });

    it("answers 405 with both methods in Allow for PUT /v1/modules, and POST only for the owner route", async () => {
      const modulesPut = await fetch(`${base}/v1/modules`, { method: "PUT", headers: buyer });
      expect(modulesPut.headers.get("allow")).toBe("GET, POST");
      await expectEnvelope(modulesPut, 405, "method_not_allowed");
      const ownerGet = await fetch(`${base}${ownerPath}`, { headers: buyer });
      expect(ownerGet.headers.get("allow")).toBe("POST");
      await expectEnvelope(ownerGet, 405, "method_not_allowed");
    });

    it("logs the owner route by its pattern", async () => {
      await post(ownerPath, { accountId: OWNER_ID }, { headers: { ...buyer, "content-type": "application/json" } });
      await expect.poll(() => events.find((e) => e["event"] === "http_request")).toMatchObject({
        route: "/v1/modules/{id}/owner",
        status: 200,
      });
    });

    it("answers 404 not_found for a path beyond the owner route", async () => {
      await expectEnvelope(await fetch(`${base}/v1/modules/${MODULE_ID}/owner/x`, { headers: buyer }), 404, "not_found");
    });
  });

  describe("Standards", () => {
    const owner = { authorization: `Bearer ${GOOD_SESSION}`, "content-type": "application/json" };
    const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}`, "content-type": "application/json" };
    const listPath = `/v1/modules/${MODULE_ID}/standards`;
    const versionsPath = `/v1/standards/${STANDARD_ID}/versions`;
    const entry = { category: "library", name: " React ", versionConstraint: "^18", status: "approved" };

    it("GET /v1/modules/{id}/standards answers 200 StandardList for any role", async () => {
      const response = await fetch(`${base}${listPath}`, { headers: builderAuth });
      expect(response.status).toBe(200);
      expect(isStandardList(await response.json())).toBe(true);
      expect(standards.calls).toEqual([["list", "Builder", MODULE_ID]]);
    });

    it("GET /v1/standards/{id}/versions answers 200 StandardVersionList for any role", async () => {
      const response = await fetch(`${base}${versionsPath}`, { headers: builderAuth });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(isStandardVersionList(body)).toBe(true);
      expect(standards.calls).toEqual([["versions", "Builder", STANDARD_ID]]);
    });

    it("POST /v1/modules/{id}/standards answers 201 StandardInfo and passes the body through", async () => {
      const response = await post(listPath, { entry }, { headers: owner });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      expect(isStandardInfo(body)).toBe(true);
      expect(body).toMatchObject({ version: 1, entry: { name: "React", correctionInstruction: null } });
      expect(standards.calls).toEqual([["publish", MODULE_ID, { entry }]]);
    });

    it("POST /v1/standards/{id}/versions answers 201 with the next version", async () => {
      const response = await post(versionsPath, { entry: { ...entry, status: "required" } }, { headers: owner });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ id: STANDARD_ID, version: 2, entry: { status: "required" } });
    });

    it.each([
      ["GET list", "GET", listPath],
      ["POST publish", "POST", listPath],
      ["GET versions", "GET", versionsPath],
      ["POST republish", "POST", versionsPath],
    ])("answers 401 session_invalid without a bearer token (%s) and calls no service", async (_label, method, path) => {
      const init: RequestInit =
        method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ entry }) };
      await expectEnvelope(await fetch(`${base}${path}`, init), 401, "session_invalid");
      expect(standards.calls).toEqual([]);
    });

    it("maps the service's envelopes to 403, 404, 409 and 400", async () => {
      const cases: [string, unknown, RequestInit, number, Record<string, string>][] = [
        [listPath, { entry }, { headers: builderAuth }, 403, { code: "not_module_owner", subject: "role" }],
        [`/v1/modules/${mintUuidV7()}/standards`, { entry }, { headers: owner }, 404, { code: "module_not_found" }],
        ["/v1/modules/nope/standards", { entry }, { headers: owner }, 404, { code: "module_not_found" }],
        [`/v1/standards/${mintUuidV7()}/versions`, { entry }, { headers: owner }, 404, { code: "standard_not_found" }],
        [listPath, { entry: { ...entry, name: "Ownerless" } }, { headers: owner }, 409, { code: "module_has_no_owner" }],
        [listPath, { entry: { ...entry, name: "Taken" } }, { headers: owner }, 409, { code: "slot_conflict", subject: STANDARD_ID }],
        [listPath, { entry: { ...entry, name: "" } }, { headers: owner }, 400, { code: "invalid_input", subject: "name" }],
        [listPath, { entry, id: STANDARD_ID }, { headers: owner }, 400, { code: "invalid_input", subject: "id" }],
        [listPath, { entry: { ...entry, owner: "x" } }, { headers: owner }, 400, { code: "invalid_input", subject: "owner" }],
      ];
      for (const [path, body, init, status, expected] of cases) {
        const response = await post(path, body, init);
        expect([path, response.status, await response.json()]).toMatchObject([path, status, expected]);
      }
    });

    it("answers 404 for an unknown Module or Standard on GET", async () => {
      await expectEnvelope(await fetch(`${base}/v1/modules/${mintUuidV7()}/standards`, { headers: owner }), 404, "module_not_found");
      await expectEnvelope(await fetch(`${base}/v1/standards/nope/versions`, { headers: owner }), 404, "standard_not_found");
    });

    it("accepts a body above the old 4 KiB limit (Correction instructions) and refuses one over 16 KiB", async () => {
      expect(MAX_BODY_BYTES).toBe(16 * 1024);
      // The longest valid entry, in four-byte characters, is over 4 KiB of UTF-8.
      const long = {
        entry: { ...entry, name: "\u{1F600}".repeat(200), correctionInstruction: "\u{1F600}".repeat(1000), versionConstraint: "x".repeat(100) },
      };
      expect(Buffer.byteLength(JSON.stringify(long))).toBeGreaterThan(4 * 1024);
      expect((await post(listPath, long, { headers: owner })).status).toBe(201);
      const huge = JSON.stringify({ entry: { ...entry, correctionInstruction: "x".repeat(MAX_BODY_BYTES) } });
      await expectEnvelope(await post(listPath, huge, { headers: owner }), 413, "payload_too_large");
    });

    it("answers 405 with GET, POST in Allow for PUT on both routes", async () => {
      for (const path of [listPath, versionsPath]) {
        const response = await fetch(`${base}${path}`, { method: "PUT", headers: owner });
        expect(response.headers.get("allow")).toBe("GET, POST");
        await expectEnvelope(response, 405, "method_not_allowed");
      }
    });

    it("logs the routes by their patterns, never the ids", async () => {
      await fetch(`${base}${listPath}`, { headers: owner });
      await fetch(`${base}${versionsPath}`, { headers: owner });
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(["/v1/modules/{id}/standards", "/v1/standards/{id}/versions"]);
      expect(JSON.stringify(events)).not.toContain(STANDARD_ID);
    });
  });

  describe("routing", () => {
    it("answers 404 not_found for an unknown path", async () => {
      await expectEnvelope(await fetch(`${base}/v1/nope`), 404, "not_found");
    });

    it("answers 404 for an unparseable request target without crashing", async () => {
      const { request } = await import("node:http");
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: new URL(base).port, path: "http://[", method: "GET" }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(404);
      expect((await fetch(`${base}/v1/nope`)).status).toBe(404);
    });

    it("answers 405 method_not_allowed with Allow for a wrong method", async () => {
      const response = await fetch(`${base}/v1/sign-in-links`);
      expect(response.headers.get("allow")).toBe("POST");
      await expectEnvelope(response, 405, "method_not_allowed");
      await expectEnvelope(await post("/v1/session", {}), 405, "method_not_allowed");
    });

    it("logs the route and status of every request without query strings", async () => {
      await fetch(`${base}/v1/session?token=secret`, { headers: { authorization: `Bearer ${GOOD_SESSION}` } });
      await expect.poll(() => events.find((e) => e["event"] === "http_request")).toMatchObject({
        method: "GET",
        route: "/v1/session",
        status: 200,
      });
      expect(JSON.stringify(events)).not.toContain("secret");
    });
  });
});
