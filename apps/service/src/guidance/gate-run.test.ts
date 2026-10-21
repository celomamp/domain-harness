/**
 * Unit suite for the hosted Gate run (pilot option A) against the InMemory
 * twins and synthetic bundles: identity refuses exactly as Guidance does,
 * the answer is the CI runner's own (byte-identical to the shared
 * in-process adapter for the same snapshot), the run is recorded and
 * enqueued to the Collector, an accepted Deviation lets the next run pass,
 * and the HTTP handler's protocol checks and logs carry no fact names.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GATE_RUN_PATH, GUIDANCE_IDENTITY_HEADERS, isGateRunResult } from "@domain-harness/contract";
import type { GateRunRequest, StandardBundlePayload, StandardInfo, UuidV7 } from "@domain-harness/contract";
import { extractRevisionFacts } from "@domain-harness/extractor";
import {
  BUNDLE_STALE,
  DUPLICATE_APPLICATION_ID,
  FAIL,
  MISSING_IDENTIFICATION_FILE,
  PASS,
  RUN_DID_NOT_COMPLETE,
  UNBOUND,
  createInMemoryBindingLedger,
  runGateDirect,
} from "@domain-harness/gate";
import type { GateBundleSnapshot } from "@domain-harness/gate";
import type { GateRunRecordInput } from "@domain-harness/collector";
import { handleGateRun, hostedGateRun, snapshotOfPinned } from "./gate-run.ts";
import type { HostedGateRunDeps } from "./gate-run.ts";
import type { GuidanceIdentityHeaders, PinnedActiveBundle } from "./identity.ts";
import { createInMemoryGuidanceIdentityStore } from "./store.ts";
import { createInMemoryGateRecordStore } from "../ci-gate/store.ts";
import type { GateRecordStore } from "../ci-gate/store.ts";
import type { CollectorSubmission } from "../collector/client.ts";
import { makeBundlePayload } from "../bundles/test-fixtures.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const APP = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const OTHER_APP = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
const ROOT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const WEB = "018f3d2a-7000-7000-8000-000000000112" as UuidV7;
const STD_TS = "018f3d2a-7000-7000-8000-000000000131" as UuidV7;
const STD_MOMENT = "018f3d2a-7000-7000-8000-000000000132" as UuidV7;
const STD_RECHARTS = "018f3d2a-7000-7000-8000-000000000133" as UuidV7;
const FP_1 = "1".repeat(64);
const FP_2 = "2".repeat(64);
const REVISION = "a".repeat(40);
const ISSUED = "2026-10-14T06:00:00.000Z";
const NOW = "2026-10-14T12:00:00.000Z";
const HASH = "f".repeat(64);
const MOMENT_CORRECTION = "use date-fns instead of moment";

const PUBLISHER = { accountId: "018f3d2a-7000-7000-8000-000000000140" as UuidV7, name: "Bea" };
const CODE_MODULE = { id: "018f3d2a-7000-7000-8000-000000000120" as UuidV7, kind: "code-stack" as const, name: "Backend" };

function codeStack(
  id: UuidV7,
  category: "language" | "library",
  name: string,
  status: "approved" | "required" | "prohibited",
  versionConstraint: string | null = null,
  correctionInstruction: string | null = null,
): StandardInfo {
  return {
    id,
    version: 1,
    module: CODE_MODULE,
    project: { id: ROOT, name: "Root" },
    entry: { category, name, versionConstraint, status, correctionInstruction },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

/** The staging test Application's set in miniature: TypeScript required, moment prohibited, recharts ^2 approved. */
function payloadOf(overrides: Partial<StandardBundlePayload> = {}): StandardBundlePayload {
  return {
    ...makeBundlePayload({ keyId: "gate-run-test-key", sequence: 1, issuedAt: ISSUED }),
    frozen: false,
    standards: [
      codeStack(STD_TS, "language", "TypeScript", "required"),
      codeStack(STD_MOMENT, "library", "moment", "prohibited", null, MOMENT_CORRECTION),
      codeStack(STD_RECHARTS, "library", "recharts", "approved", "^2"),
    ],
    tree: {
      rootId: ROOT,
      projects: [
        { id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED },
        { id: WEB, name: "Web", levelName: null, parentId: ROOT, createdAt: ISSUED },
      ],
      lockedRules: [],
    },
    applications: [{ id: APP, projectId: WEB, fromFlow: true, agentTool: "claude-code" }],
    acceptedDeviations: [],
    ...overrides,
  };
}

/** A revision's files: a TypeScript package depending on moment (the failing case) or not. */
function revisionFiles(withMoment: boolean): Record<string, string> {
  const dependencies: Record<string, string> = { recharts: "2.12.0", typescript: "5.6.3" };
  if (withMoment) dependencies["moment"] = "2.30.1";
  return {
    "package.json": JSON.stringify({ name: "portal", dependencies }),
    "src/index.ts": withMoment ? 'import moment from "moment";\nexport const now = moment();\n' : "export const now = new Date();\n",
  };
}

function requestOf(withMoment: boolean): GateRunRequest {
  return { revision: REVISION, facts: extractRevisionFacts(revisionFiles(withMoment)) };
}

const BOUND: GuidanceIdentityHeaders = { applicationId: APP, advisoryProjectId: WEB, repoFingerprint: FP_1 };

interface Fixture {
  readonly deps: HostedGateRunDeps;
  readonly gateStore: GateRecordStore;
  readonly enqueued: Array<{ readonly run: GateRunRecordInput; readonly agentToolName: string | null }>;
}

function setup(payload: StandardBundlePayload = payloadOf(), overrides: Partial<HostedGateRunDeps> = {}): Fixture {
  const pinned: PinnedActiveBundle = { payload, hash: HASH };
  const gateStore = createInMemoryGateRecordStore();
  const enqueued: Fixture["enqueued"] = [];
  const collector: CollectorSubmission = {
    recordGuidance: () => Promise.resolve(),
    recordGateRun: (run, agentToolName) => {
      enqueued.push({ run, agentToolName });
      return Promise.resolve();
    },
  };
  return {
    gateStore,
    enqueued,
    deps: {
      tenantId: TENANT,
      identityStore: createInMemoryGuidanceIdentityStore(),
      gateStore,
      getPinnedBundle: () => Promise.resolve(pinned),
      collector,
      now: () => NOW,
      ...overrides,
    },
  };
}

describe("hostedGateRun: the Gate's answer for a bound Application", () => {
  it("fails a revision with moment with one Deviation line, records the run and enqueues it", async () => {
    const { deps, gateStore, enqueued } = setup();
    const run = await hostedGateRun(deps, BOUND, requestOf(true));
    expect(run.result).toEqual({
      kind: "fail",
      exitCode: 1,
      sentence: FAIL,
      deviationLines: [`${STD_MOMENT} code-stack/library/moment moment: ${MOMENT_CORRECTION}`],
    });
    expect(run.applicationId).toBe(APP);
    expect(run.open).toBe(1);

    const runs = await gateStore.listGateRuns(APP);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.revision).toBe(REVISION);
    expect(runs[0]?.bundleHash).toBe(HASH);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.agentToolName).toBe("claude-code");
    expect(enqueued[0]?.run.open).toBe(1);
    expect(enqueued[0]?.run.deviations.map((d) => d.subject)).toEqual(["moment"]);
  });

  it("passes a revision without moment", async () => {
    const { deps, enqueued } = setup();
    const run = await hostedGateRun(deps, BOUND, requestOf(false));
    expect(run.result).toEqual({ kind: "pass", exitCode: 0, sentence: PASS, deviationLines: [] });
    expect(enqueued).toHaveLength(1);
  });

  it("answers byte-identically to the shared in-process adapter on the same snapshot", async () => {
    for (const withMoment of [true, false]) {
      const { deps } = setup();
      const hosted = await hostedGateRun(deps, BOUND, requestOf(withMoment));
      const adapted = snapshotOfPinned({ payload: payloadOf(), hash: HASH }, WEB, NOW);
      if (!adapted.ok) throw new Error("the fixture bundle must resolve");
      const direct = await runGateDirect({
        applicationId: APP,
        repoFingerprint: FP_1,
        files: revisionFiles(withMoment),
        bundle: { variant: "snapshot", snapshot: adapted.snapshot as unknown as GateBundleSnapshot },
        ledger: createInMemoryBindingLedger(),
        now: NOW,
      });
      expect(hosted.result).toEqual({
        kind: direct.kind,
        exitCode: direct.exitCode,
        sentence: direct.sentence,
        deviationLines: direct.deviationLines,
      });
    }
  });

  it("reports an accepted Deviation as accepted and passes", async () => {
    const payload = payloadOf({
      acceptedDeviations: [
        {
          applicationId: APP,
          standardId: STD_MOMENT,
          standardVersion: 1,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "moment" },
          subject: "moment",
          start: ISSUED,
          end: "2026-12-31T00:00:00.000Z",
        },
      ],
    });
    const { deps, enqueued } = setup(payload);
    const run = await hostedGateRun(deps, BOUND, requestOf(true));
    expect(run.result).toEqual({ kind: "pass", exitCode: 0, sentence: PASS, deviationLines: [] });
    expect(enqueued[0]?.run.deviations.map((d) => d.status)).toEqual(["accepted"]);
  });

  it("refuses a stale bundle with the Gate's sentence and records nothing", async () => {
    const { deps, gateStore, enqueued } = setup(payloadOf({ issuedAt: "2026-10-01T00:00:00.000Z" }));
    const run = await hostedGateRun(deps, BOUND, requestOf(true));
    expect(run.result).toEqual({ kind: "refusal", exitCode: 1, sentence: BUNDLE_STALE, deviationLines: [] });
    expect(await gateStore.countGateRuns(APP)).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("skips the enqueue (never the run) when the Application has no agent tool", async () => {
    const payload = payloadOf({ applications: [{ id: APP, projectId: WEB, fromFlow: true, agentTool: null }] });
    const { deps, gateStore, enqueued } = setup(payload);
    const run = await hostedGateRun(deps, BOUND, requestOf(true));
    expect(run.result.kind).toBe("fail");
    expect(await gateStore.countGateRuns(APP)).toBe(1);
    expect(enqueued).toEqual([{ run: expect.anything() as unknown, agentToolName: null }]);
  });
});

describe("hostedGateRun: identity refuses exactly as Guidance does (Story 4.3)", () => {
  it("refuses a copied fingerprint, records the refusal and runs nothing", async () => {
    const { deps, gateStore, enqueued } = setup();
    await deps.identityStore.bindApplication(APP, FP_2);
    const run = await hostedGateRun(deps, BOUND, requestOf(true));
    expect(run.result).toEqual({ kind: "refusal", exitCode: 1, sentence: DUPLICATE_APPLICATION_ID, deviationLines: [] });
    expect(await deps.identityStore.listBindingRefusals(APP)).toHaveLength(1);
    expect(await gateStore.countGateRuns(APP)).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("refuses an Application the active bundle does not hold as unbound", async () => {
    const { deps } = setup();
    const run = await hostedGateRun(deps, { ...BOUND, applicationId: OTHER_APP }, requestOf(true));
    expect(run.result.sentence).toBe(UNBOUND);
    expect(await deps.identityStore.getBinding(OTHER_APP)).toBeNull();
  });

  it("refuses a missing Application id as a missing identification file", async () => {
    const { deps } = setup();
    const run = await hostedGateRun(deps, { ...BOUND, applicationId: undefined }, requestOf(true));
    expect(run.result.sentence).toBe(MISSING_IDENTIFICATION_FILE);
  });

  it("refuses a missing fingerprint as unbound (the Gate's sentence, not Guidance's commit-once)", async () => {
    const { deps } = setup();
    const run = await hostedGateRun(deps, { ...BOUND, repoFingerprint: undefined }, requestOf(true));
    expect(run.result.sentence).toBe(UNBOUND);
  });

  it("binds on first use, sharing the binding with Guidance", async () => {
    const { deps } = setup();
    await hostedGateRun(deps, BOUND, requestOf(false));
    expect((await deps.identityStore.getBinding(APP))?.fingerprint).toBe(FP_1);
  });

  it("answers run did not complete when the bundle read fails", async () => {
    const { deps } = setup(payloadOf(), { getPinnedBundle: () => Promise.reject(new Error("db down")) });
    const run = await hostedGateRun(deps, BOUND, requestOf(true));
    expect(run.result.sentence).toBe(RUN_DID_NOT_COMPLETE);
  });
});

describe("handleGateRun: the HTTP surface", () => {
  let server: Server | undefined;
  const logged: unknown[] = [];

  afterEach(async () => {
    logged.length = 0;
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
    });
    server = undefined;
  });

  async function listen(deps: HostedGateRunDeps): Promise<string> {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://x.invalid").pathname;
      void handleGateRun({ ...deps, onRun: (event) => logged.push(event) }, request, response, path).then((handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      });
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}${GATE_RUN_PATH}`;
  }

  const identityHeaders = {
    [GUIDANCE_IDENTITY_HEADERS.applicationId]: APP,
    [GUIDANCE_IDENTITY_HEADERS.advisoryProjectId]: WEB,
    [GUIDANCE_IDENTITY_HEADERS.repoFingerprint]: FP_1,
  };

  it("answers the Gate result as 200 JSON and logs ids and counts only", async () => {
    const url = await listen(setup().deps);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...identityHeaders },
      body: JSON.stringify(requestOf(true)),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(isGateRunResult(body)).toBe(true);
    expect((body as { kind: string }).kind).toBe("fail");
    expect(logged).toEqual([{ applicationId: APP, kind: "fail", checked: expect.any(Number) as unknown, open: 1 }]);
    expect(JSON.stringify(logged)).not.toContain("moment");
  });

  it("refuses other methods with 405 and Allow: POST", async () => {
    const url = await listen(setup().deps);
    const response = await fetch(url);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toMatchObject({ code: "method_not_allowed" });
  });

  it("refuses a non-JSON media type with 415", async () => {
    const url = await listen(setup().deps);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: "unsupported_media_type", subject: "content-type" });
  });

  it("refuses a body over the limit with 413", async () => {
    const url = await listen(setup().deps);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(1024 * 1024 + 1) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "payload_too_large", subject: "body" });
  });

  it("refuses malformed JSON, a bad revision and unreadable rows with one 400 envelope", async () => {
    const url = await listen(setup().deps);
    const bodies = [
      "{",
      JSON.stringify({ ...requestOf(true), revision: "HEAD" }),
      JSON.stringify({ ...requestOf(true), facts: { ...requestOf(true).facts, unreadable: [{ path: "a.json", reason: "x" }] } }),
      JSON.stringify({ ...requestOf(true), files: { "a.ts": "source" } }),
    ];
    for (const body of bodies) {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...identityHeaders }, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", subject: "body" });
    }
    expect(logged).toEqual([]);
  });

  it("leaves other paths to the caller", async () => {
    const url = await listen(setup().deps);
    const response = await fetch(url.replace(GATE_RUN_PATH, "/elsewhere"), { method: "POST" });
    expect(response.status).toBe(404);
  });
});
