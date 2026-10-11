import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { STANDARDS_COPY } from "../components/standard-form.tsx";
import type { StandardFormActionData } from "../components/standard-form.tsx";
import { action, loader } from "./module-standards.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const OWNER = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const STANDARD = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const HOLDER = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fa";
const OTHER_MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5fb";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = { cookie: `dh_session=${SESSION_TOKEN}` };
const AT = "2026-10-11T09:00:00.000Z";

const module = { id: MODULE, kind: "code-stack", name: "Frontend stack", owner: null, createdAt: AT };
const info = {
  id: STANDARD,
  version: 1,
  module: { id: MODULE, kind: "code-stack", name: "Frontend stack" },
  project: { id: TENANT, name: "Acme" },
  entry: { category: "library", name: "React", versionConstraint: "^18", status: "approved", correctionInstruction: null },
  publishedAt: AT,
  publishedBy: { accountId: OWNER, name: "Sam Owner" },
};
const holder = {
  ...info,
  id: HOLDER,
  version: 3,
  module: { id: OTHER_MODULE, kind: "code-stack", name: "Backend stack" },
  entry: { ...info.entry, name: "react" },
};
const list = { module, standards: [info] };
const form = { intent: "publish", category: "library", name: " React ", versionConstraint: "^18", status: "approved", correctionInstruction: "" };

function loaderArgs(url = `http://x/standards/${MODULE}`, headers: Record<string, string> = COOKIE): LoaderFunctionArgs {
  return { request: new Request(url, { headers }), params: { moduleId: MODULE }, context: {} } as unknown as LoaderFunctionArgs;
}

function actionArgs(fields: Record<string, string>, headers: Record<string, string> = COOKIE): ActionFunctionArgs {
  return {
    request: new Request(`http://x/standards/${MODULE}`, { method: "POST", body: new URLSearchParams(fields), headers }),
    params: { moduleId: MODULE },
    context: {},
  } as unknown as ActionFunctionArgs;
}

/** Answer each registry call in turn. */
function registryAnswers(...answers: [number, unknown][]) {
  const queue = [...answers];
  const fetch = vi.fn(() => {
    const [status, body] = queue.shift() ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function unwrap(result: unknown): { data: StandardFormActionData; status: number } {
  const value = result as { type: string; data: StandardFormActionData; init: { status?: number } | null };
  expect(value.type).toBe("DataWithResponseInit");
  return { data: value.data, status: value.init?.status ?? 200 };
}

function expectRedirect(result: unknown, location: string): void {
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).headers.get("location")).toBe(location);
}

const envelope = (code: string, subject: string) => ({ code, message: "m", subject });
const call = (fetch: ReturnType<typeof registryAnswers>, index = 0) =>
  fetch.mock.calls[index] as unknown as [string, RequestInit];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Module Standards loader", () => {
  it("lists the Module's Standards with the session as a Bearer token", async () => {
    const fetch = registryAnswers([200, list]);
    expect(await loader(loaderArgs())).toEqual({ moduleId: MODULE, list, state: "ok", editId: null });
    const [url, init] = call(fetch);
    expect(url).toMatch(new RegExp(`/v1/modules/${MODULE}/standards$`));
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it("selects the Standard named by ?edit only when it is in the Module", async () => {
    registryAnswers([200, list], [200, list]);
    expect(await loader(loaderArgs(`http://x/standards/${MODULE}?edit=${STANDARD}`))).toMatchObject({ editId: STANDARD });
    expect(await loader(loaderArgs(`http://x/standards/${MODULE}?edit=${HOLDER}`))).toMatchObject({ editId: null });
  });

  it("reports an unknown Module as not found", async () => {
    registryAnswers([404, envelope("module_not_found", "moduleId")]);
    expect(await loader(loaderArgs())).toEqual({ moduleId: MODULE, list: null, state: "not-found", editId: null });
  });

  it.each([
    ["an outage", () => vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))))],
    ["a malformed list", () => registryAnswers([200, { module, standards: [{ ...info, version: 0 }] }])],
    ["a 500", () => registryAnswers([500, envelope("internal_error", "request")])],
  ])("keeps the structure for %s: state unavailable", async (_label, arrange) => {
    arrange();
    expect(await loader(loaderArgs())).toEqual({ moduleId: MODULE, list: null, state: "unavailable", editId: null });
  });

  it("sends a lapsed session, or no session, to sign-in", async () => {
    const fetch = registryAnswers([401, envelope("session_invalid", "session")]);
    expectRedirect(await loader(loaderArgs()), "/sign-in");
    expectRedirect(await loader(loaderArgs(undefined, {})), "/sign-in");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Module Standards action: publish", () => {
  it("posts a new Standard's entry as submitted and reports the five facts", async () => {
    const fetch = registryAnswers([201, info]);
    const { data, status } = unwrap(await action(actionArgs(form)));
    expect(status).toBe(200);
    expect(data.published).toEqual(info);
    expect(data.status).toEqual({
      tone: "notice",
      message: `Published React: Standard ${STANDARD}, version 1, in Module Frontend stack, Project scope Acme (root Project), at ${AT}.`,
    });
    const [url, init] = call(fetch);
    expect(url).toMatch(new RegExp(`/v1/modules/${MODULE}/standards$`));
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      entry: { category: "library", name: " React ", versionConstraint: "^18", status: "approved", correctionInstruction: "" },
    });
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it("publishes the next version of the Standard being edited", async () => {
    const fetch = registryAnswers([201, { ...info, version: 2 }]);
    const { data } = unwrap(await action(actionArgs({ ...form, standardId: STANDARD, status: "required" })));
    expect(data.published?.version).toBe(2);
    const [url, init] = call(fetch);
    expect(url).toMatch(new RegExp(`/v1/standards/${STANDARD}/versions$`));
    expect(JSON.parse(init.body as string)).toMatchObject({ entry: { status: "required" } });
  });

  it.each([
    ["an ownerless Module", 409, envelope("module_has_no_owner", "moduleId"), 409, STANDARDS_COPY.noOwnerDenial],
    ["a non-owner", 403, envelope("not_module_owner", "role"), 403, STANDARDS_COPY.notOwnerDenial],
    ["an unknown Module", 404, envelope("module_not_found", "moduleId"), 404, STANDARDS_COPY.moduleNotFound],
    ["an unknown Standard", 404, envelope("standard_not_found", "standardId"), 404, STANDARDS_COPY.standardNotFound],
    ["a design-system Module", 400, envelope("invalid_input", "entry"), 400, STANDARDS_COPY.designSystemDenial],
  ])("announces %s as a denial and keeps the values", async (_label, registryStatus, body, status, message) => {
    registryAnswers([registryStatus, body]);
    const result = unwrap(await action(actionArgs(form)));
    expect(result.status).toBe(status);
    expect(result.data.status).toEqual({ tone: "denial", message });
    expect(result.data.fieldErrors).toEqual({});
    expect(result.data.values).toMatchObject({ name: " React ", category: "library" });
  });

  it("names both Standards and the slot on a slot conflict, after reading the holder's versions", async () => {
    const fetch = registryAnswers([409, envelope("slot_conflict", HOLDER)], [200, { standardId: HOLDER, versions: [{ ...holder, version: 1, entry: { ...holder.entry, name: "preact" } }, holder] }]);
    const { data, status } = unwrap(await action(actionArgs({ ...form, standardId: STANDARD })));
    expect(status).toBe(409);
    expect(data.status).toEqual({
      tone: "denial",
      message:
        `Nothing was published. The library "React" (Standard ${STANDARD}) is in the same Conflict slot ` +
        `(code stack, library, "react") as Standard ${HOLDER}, library "react" in Module Backend stack, at the root Project.`,
    });
    expect(data.status?.message).not.toContain("preact");
    expect(call(fetch, 1)[0]).toMatch(new RegExp(`/v1/standards/${HOLDER}/versions$`));
  });

  it("names the holder by id when its versions cannot be read", async () => {
    registryAnswers([409, envelope("slot_conflict", HOLDER)], [500, {}]);
    const { data } = unwrap(await action(actionArgs(form)));
    expect(data.status?.message).toBe(
      `Nothing was published. The library "React" is in the same Conflict slot as Standard ${HOLDER} at the root Project.`,
    );
  });

  it.each([["category"], ["name"], ["versionConstraint"], ["status"], ["correctionInstruction"]] as const)(
    "puts ink text under %s and keeps every value",
    async (subject) => {
      registryAnswers([400, envelope("invalid_input", subject)]);
      const { data, status } = unwrap(await action(actionArgs({ ...form, name: "x".repeat(201) })));
      expect(status).toBe(400);
      expect(data.status).toBeNull();
      expect(data.fieldErrors).toEqual({ [subject]: STANDARDS_COPY.fieldErrors[subject] });
      expect(data.values).toEqual({
        category: "library",
        name: "x".repeat(201),
        versionConstraint: "^18",
        status: "approved",
        correctionInstruction: "",
        standardId: "",
      });
    },
  );

  it.each([
    ["an outage", () => vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))))],
    ["a 404 from a misrouted registry URL", () => registryAnswers([404, envelope("not_found", "/v1/x")])],
    ["an unexpected field subject", () => registryAnswers([400, envelope("invalid_input", "body")])],
    ["a 500", () => registryAnswers([500, envelope("internal_error", "request")])],
  ])("says Standards are unavailable for %s", async (_label, arrange) => {
    arrange();
    const { data, status } = unwrap(await action(actionArgs(form)));
    expect(status).toBe(503);
    expect(data.status).toEqual({ tone: "denial", message: STANDARDS_COPY.actionUnavailable });
  });

  it("sends a lapsed session, or no session, to sign-in", async () => {
    const fetch = registryAnswers([401, envelope("session_invalid", "session")]);
    expectRedirect(await action(actionArgs(form)), "/sign-in");
    expectRedirect(await action(actionArgs(form, {})), "/sign-in");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an unknown intent without calling the registry", async () => {
    const fetch = registryAnswers([201, info]);
    const { status } = unwrap(await action(actionArgs({ ...form, intent: "delete-standard" })));
    expect(status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
