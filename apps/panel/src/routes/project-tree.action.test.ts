import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { PROJECT_TREE_COPY } from "../components/project-tree.tsx";
import type { ProjectTreeActionData } from "../components/project-tree.tsx";
import { action, loader } from "./project-tree.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ROOT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const A = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const B = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = { cookie: `dh_session=${SESSION_TOKEN}` };
const AT = "2026-10-12T09:00:00.000Z";

const root = { id: ROOT, name: "Acme", levelName: null, parentId: null, createdAt: AT };
const a = { id: A, name: "Platform", levelName: "Division", parentId: ROOT, createdAt: AT };
const b = { id: B, name: "Web", levelName: "  Product line ", parentId: A, createdAt: AT };
const tree = { rootId: ROOT, projects: [root, a, b], lockedRules: [] };

function loaderArgs(url = "http://x/projects", headers: Record<string, string> = COOKIE): LoaderFunctionArgs {
  return { request: new Request(url, { headers }), params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

function actionArgs(fields: Record<string, string>, headers: Record<string, string> = COOKIE): ActionFunctionArgs {
  return {
    request: new Request("http://x/projects", { method: "POST", body: new URLSearchParams(fields), headers }),
    params: {},
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

interface DataResult {
  readonly data: ProjectTreeActionData;
  readonly init: { status?: number } | null;
}

const refused = (code: string, subject: string) => ({ code, message: "m", subject });
const create = { intent: "create", name: " Web ", levelName: "  Product line ", parentId: A };
const parent = { intent: "parent", projectId: A, parentId: B };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/projects loader", () => {
  it("returns the tree as a pending promise and the requested selection", async () => {
    const fetch = registryAnswers([200, tree]);
    const result = loader(loaderArgs(`http://x/projects?project=${B}`));
    if (result instanceof Response) throw new Error("expected data");
    expect(result.projectParam).toBe(B);
    expect(result.tree).toBeInstanceOf(Promise);
    expect(await result.tree).toEqual({ kind: "ok", value: tree });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/projects$/);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it("chains the selected Project's Effective Standard set off the tree: the param when in the tree, else the root", async () => {
    const set = { project: { id: B, name: "Web" }, standards: [] };
    const fetch = registryAnswers([200, tree], [200, set]);
    const result = loader(loaderArgs(`http://x/projects?project=${B}`));
    if (result instanceof Response) throw new Error("expected data");
    expect(result.effective).toBeInstanceOf(Promise);
    expect(await result.effective).toEqual({ kind: "ok", value: set });
    expect((fetch.mock.calls[1] as unknown as [string])[0]).toMatch(new RegExp(`/v1/projects/${B}/effective-standards$`));

    const rootSet = { project: { id: ROOT, name: "Acme" }, standards: [] };
    const again = registryAnswers([200, tree], [200, rootSet]);
    const unknown = loader(loaderArgs("http://x/projects?project=nope"));
    if (unknown instanceof Response) throw new Error("expected data");
    expect(await unknown.effective).toEqual({ kind: "ok", value: rootSet });
    expect((again.mock.calls[1] as unknown as [string])[0]).toMatch(new RegExp(`/v1/projects/${ROOT}/effective-standards$`));
  });

  it("answers the set as unavailable, without calling it, when the tree is unavailable", async () => {
    const fetch = registryAnswers([503, {}]);
    const result = loader(loaderArgs());
    if (result instanceof Response) throw new Error("expected data");
    expect(await result.effective).toEqual({ kind: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("redirects to sign-in without a session cookie", () => {
    const result = loader(loaderArgs("http://x/projects", {}));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("/sign-in");
  });
});

describe("/projects action: Locked rules", () => {
  const S = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e601";
  const T = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e602";
  const BUYER = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e603";
  const standard = (id: string, project: { id: string; name: string }, name: string) => ({
    id,
    version: 2,
    module: { id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e604", kind: "code-stack", name: "Stack" },
    project,
    entry: { category: "library", name, versionConstraint: null, status: "prohibited", correctionInstruction: null },
    publishedAt: AT,
    publishedBy: { accountId: BUYER, name: "Sam" },
  });
  const sAtPlatform = standard(S, { id: A, name: "Platform" }, "X");
  const tAtWeb = standard(T, { id: B, name: "Web" }, "x");
  const state = (locked: boolean) => ({ standard: sAtPlatform, locked, changedAt: AT, changedBy: { accountId: BUYER, name: "Bea" } });
  const lock = (locked: string, standardId = S) => ({ intent: "lock", standardId, locked });

  it("marks a Locked rule with { locked: true } and names the slot and Project", async () => {
    const fetch = registryAnswers([200, state(true)]);
    const result = (await action(actionArgs(lock("true")))) as unknown as DataResult;
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/standards/${S}/locked-rule$`));
    expect(init.body).toBe(JSON.stringify({ locked: true }));
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(result.data).toMatchObject({
      intent: "lock",
      status: { tone: "notice", message: 'Marked (code stack, library, "X") on Platform as a Locked rule.' },
    });
  });

  it("removes a Locked rule with { locked: false } and says so", async () => {
    const fetch = registryAnswers([200, state(false)]);
    const result = (await action(actionArgs(lock("false")))) as unknown as DataResult;
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(JSON.stringify({ locked: false }));
    expect(result.data.status).toEqual({
      tone: "notice",
      message: '(code stack, library, "X") on Platform is no longer a Locked rule.',
    });
  });

  it.each([
    ["role_denied", "role", 403, "Only the Buyer can mark or remove a Locked rule. Nothing was changed."],
    ["standard_not_found", "standardId", 404, "That Standard was not found. Nothing was changed."],
    ["invalid_input", "locked", 503, PROJECT_TREE_COPY.actionUnavailable],
  ])("maps %s to a denial", async (code, subject, status, message) => {
    registryAnswers([code === "role_denied" ? 403 : code === "standard_not_found" ? 404 : 400, refused(code, subject)]);
    const result = (await action(actionArgs(lock("true")))) as unknown as DataResult;
    expect(result.init?.status).toBe(status);
    expect(result.data).toMatchObject({ intent: "lock", status: { tone: "denial", message } });
  });

  it("names both rules, their slots and Projects, on locked_rule_conflict", async () => {
    const fetch = registryAnswers(
      [409, refused("locked_rule_conflict", S)],
      [200, { standardId: T, versions: [tAtWeb] }],
      [200, { standardId: S, versions: [sAtPlatform] }],
    );
    const result = (await action(actionArgs(lock("true", T)))) as unknown as DataResult;
    expect(result.init?.status).toBe(409);
    expect(result.data.status).toEqual({
      tone: "denial",
      message:
        'Nothing was changed. (code stack, library, "x") on Web contradicts the Locked rule (code stack, library, "X") on Platform in the same Conflict slot.',
    });
    expect((fetch.mock.calls[1] as unknown as [string])[0]).toMatch(new RegExp(`/v1/standards/${T}/versions$`));
    expect((fetch.mock.calls[2] as unknown as [string])[0]).toMatch(new RegExp(`/v1/standards/${S}/versions$`));
  });

  it("falls back to the ids when the conflicting rules cannot be read", async () => {
    registryAnswers([409, refused("locked_rule_conflict", S)], [500, {}], [500, {}]);
    const result = (await action(actionArgs(lock("true", T)))) as unknown as DataResult;
    expect(result.data.status?.message).toBe(
      `Nothing was changed. ${T} contradicts the Locked rule ${S} in the same Conflict slot.`,
    );
  });

  it("redirects to sign-in on a lapsed session", async () => {
    registryAnswers([401, refused("session_invalid", "session")]);
    const lapsed = await action(actionArgs(lock("true")));
    expect(lapsed).toBeInstanceOf(Response);
    expect((lapsed as Response).headers.get("location")).toBe("/sign-in");
  });

  it("reports an outage, and a malformed locked value without calling the registry", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    const down = (await action(actionArgs(lock("true")))) as unknown as DataResult;
    expect(down.data.status).toEqual({ tone: "denial", message: PROJECT_TREE_COPY.actionUnavailable });
    const fetch = registryAnswers();
    const malformed = (await action(actionArgs(lock("yes")))) as unknown as DataResult;
    expect(malformed.data.status).toEqual({ tone: "denial", message: PROJECT_TREE_COPY.actionUnavailable });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("/projects action", () => {
  it("creates a Project with the values as submitted and names it, its level and its parent", async () => {
    const created = { ...b, id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fa", parentId: A };
    const fetch = registryAnswers([201, created], [200, { ...tree, projects: [...tree.projects, created] }]);
    const result = (await action(actionArgs(create))) as unknown as DataResult;
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ name: " Web ", levelName: "  Product line ", parentId: A }));
    expect(result.data).toMatchObject({
      intent: "create",
      status: { tone: "notice", message: 'Created Web, level "  Product line ", under Platform.' },
      fieldErrors: {},
      values: {},
      changed: created,
    });
  });

  it("changes a parent and names the new parent", async () => {
    const moved = { ...b, parentId: ROOT };
    const fetch = registryAnswers([200, moved], [200, tree]);
    const result = (await action(actionArgs({ intent: "parent", projectId: B, parentId: ROOT }))) as unknown as DataResult;
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/projects/${B}/parent$`));
    expect(init.body).toBe(JSON.stringify({ parentId: ROOT }));
    expect(result.data.status).toEqual({ tone: "notice", message: 'Web, level "  Product line ", now has the parent Acme.' });
  });

  it("names the parent that closes a cycle, and the Project, and asks for another parent", async () => {
    registryAnswers([409, refused("project_cycle", B)], [200, tree]);
    const result = (await action(actionArgs(parent))) as unknown as DataResult;
    expect(result.init?.status).toBe(409);
    expect(result.data.status).toEqual({
      tone: "denial",
      message: "Nothing was changed. Web is a descendant of Platform, so it cannot be its parent. Choose another parent.",
    });
    expect(result.data.values).toEqual({ projectId: A, parentId: B });
  });

  it("names a Project set as its own parent", async () => {
    registryAnswers([409, refused("project_cycle", A)], [200, tree]);
    const result = (await action(actionArgs({ ...parent, parentId: A }))) as unknown as DataResult;
    expect(result.data.status?.message).toBe("Nothing was changed. Platform cannot be its own parent. Choose another parent.");
  });

  it("falls back to the ids when the tree cannot be read for the cycle copy", async () => {
    registryAnswers([409, refused("project_cycle", B)], [500, {}]);
    const result = (await action(actionArgs(parent))) as unknown as DataResult;
    expect(result.data.status?.message).toContain(`${B} is a descendant of ${A}`);
  });

  it.each([
    ["role_denied", "role", 403, PROJECT_TREE_COPY.roleDenial],
    ["root_project_fixed", "projectId", 409, PROJECT_TREE_COPY.rootFixed],
    ["project_not_found", "projectId", 404, PROJECT_TREE_COPY.projectNotFound],
    ["invalid_input", "body", 503, PROJECT_TREE_COPY.actionUnavailable],
    ["not_found", "/v1/projects", 503, PROJECT_TREE_COPY.actionUnavailable],
  ])("maps %s (subject %s) to a denial", async (code, subject, status, message) => {
    registryAnswers([code === "not_found" ? 404 : 409, refused(code, subject)]);
    const result = (await action(actionArgs(parent))) as unknown as DataResult;
    expect(result.init?.status).toBe(status);
    expect(result.data).toMatchObject({ intent: "parent", status: { tone: "denial", message }, fieldErrors: {} });
  });

  it.each([
    ["name", PROJECT_TREE_COPY.fieldErrors.name],
    ["levelName", PROJECT_TREE_COPY.fieldErrors.levelName],
    ["parentId", PROJECT_TREE_COPY.fieldErrors.parentId],
  ])("keeps every value and puts ink text under %s on invalid_input", async (subject, message) => {
    registryAnswers([400, refused("invalid_input", subject)]);
    const result = (await action(actionArgs(create))) as unknown as DataResult;
    expect(result.init?.status).toBe(400);
    expect(result.data).toEqual({
      intent: "create",
      status: null,
      fieldErrors: { [subject]: message },
      values: { name: " Web ", levelName: "  Product line ", parentId: A },
    });
  });

  it("puts an unknown or foreign parent under the Parent field", async () => {
    registryAnswers([404, refused("project_not_found", "parentId")]);
    const result = (await action(actionArgs(create))) as unknown as DataResult;
    expect(result.data.fieldErrors).toEqual({ parentId: PROJECT_TREE_COPY.fieldErrors.parentId });
  });

  it("reports an outage without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    const result = (await action(actionArgs(create))) as unknown as DataResult;
    expect(result.data.status).toEqual({ tone: "denial", message: PROJECT_TREE_COPY.actionUnavailable });
  });

  it("refuses an unknown intent without calling the registry", async () => {
    const fetch = registryAnswers();
    const result = (await action(actionArgs({ intent: "delete" }))) as unknown as DataResult;
    expect(result.init?.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redirects to sign-in on a lapsed session and without a cookie", async () => {
    registryAnswers([401, refused("session_invalid", "session")]);
    const lapsed = await action(actionArgs(create));
    expect((lapsed as Response).headers.get("location")).toBe("/sign-in");
    const none = await action(actionArgs(create, {}));
    expect((none as Response).headers.get("location")).toBe("/sign-in");
  });
});
