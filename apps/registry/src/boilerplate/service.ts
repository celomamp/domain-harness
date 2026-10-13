import { and, eq } from "drizzle-orm";
import {
  BOILERPLATE_TARGETS,
  boilerplateArchiveName,
  GUIDANCE_ENDPOINT_UNSET,
  isBoilerplateTarget,
  isUuidV7,
} from "@domain-harness/contract";
import type { BoilerplateResult, BoilerplateTarget, SessionInfo } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import type { RegistryDb } from "../db/client.ts";
import { applications } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { applicationNotFound } from "../applications/service.ts";
import { recordAgentTool } from "../applications/agent-tool.ts";
import { currentGuidanceEndpoint } from "../guidance-endpoint/service.ts";
import { toId } from "../modules/service.ts";
import { currentProjects } from "../projects/current.ts";
import { resolveEffectiveStandards } from "../projects/service.ts";
import { lockBundle } from "../standards/service.ts";
import { tarGz } from "./archive.ts";
import { planBoilerplate } from "./plan.ts";
import { renderBoilerplateFiles } from "./render.ts";

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was generated`, subject });

/** Validate `{ target }` (exactly this key, a known target). Throws `invalid_input` naming `body`, the extra key or `target`. */
export function validateBoilerplateBody(body: unknown): BoilerplateTarget {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with target");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== "target");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const target = fields["target"];
  if (!isBoilerplateTarget(target)) throw invalid("target", `target must be one of ${BOILERPLATE_TARGETS.join(", ")}`);
  return target;
}

/**
 * Generate the Boilerplate of one Application for one agent tool. Open to
 * every role. Runs under the tenant transaction and the bundle lock; first
 * failure wins and nothing is returned partially: the Application is the
 * tenant's (404 `application_not_found`) → the body (400 `invalid_input`,
 * subject `target`) → the Guidance endpoint is set (409
 * `guidance_endpoint_unset`) → the Effective Standard set of the
 * Application's stored Project resolves (core's error as is) → the ecosystem
 * check (409 `unsupported_ecosystem`) → the conflict check (409
 * `boilerplate_conflict`) → render and pack → the target is recorded as the
 * Application's agent tool (nothing recorded when a refusal won above).
 */
export async function generateBoilerplate(
  db: RegistryDb,
  session: SessionInfo,
  applicationId: unknown,
  body: unknown,
): Promise<BoilerplateResult> {
  if (!isUuidV7(applicationId)) throw applicationNotFound();
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const [row] = await tx
      .select({ id: applications.id, projectId: applications.projectId })
      .from(applications)
      .where(and(eq(applications.tenantId, tenantId), eq(applications.id, applicationId)));
    if (row === undefined) throw applicationNotFound();
    const target = validateBoilerplateBody(body);

    const endpoint = await currentGuidanceEndpoint(tx, tenantId);
    if (endpoint.url === null) {
      throw new EnvelopeError({
        code: GUIDANCE_ENDPOINT_UNSET,
        message:
          "The Company Guidance endpoint is not set, so ask the Buyer to set the Guidance endpoint; nothing was generated",
        subject: "guidanceEndpoint",
      });
    }

    const current = await currentProjects(tx, tenantId);
    const project = current.get(row.projectId);
    if (project === undefined) throw new Error("an Application's Project is missing");
    const set = await resolveEffectiveStandards(tx, tenantId, project, current);

    const planned = planBoilerplate(set);
    if (!planned.ok) throw new EnvelopeError(planned.error);

    const id = toId(row.id);
    const files = renderBoilerplateFiles(target, {
      applicationId: id,
      projectId: toId(row.projectId),
      guidanceUrl: endpoint.url,
      plan: planned.plan,
    });
    const result = {
      applicationId: id,
      target,
      archiveName: boilerplateArchiveName(id, target),
      archiveBase64: tarGz(files).toString("base64"),
      artifacts: files.map((file) => ({ kind: file.kind, path: file.path })),
    };
    await recordAgentTool(tx, tenantId, id, target, session.accountId);
    return result;
  });
}

/** The operations the HTTP API needs, bound to one database. */
export interface BoilerplateService {
  generateBoilerplate(session: SessionInfo, applicationId: string, body: unknown): Promise<BoilerplateResult>;
}

export function createBoilerplateService(db: RegistryDb): BoilerplateService {
  return {
    generateBoilerplate: (session, applicationId, body) => generateBoilerplate(db, session, applicationId, body),
  };
}
