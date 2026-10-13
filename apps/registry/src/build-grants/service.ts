import { eq, max } from "drizzle-orm";
import { isUuidV7, ROLE_DENIED } from "@domain-harness/contract";
import type {
  AccountRef,
  BuildGrant,
  BuildGrantList,
  BuildGrantState,
  ProjectRef,
  Role,
  RoledAccountRef,
  SessionInfo,
  UuidV7,
} from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { accounts, buildGrantChanges } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { toId } from "../modules/service.ts";
import { currentProjects } from "../projects/current.ts";
import type { CurrentProject } from "../projects/current.ts";
import { projectNotFound } from "../projects/service.ts";
import { lockBundle } from "../standards/service.ts";
import { latestGrantRow, latestGrantRows } from "./current.ts";
import type { BuildGrantRow } from "./current.ts";

export { hasBuildGrant } from "./current.ts";

/** A validated `POST /v1/projects/{id}/build-grants` body (the account id is checked later). */
export interface BuildGrantBody {
  readonly accountId: string;
  readonly granted: boolean;
}

const INELIGIBLE_ACCOUNT = "accountId must be the id of an account of this Company that is not the Buyer";

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was changed`, subject });

/**
 * Validate `{ accountId, granted }` (exactly these keys): the account id is a
 * string (whether it names an eligible account is checked later) and the flag
 * a boolean. Throws `invalid_input` naming `body`, the extra key, `accountId`
 * or `granted`.
 */
export function validateBuildGrantBody(body: unknown): BuildGrantBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with accountId, granted");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== "accountId" && key !== "granted");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const accountId = fields["accountId"];
  if (typeof accountId !== "string") throw invalid("accountId", INELIGIBLE_ACCOUNT);
  const granted = fields["granted"];
  if (typeof granted !== "boolean") throw invalid("granted", "granted must be true or false");
  return { accountId, granted };
}

interface AccountFacts {
  readonly name: string;
  readonly role: Role;
}

/** Every account of the tenant with its name and role, by id. */
async function tenantAccounts(tx: RegistryTx, tenantId: UuidV7): Promise<Map<string, AccountFacts>> {
  const rows = await tx
    .select({ id: accounts.id, name: accounts.name, role: accounts.role })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId));
  return new Map(rows.map((row) => [row.id, { name: row.name, role: row.role }]));
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byNameThenId = (a: RoledAccountRef, b: RoledAccountRef): number =>
  compare(a.name, b.name) || compare(a.accountId, b.accountId);

function roledRef(id: string, all: ReadonlyMap<string, AccountFacts>): RoledAccountRef {
  const facts = all.get(id);
  if (facts === undefined) throw new Error("a stored account is missing");
  return { accountId: toId(id), name: facts.name, role: facts.role };
}

function ref(id: string, all: ReadonlyMap<string, AccountFacts>): AccountRef {
  return { accountId: toId(id), name: all.get(id)?.name ?? "" };
}

const projectRef = (project: CurrentProject): ProjectRef => ({ id: toId(project.row.id), name: project.row.name });

/**
 * The current build grants on one Project, and the
 * accounts that can hold one. Open to every role. A malformed, unknown or
 * other tenant's Project is `project_not_found` (subject `projectId`).
 */
export async function listBuildGrants(
  db: RegistryDb,
  session: SessionInfo,
  projectId: unknown,
): Promise<BuildGrantList> {
  if (!isUuidV7(projectId)) throw projectNotFound("projectId");
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    // The bundle lock keeps the Project and its grants on one consistent state.
    await lockBundle(tx, tenantId);
    const project = (await currentProjects(tx, tenantId)).get(projectId);
    if (project === undefined) throw projectNotFound("projectId");
    const all = await tenantAccounts(tx, tenantId);
    const grants: BuildGrant[] = (await latestGrantRows(tx, tenantId, projectId))
      .filter((row) => row.granted)
      .map((row) => ({
        account: roledRef(row.accountId, all),
        grantedAt: row.changedAt.toISOString(),
        grantedBy: ref(row.changedBy, all),
      }))
      .sort((a, b) => byNameThenId(a.account, b.account));
    const eligibleAccounts = [...all.entries()]
      .filter(([, facts]) => facts.role !== "Buyer")
      .map(([id]) => roledRef(id, all))
      .sort(byNameThenId);
    return { project: projectRef(project), grants, eligibleAccounts };
  });
}

/** The next per-tenant build grant sequence: max + 1, read under the bundle lock. */
async function nextSequence(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(buildGrantChanges.sequence) })
    .from(buildGrantChanges)
    .where(eq(buildGrantChanges.tenantId, tenantId));
  return (row?.sequence ?? 0) + 1;
}

/**
 * Grant or revoke one account's build grant on one Project (Buyer only) by
 * appending a row; earlier rows are never changed. Checks run under the tenant's bundle lock, first failure wins and
 * nothing is written: the Project is the tenant's (404 `project_not_found`,
 * subject `projectId`) → the role (403 `role_denied`) → the body (400
 * `invalid_input`) → the account is one of the tenant's and not the Buyer
 * (400 `invalid_input`, subject `accountId`) → the same state as now (200,
 * nothing written).
 */
export async function setBuildGrant(
  db: RegistryDb,
  session: SessionInfo,
  projectId: unknown,
  body: unknown,
): Promise<BuildGrantState> {
  if (!isUuidV7(projectId)) throw projectNotFound("projectId");
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const project = (await currentProjects(tx, tenantId)).get(projectId);
    if (project === undefined) throw projectNotFound("projectId");
    if (session.role !== "Buyer") {
      throw new EnvelopeError({
        code: ROLE_DENIED,
        message: "only the Buyer can grant or revoke the build grant; nothing was changed",
        subject: "role",
      });
    }
    const { accountId, granted } = validateBuildGrantBody(body);
    const all = await tenantAccounts(tx, tenantId);
    const account = isUuidV7(accountId) ? all.get(accountId) : undefined;
    if (account === undefined || account.role === "Buyer") throw invalid("accountId", INELIGIBLE_ACCOUNT);

    const latest = await latestGrantRow(tx, tenantId, projectId, accountId);
    if ((latest?.granted ?? false) === granted) return toState(project, accountId, latest, all);

    await tx.insert(buildGrantChanges).values({
      id: mintUuidV7(),
      tenantId,
      projectId,
      accountId,
      sequence: await nextSequence(tx, tenantId),
      granted,
      changedBy: session.accountId,
    });
    return toState(project, accountId, await latestGrantRow(tx, tenantId, projectId, accountId), all);
  });
}

function toState(
  project: CurrentProject,
  accountId: string,
  row: BuildGrantRow | undefined,
  all: ReadonlyMap<string, AccountFacts>,
): BuildGrantState {
  const account = roledRef(accountId, all);
  if (row === undefined) return { project: projectRef(project), account, granted: false, changedAt: null, changedBy: null };
  return {
    project: projectRef(project),
    account,
    granted: row.granted,
    changedAt: row.changedAt.toISOString(),
    changedBy: ref(row.changedBy, all),
  };
}

/** The operations the HTTP API needs, bound to one database. */
export interface BuildGrantService {
  listBuildGrants(session: SessionInfo, projectId: string): Promise<BuildGrantList>;
  setBuildGrant(session: SessionInfo, projectId: string, body: unknown): Promise<BuildGrantState>;
}

export function createBuildGrantService(db: RegistryDb): BuildGrantService {
  return {
    listBuildGrants: (session, projectId) => listBuildGrants(db, session, projectId),
    setBuildGrant: (session, projectId, body) => setBuildGrant(db, session, projectId, body),
  };
}
