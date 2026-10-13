import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignModuleOwner,
  changeProjectParent,
  createModule,
  createProject,
  createSession,
  getEffectiveStandards,
  getProjectTree,
  getSession,
  getStandardVersions,
  listModules,
  listStandards,
  publishStandard,
  publishStandardVersion,
  registryBaseUrl,
  requestSignInLink,
  getChildPermissions,
  setChildPermission,
  setLockedRule,
  createApplication,
  getApplications,
  getBuildGrants,
  setBuildGrant,
  generateBoilerplate,
  getGuidanceEndpoint,
  setGuidanceEndpoint,
} from "./registry.server.ts";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ACCOUNT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const session = { accountId: ACCOUNT, tenantId: TENANT, role: "Buyer" };

function respond(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("registry client", () => {
  it("defaults to the local registry and honours PANEL_REGISTRY_URL", () => {
    expect(registryBaseUrl({})).toBe("http://127.0.0.1:4100");
    expect(registryBaseUrl({ PANEL_REGISTRY_URL: "http://registry.internal:9000/" })).toBe("http://registry.internal:9000");
  });

  it("posts the email to /v1/sign-in-links and accepts 202 {}", async () => {
    vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
    const fetch = respond(202, {});
    vi.stubGlobal("fetch", fetch);
    expect(await requestSignInLink("bea@acme.io")).toEqual({ kind: "ok", value: {} });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://registry.test/v1/sign-in-links");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ email: "bea@acme.io" }));
  });

  it("returns the session for a valid link token and validates it with the contract guard", async () => {
    const created = { sessionToken: `${TENANT}.x`, expiresAt: "2026-10-10T12:00:00.000Z", session };
    vi.stubGlobal("fetch", respond(201, created));
    expect(await createSession("t")).toEqual({ kind: "ok", value: created });
  });

  it("reports a refusal envelope", async () => {
    const envelope = { code: "sign_in_link_invalid", message: "m", subject: "token" };
    vi.stubGlobal("fetch", respond(401, envelope));
    expect(await createSession("t")).toEqual({ kind: "refused", error: envelope });
  });

  it("sends the session token as a bearer token", async () => {
    const fetch = respond(200, session);
    vi.stubGlobal("fetch", fetch);
    expect(await getSession("abc")).toEqual({ kind: "ok", value: session });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
  });

  it.each([
    ["a network failure", vi.fn(() => Promise.reject(new TypeError("fetch failed")))],
    ["a 500 envelope", respond(500, { code: "internal_error", message: "m", subject: "s" })],
    ["a malformed success body", respond(200, { role: "Admin" })],
    ["a non-JSON body", vi.fn(() => Promise.resolve(new Response("<html>", { status: 200 })))],
  ])("reports %s as unavailable without throwing", async (_label, fetch) => {
    vi.stubGlobal("fetch", fetch);
    expect(await getSession("abc")).toEqual({ kind: "unavailable" });
  });

  describe("Modules", () => {
    const MODULE = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
    const module = { id: MODULE, kind: "design-system", name: "DS", owner: null, createdAt: "2026-10-11T09:00:00.000Z" };

    it("lists Modules with a bearer token and validates the list", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const list = { modules: [module], standardOwners: [] };
      const fetch = respond(200, list);
      vi.stubGlobal("fetch", fetch);
      expect(await listModules("abc")).toEqual({ kind: "ok", value: list });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://registry.test/v1/modules");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
    });

    it("creates a Module with POST and expects 201", async () => {
      const fetch = respond(201, module);
      vi.stubGlobal("fetch", fetch);
      expect(await createModule("abc", "design-system", "DS")).toEqual({ kind: "ok", value: module });
      const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ kind: "design-system", name: "DS" }));
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer abc");
      expect(headers.get("content-type")).toBe("application/json");
    });

    it("assigns an owner on the Module's owner path, escaping the id", async () => {
      const fetch = respond(404, { code: "module_not_found", message: "m", subject: "moduleId" });
      vi.stubGlobal("fetch", fetch);
      expect(await assignModuleOwner("abc", "a/b", ACCOUNT)).toEqual({
        kind: "refused",
        error: { code: "module_not_found", message: "m", subject: "moduleId" },
      });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/\/v1\/modules\/a%2Fb\/owner$/);
      expect(init.body).toBe(JSON.stringify({ accountId: ACCOUNT }));
    });

    it("reports a 200 for create (wrong status) as unavailable", async () => {
      vi.stubGlobal("fetch", respond(200, module));
      expect(await createModule("abc", "code-stack", "x")).toEqual({ kind: "unavailable" });
    });
  });

  describe("Standards", () => {
    const MODULE = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
    const STANDARD = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
    const AT = "2026-10-11T09:00:00.000Z";
    const module = { id: MODULE, kind: "code-stack", name: "Code stack", owner: null, createdAt: AT };
    const info = {
      id: STANDARD,
      version: 1,
      module: { id: MODULE, kind: "code-stack", name: "Code stack" },
      project: { id: TENANT, name: "Acme" },
      entry: { category: "library", name: "React", versionConstraint: null, status: "approved", correctionInstruction: null },
      publishedAt: AT,
      publishedBy: { accountId: ACCOUNT, name: "Sam" },
    };
    const entry = { category: "library", name: " React ", versionConstraint: "", status: "approved", correctionInstruction: "" };

    it("lists a Module's Standards on its path with a bearer token", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const list = { module, standards: [info] };
      const fetch = respond(200, list);
      vi.stubGlobal("fetch", fetch);
      expect(await listStandards("abc", MODULE)).toEqual({ kind: "ok", value: list });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`http://registry.test/v1/modules/${MODULE}/standards`);
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
    });

    it("reads a Standard's versions, escaping the id", async () => {
      const versions = { standardId: STANDARD, versions: [info, { ...info, version: 2 }] };
      const fetch = respond(200, versions);
      vi.stubGlobal("fetch", fetch);
      expect(await getStandardVersions("abc", STANDARD)).toEqual({ kind: "ok", value: versions });
      await getStandardVersions("abc", "a/b");
      const [url] = fetch.mock.calls[1] as unknown as [string, RequestInit];
      expect(url).toMatch(/\/v1\/standards\/a%2Fb\/versions$/);
    });

    it("publishes a new Standard as { entry } with POST and expects 201", async () => {
      const fetch = respond(201, info);
      vi.stubGlobal("fetch", fetch);
      expect(await publishStandard("abc", MODULE, entry)).toEqual({ kind: "ok", value: info });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(new RegExp(`/v1/modules/${MODULE}/standards$`));
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ entry }));
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
    });

    it("publishes a design-system entry as { entry } and accepts its StandardInfo", async () => {
      const component = { kind: "component", name: "Button", usageRule: "Use it", tokens: ["primary"], correctionInstruction: null } as const;
      const designInfo = { ...info, module: { ...info.module, kind: "design-system" }, entry: component };
      const fetch = respond(201, designInfo);
      vi.stubGlobal("fetch", fetch);
      expect(await publishStandard("abc", MODULE, component)).toEqual({ kind: "ok", value: designInfo });
      const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.body).toBe(JSON.stringify({ entry: component }));
    });

    it("sends the Project scope only when one is given", async () => {
      const fetch = respond(201, info);
      vi.stubGlobal("fetch", fetch);
      expect((await publishStandard("abc", MODULE, entry, TENANT)).kind).toBe("ok");
      expect((await publishStandard("abc", MODULE, entry, undefined)).kind).toBe("ok");
      const bodies = fetch.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1].body);
      expect(bodies).toEqual([JSON.stringify({ entry, projectId: TENANT }), JSON.stringify({ entry })]);
    });

    it("publishes a new version on the Standard's versions path", async () => {
      const fetch = respond(201, { ...info, version: 2 });
      vi.stubGlobal("fetch", fetch);
      expect((await publishStandardVersion("abc", STANDARD, entry)).kind).toBe("ok");
      const [url] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(new RegExp(`/v1/standards/${STANDARD}/versions$`));
    });

    it("reports refusals and a malformed or wrong-status answer", async () => {
      const conflict = { code: "slot_conflict", message: "m", subject: STANDARD };
      vi.stubGlobal("fetch", respond(409, conflict));
      expect(await publishStandard("abc", MODULE, entry)).toEqual({ kind: "refused", error: conflict });
      vi.stubGlobal("fetch", respond(200, info));
      expect(await publishStandard("abc", MODULE, entry)).toEqual({ kind: "unavailable" });
      vi.stubGlobal("fetch", respond(200, { module, standards: [{ ...info, version: 0 }] }));
      expect(await listStandards("abc", MODULE)).toEqual({ kind: "unavailable" });
    });
  });

  describe("Project tree", () => {
    const ROOT = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
    const WEB = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
    const AT = "2026-10-12T09:00:00.000Z";
    const root = { id: ROOT, name: "Acme", levelName: null, parentId: null, createdAt: AT };
    const web = { id: WEB, name: "Web", levelName: "  Product line ", parentId: ROOT, createdAt: AT };

    it("reads the tree with GET and a bearer token", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const tree = { rootId: ROOT, projects: [root, web], lockedRules: [] };
      const fetch = respond(200, tree);
      vi.stubGlobal("fetch", fetch);
      expect(await getProjectTree("abc")).toEqual({ kind: "ok", value: tree });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://registry.test/v1/projects");
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
    });

    it("creates a Project with exactly { name, levelName, parentId } as submitted and expects 201", async () => {
      const fetch = respond(201, web);
      vi.stubGlobal("fetch", fetch);
      const input = { name: " Web ", levelName: "  Product line ", parentId: ROOT };
      expect(await createProject("abc", input)).toEqual({ kind: "ok", value: web });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/\/v1\/projects$/);
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(input));
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
    });

    it("changes a parent on the Project's escaped parent path and expects 200", async () => {
      const fetch = respond(200, { ...web, parentId: WEB });
      vi.stubGlobal("fetch", fetch);
      expect((await changeProjectParent("abc", WEB, ROOT)).kind).toBe("ok");
      await changeProjectParent("abc", "a/b", ROOT);
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(new RegExp(`/v1/projects/${WEB}/parent$`));
      expect(init.body).toBe(JSON.stringify({ parentId: ROOT }));
      expect((fetch.mock.calls[1] as unknown as [string])[0]).toMatch(/\/v1\/projects\/a%2Fb\/parent$/);
    });

    it("reports a refusal, a wrong status and a malformed tree", async () => {
      const cycle = { code: "project_cycle", message: "m", subject: WEB };
      vi.stubGlobal("fetch", respond(409, cycle));
      expect(await changeProjectParent("abc", ROOT, WEB)).toEqual({ kind: "refused", error: cycle });
      vi.stubGlobal("fetch", respond(201, web));
      expect(await changeProjectParent("abc", WEB, ROOT)).toEqual({ kind: "unavailable" });
      vi.stubGlobal("fetch", respond(200, { rootId: ROOT, projects: [web] }));
      expect(await getProjectTree("abc")).toEqual({ kind: "unavailable" });
    });

    it("reads a Project's Effective Standard set on its escaped path and checks the body", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const set = {
        project: { id: WEB, name: "Web" },
        standards: [
          {
            slot: { moduleKind: "code-stack", slotKind: "library", name: "X" },
            status: "prohibited",
            standard: {
              id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f0",
              version: 1,
              module: { id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f1", kind: "code-stack", name: "Stack" },
              project: { id: WEB, name: "Web" },
              entry: { category: "library", name: "X", versionConstraint: null, status: "prohibited", correctionInstruction: null },
              publishedAt: AT,
              publishedBy: { accountId: ACCOUNT, name: "Sam" },
            },
            sourceProject: { id: WEB, name: "Web" },
            locked: false,
          },
        ],
      };
      const fetch = respond(200, set);
      vi.stubGlobal("fetch", fetch);
      expect(await getEffectiveStandards("abc", WEB)).toEqual({ kind: "ok", value: set });
      await getEffectiveStandards("abc", "a/b");
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`http://registry.test/v1/projects/${WEB}/effective-standards`);
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
      expect((fetch.mock.calls[1] as unknown as [string])[0]).toMatch(/\/v1\/projects\/a%2Fb\/effective-standards$/);

      const notFound = { code: "project_not_found", message: "m", subject: "projectId" };
      vi.stubGlobal("fetch", respond(404, notFound));
      expect(await getEffectiveStandards("abc", WEB)).toEqual({ kind: "refused", error: notFound });
      vi.stubGlobal("fetch", respond(200, { ...set, standards: [{ ...set.standards[0], locked: "no" }] }));
      expect(await getEffectiveStandards("abc", WEB)).toEqual({ kind: "unavailable" });
    });

    it("marks or removes a Locked rule with exactly { locked } on the escaped path and expects 200", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const STANDARD = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f0";
      const state = {
        standard: {
          id: STANDARD,
          version: 1,
          module: { id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f1", kind: "code-stack", name: "Stack" },
          project: { id: WEB, name: "Web" },
          entry: { category: "library", name: "X", versionConstraint: null, status: "prohibited", correctionInstruction: null },
          publishedAt: AT,
          publishedBy: { accountId: ACCOUNT, name: "Sam" },
        },
        locked: true,
        changedAt: AT,
        changedBy: { accountId: ACCOUNT, name: "Bea" },
      };
      const fetch = respond(200, state);
      vi.stubGlobal("fetch", fetch);
      expect(await setLockedRule("abc", STANDARD, true)).toEqual({ kind: "ok", value: state });
      await setLockedRule("abc", "a/b", false);
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`http://registry.test/v1/standards/${STANDARD}/locked-rule`);
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ locked: true }));
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
      const [otherUrl, otherInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
      expect(otherUrl).toMatch(/\/v1\/standards\/a%2Fb\/locked-rule$/);
      expect(otherInit.body).toBe(JSON.stringify({ locked: false }));

      const conflict = { code: "locked_rule_conflict", message: "m", subject: STANDARD };
      vi.stubGlobal("fetch", respond(409, conflict));
      expect(await setLockedRule("abc", STANDARD, true)).toEqual({ kind: "refused", error: conflict });
      vi.stubGlobal("fetch", respond(200, { ...state, locked: "yes" }));
      expect(await setLockedRule("abc", STANDARD, true)).toEqual({ kind: "unavailable" });
    });

    it("reads a Project's child-Project permission grants on the escaped path and expects 200", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const builder = { accountId: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f2", name: "Bo", role: "Builder" };
      const list = {
        project: { id: WEB, name: "Web" },
        grants: [{ account: builder, grantedAt: AT, grantedBy: { accountId: ACCOUNT, name: "Bea" } }],
        eligibleAccounts: [builder],
      };
      const fetch = respond(200, list);
      vi.stubGlobal("fetch", fetch);
      expect(await getChildPermissions("abc", WEB)).toEqual({ kind: "ok", value: list });
      await getChildPermissions("abc", "a/b");
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`http://registry.test/v1/projects/${WEB}/child-permissions`);
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
      expect((fetch.mock.calls[1] as unknown as [string])[0]).toMatch(/\/v1\/projects\/a%2Fb\/child-permissions$/);

      const notFound = { code: "project_not_found", message: "m", subject: "projectId" };
      vi.stubGlobal("fetch", respond(404, notFound));
      expect(await getChildPermissions("abc", WEB)).toEqual({ kind: "refused", error: notFound });
      vi.stubGlobal("fetch", respond(200, { ...list, eligibleAccounts: [{ ...builder, role: "Admin" }] }));
      expect(await getChildPermissions("abc", WEB)).toEqual({ kind: "unavailable" });
    });

    it("grants or revokes with exactly { accountId, granted } and expects 200", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const builder = { accountId: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f2", name: "Bo", role: "Builder" };
      const state = {
        project: { id: WEB, name: "Web" },
        account: builder,
        granted: true,
        changedAt: AT,
        changedBy: { accountId: ACCOUNT, name: "Bea" },
      };
      const fetch = respond(200, state);
      vi.stubGlobal("fetch", fetch);
      expect(await setChildPermission("abc", WEB, builder.accountId, true)).toEqual({ kind: "ok", value: state });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`http://registry.test/v1/projects/${WEB}/child-permissions`);
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ accountId: builder.accountId, granted: true }));
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");

      const denied = { code: "role_denied", message: "m", subject: "role" };
      vi.stubGlobal("fetch", respond(403, denied));
      expect(await setChildPermission("abc", WEB, builder.accountId, false)).toEqual({ kind: "refused", error: denied });
      vi.stubGlobal("fetch", respond(200, { ...state, changedAt: null }));
      expect(await setChildPermission("abc", WEB, builder.accountId, true)).toEqual({ kind: "unavailable" });
    });

    it("reads a Project's build grants on the escaped path and grants with exactly { accountId, granted }", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const builder = { accountId: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f2", name: "Bo", role: "Builder" };
      const list = {
        project: { id: WEB, name: "Web" },
        grants: [{ account: builder, grantedAt: AT, grantedBy: { accountId: ACCOUNT, name: "Bea" } }],
        eligibleAccounts: [builder],
      };
      const fetch = respond(200, list);
      vi.stubGlobal("fetch", fetch);
      expect(await getBuildGrants("abc", WEB)).toEqual({ kind: "ok", value: list });
      await getBuildGrants("abc", "a/b");
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`http://registry.test/v1/projects/${WEB}/build-grants`);
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
      expect((fetch.mock.calls[1] as unknown as [string])[0]).toMatch(/\/v1\/projects\/a%2Fb\/build-grants$/);
      vi.stubGlobal("fetch", respond(200, { ...list, grants: [{}] }));
      expect(await getBuildGrants("abc", WEB)).toEqual({ kind: "unavailable" });

      const state = { project: list.project, account: builder, granted: true, changedAt: AT, changedBy: { accountId: ACCOUNT, name: "Bea" } };
      const post = respond(200, state);
      vi.stubGlobal("fetch", post);
      expect(await setBuildGrant("abc", WEB, builder.accountId, true)).toEqual({ kind: "ok", value: state });
      const [postUrl, postInit] = post.mock.calls[0] as unknown as [string, RequestInit];
      expect(postUrl).toBe(`http://registry.test/v1/projects/${WEB}/build-grants`);
      expect(postInit.method).toBe("POST");
      expect(postInit.body).toBe(JSON.stringify({ accountId: builder.accountId, granted: true }));
      const denied = { code: "role_denied", message: "m", subject: "role" };
      vi.stubGlobal("fetch", respond(403, denied));
      expect(await setBuildGrant("abc", WEB, builder.accountId, false)).toEqual({ kind: "refused", error: denied });
    });

    it("lists the Applications and places one with exactly { description, projectId }, expecting 201", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const app = {
        id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f3",
        description: "Checkout",
        project: { id: WEB, name: "Web" },
        fromFlow: true,
        agentTool: "cursor",
        createdAt: AT,
      };
      const fetch = respond(200, { applications: [app] });
      vi.stubGlobal("fetch", fetch);
      expect(await getApplications("abc")).toEqual({ kind: "ok", value: { applications: [app] } });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://registry.test/v1/applications");
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
      vi.stubGlobal("fetch", respond(200, { applications: [{ ...app, fromFlow: "yes" }] }));
      expect(await getApplications("abc")).toEqual({ kind: "unavailable" });
      vi.stubGlobal("fetch", respond(200, { applications: [{ ...app, agentTool: "windsurf" }] }));
      expect(await getApplications("abc")).toEqual({ kind: "unavailable" });
      vi.stubGlobal("fetch", respond(200, { applications: [{ ...app, agentTool: undefined }] }));
      expect(await getApplications("abc")).toEqual({ kind: "unavailable" });

      const post = respond(201, app);
      vi.stubGlobal("fetch", post);
      expect(await createApplication("abc", { description: " Checkout ", projectId: WEB })).toEqual({ kind: "ok", value: app });
      const [postUrl, postInit] = post.mock.calls[0] as unknown as [string, RequestInit];
      expect(postUrl).toBe("http://registry.test/v1/applications");
      expect(postInit.method).toBe("POST");
      expect(postInit.body).toBe(JSON.stringify({ description: " Checkout ", projectId: WEB }));
      vi.stubGlobal("fetch", respond(200, app));
      expect(await createApplication("abc", { description: "x", projectId: WEB })).toEqual({ kind: "unavailable" });
      vi.stubGlobal("fetch", respond(201, { ...app, agentTool: "windsurf" }));
      expect(await createApplication("abc", { description: "x", projectId: WEB })).toEqual({ kind: "unavailable" });
      vi.stubGlobal("fetch", respond(201, { ...app, agentTool: undefined }));
      expect(await createApplication("abc", { description: "x", projectId: WEB })).toEqual({ kind: "unavailable" });
      const denied = { code: "build_grant_denied", message: "m", subject: "projectId" };
      vi.stubGlobal("fetch", respond(403, denied));
      expect(await createApplication("abc", { description: "x", projectId: WEB })).toEqual({ kind: "refused", error: denied });
    });
    it("reads and sets the Guidance endpoint with exactly { url }", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const state = { url: "https://g.example", changedAt: AT };
      const fetch = respond(200, state);
      vi.stubGlobal("fetch", fetch);
      expect(await getGuidanceEndpoint("abc")).toEqual({ kind: "ok", value: state });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://registry.test/v1/guidance-endpoint");
      expect(init.method).toBe("GET");
      vi.stubGlobal("fetch", respond(200, { url: "https://g.example", changedAt: null }));
      expect(await getGuidanceEndpoint("abc")).toEqual({ kind: "unavailable" });

      const post = respond(200, state);
      vi.stubGlobal("fetch", post);
      expect(await setGuidanceEndpoint("abc", " https://g.example ")).toEqual({ kind: "ok", value: state });
      const [, postInit] = post.mock.calls[0] as unknown as [string, RequestInit];
      expect(postInit.method).toBe("POST");
      expect(postInit.body).toBe(JSON.stringify({ url: " https://g.example " }));
      expect(new Headers(postInit.headers).get("authorization")).toBe("Bearer abc");
    });

    it("generates a Boilerplate on the escaped path with exactly { target }", async () => {
      vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
      const app = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f3";
      const result = {
        applicationId: app,
        target: "claude-code",
        archiveName: `domain-harness-${app}-claude-code.tar.gz`,
        archiveBase64: "H4sI",
        artifacts: [{ kind: "identification-file", path: ".domain-harness.json" }],
      };
      const post = respond(200, result);
      vi.stubGlobal("fetch", post);
      expect(await generateBoilerplate("abc", app, "claude-code")).toEqual({ kind: "ok", value: result });
      const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`http://registry.test/v1/applications/${app}/boilerplate`);
      expect(init.body).toBe(JSON.stringify({ target: "claude-code" }));
      await generateBoilerplate("abc", "a/b", "claude-code");
      expect((post.mock.calls[1] as unknown as [string])[0]).toMatch(/\/v1\/applications\/a%2Fb\/boilerplate$/);
      vi.stubGlobal("fetch", respond(200, { ...result, artifacts: [] }));
      expect(await generateBoilerplate("abc", app, "claude-code")).toEqual({ kind: "unavailable" });
      const unset = { code: "guidance_endpoint_unset", message: "m", subject: "guidanceEndpoint" };
      vi.stubGlobal("fetch", respond(409, unset));
      expect(await generateBoilerplate("abc", app, "claude-code")).toEqual({ kind: "refused", error: unset });
    });
  });
});
