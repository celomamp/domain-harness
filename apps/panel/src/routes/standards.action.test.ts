import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { MODULES_COPY } from "../components/modules-section.tsx";
import type { ModulesActionData } from "../components/modules-section.tsx";
import { action, loader } from "./standards.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const OWNER = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const BUYER = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = { cookie: `dh_session=${SESSION_TOKEN}` };
const AT = "2026-10-11T09:00:00.000Z";

const module = { id: MODULE, kind: "code-stack", name: "Code stack", owner: null, createdAt: AT };
const owned = {
  ...module,
  owner: { accountId: OWNER, name: "Sam Owner", assignedAt: AT, assignedBy: { accountId: BUYER, name: "Bea Buyer" } },
};
const list = { modules: [module], standardOwners: [{ accountId: OWNER, name: "Sam Owner" }] };

function loaderArgs(headers: Record<string, string> = COOKIE): LoaderFunctionArgs {
  return {
    request: new Request("http://x/standards", { headers }),
    params: {},
    context: {},
  } as unknown as LoaderFunctionArgs;
}

function actionArgs(fields: Record<string, string>, headers: Record<string, string> = COOKIE): ActionFunctionArgs {
  const body = new URLSearchParams(fields);
  return {
    request: new Request("http://x/standards", { method: "POST", body, headers }),
    params: {},
    context: {},
  } as unknown as ActionFunctionArgs;
}

function registryAnswers(status: number, body: unknown) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The `data()` result of the action: its payload and status. */
function unwrap(result: unknown): { data: ModulesActionData; status: number } {
  const value = result as { type: string; data: ModulesActionData; init: { status?: number } | null };
  expect(value.type).toBe("DataWithResponseInit");
  return { data: value.data, status: value.init?.status ?? 200 };
}

function expectRedirect(result: unknown, location: string): void {
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).headers.get("location")).toBe(location);
}

const envelope = (code: string, subject: string) => ({ code, message: "m", subject });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Standards loader", () => {
  it("lists Modules with the session as a Bearer token", async () => {
    const fetch = registryAnswers(200, list);
    expect(await loader(loaderArgs())).toEqual({ list });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/modules$/);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it("keeps the structure when the registry is down: list is null", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    expect(await loader(loaderArgs())).toEqual({ list: null });
  });

  it("treats a malformed list as unavailable", async () => {
    registryAnswers(200, { modules: [{ ...module, kind: "brand" }], standardOwners: [] });
    expect(await loader(loaderArgs())).toEqual({ list: null });
  });

  it("sends a lapsed session to sign-in", async () => {
    registryAnswers(401, envelope("session_invalid", "session"));
    expectRedirect(await loader(loaderArgs()), "/sign-in");
  });

  it("sends a request without a session cookie to sign-in without calling the registry", async () => {
    const fetch = registryAnswers(200, list);
    expectRedirect(await loader(loaderArgs({})), "/sign-in");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Standards action: create-module", () => {
  const create = (name: string, kind = "code-stack") => actionArgs({ intent: "create-module", name, kind });

  it("posts kind and name as submitted and announces the created Module", async () => {
    const fetch = registryAnswers(201, module);
    const { data, status } = unwrap(await action(create(" Code stack ")));
    expect(status).toBe(200);
    expect(data.status).toEqual({ tone: "notice", message: "Module created: Code stack." });
    expect(data.createdId).toBe(MODULE);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/modules$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ kind: "code-stack", name: " Code stack " }));
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it.each([
    ["a bad kind", 400, envelope("invalid_input", "kind"), { kind: MODULES_COPY.kindError }],
    ["a bad name", 400, envelope("invalid_input", "name"), { name: MODULES_COPY.nameError }],
    ["a duplicate name", 409, envelope("module_name_taken", "name"), { name: MODULES_COPY.nameTaken }],
  ])("keeps the values and adds a field error for %s", async (_label, status, body, fieldErrors) => {
    registryAnswers(status, body);
    const result = unwrap(await action(create("code STACK", "brand")));
    expect(result.status).toBe(status);
    expect(result.data.fieldErrors).toEqual(fieldErrors);
    expect(result.data.values).toEqual({ kind: "brand", name: "code STACK" });
    expect(result.data.status).toBeNull();
  });

  it("announces the denial for a non-Buyer", async () => {
    registryAnswers(403, envelope("role_denied", "role"));
    const { data, status } = unwrap(await action(create("Code stack")));
    expect(status).toBe(403);
    expect(data.status).toEqual({
      tone: "denial",
      message: "Only the Buyer can create a Module or assign its Standard owner. Nothing was changed.",
    });
    expect(data.fieldErrors).toEqual({});
  });

  it.each([
    ["an outage", () => vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))))],
    ["a 404 from a misrouted registry URL", () => registryAnswers(404, envelope("not_found", "/v1/modules"))],
    ["a 500", () => registryAnswers(500, envelope("internal_error", "request"))],
  ])("says Modules are unavailable for %s", async (_label, arrange) => {
    arrange();
    const { data, status } = unwrap(await action(create("Code stack")));
    expect(status).toBe(503);
    expect(data.status).toEqual({ tone: "denial", message: MODULES_COPY.actionUnavailable });
  });

  it("sends a lapsed session to sign-in", async () => {
    registryAnswers(401, envelope("session_invalid", "session"));
    expectRedirect(await action(create("Code stack")), "/sign-in");
  });

  it("sends a request without a session cookie to sign-in without calling the registry", async () => {
    const fetch = registryAnswers(201, module);
    expectRedirect(await action(actionArgs({ intent: "create-module", name: "x", kind: "code-stack" }, {})), "/sign-in");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Standards action: assign-owner", () => {
  const assign = (accountId: string, moduleId = MODULE) => actionArgs({ intent: "assign-owner", moduleId, accountId });

  it("posts the account to the Module's owner path and announces the owner", async () => {
    const fetch = registryAnswers(200, owned);
    const { data, status } = unwrap(await action(assign(OWNER)));
    expect(status).toBe(200);
    expect(data.status).toEqual({ tone: "notice", message: "Standard owner of Code stack: Sam Owner." });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/modules/${MODULE}/owner$`));
    expect(init.body).toBe(JSON.stringify({ accountId: OWNER }));
  });

  it("adds a field error under the owner select for an ineligible account", async () => {
    registryAnswers(400, envelope("invalid_input", "accountId"));
    const { data, status } = unwrap(await action(assign("")));
    expect(status).toBe(400);
    expect(data.fieldErrors).toEqual({ accountId: MODULES_COPY.ownerError });
    expect(data.values).toEqual({ moduleId: MODULE, accountId: "" });
  });

  it("announces an unknown Module as a denial", async () => {
    registryAnswers(404, envelope("module_not_found", "moduleId"));
    const { data, status } = unwrap(await action(assign(OWNER, "nope")));
    expect(status).toBe(404);
    expect(data.status).toEqual({ tone: "denial", message: MODULES_COPY.notFound });
  });

  it("announces the denial for a non-Buyer", async () => {
    registryAnswers(403, envelope("role_denied", "role"));
    const { data } = unwrap(await action(assign(OWNER)));
    expect(data.status?.message).toBe(MODULES_COPY.roleDenied);
  });

  it("says Modules are unavailable when the registry cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    const { data, status } = unwrap(await action(assign(OWNER)));
    expect(status).toBe(503);
    expect(data.status?.tone).toBe("denial");
  });
});

describe("Standards action: unknown intent", () => {
  it("refuses without calling the registry", async () => {
    const fetch = registryAnswers(200, {});
    const { status } = unwrap(await action(actionArgs({ intent: "delete-module" })));
    expect(status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
