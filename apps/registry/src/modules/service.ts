import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  isModuleKind,
  isModuleName,
  isUuidV7,
  MODULE_NAME_MAX,
  MODULE_NAME_TAKEN,
  MODULE_NOT_FOUND,
  normalizeModuleName,
  ROLE_DENIED,
} from "@domain-harness/contract";
import type { AccountRef, ModuleInfo, ModuleList, ModuleOwner, SessionInfo, UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { isUniqueViolation } from "../db/pg-errors.ts";
import { accounts, moduleOwnerAssignments, modules } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";

const NAME_UNIQUE = "modules_tenant_id_lower_name_key";

/** The fields of `POST /v1/modules`, as received (validated here). */
export interface ModuleCreateInput {
  readonly kind: unknown;
  readonly name: unknown;
}

/** The fields of `POST /v1/modules/{id}/owner`, as received (validated here). */
export interface ModuleOwnerAssignInput {
  readonly accountId: unknown;
}

/**
 * Throw `role_denied` unless the session is the Buyer's. Runs before any
 * input validation or lookup, so a non-Buyer learns nothing about Module ids
 * or accounts.
 */
export function assertBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "only the Buyer can create a Module or assign its Standard owner; nothing was changed",
      subject: "role",
    });
  }
}

const moduleNotFound = (): EnvelopeError =>
  new EnvelopeError({ code: MODULE_NOT_FOUND, message: "no such Module in this Company", subject: "moduleId" });

const ineligibleOwner = (): EnvelopeError =>
  new EnvelopeError({
    code: "invalid_input",
    message: "accountId must be the id of a Standard owner account of this Company; nothing was written",
    subject: "accountId",
  });

/** Every Module of the session's tenant, oldest first, with its current owner, and the eligible owners. */
export async function listModules(db: RegistryDb, session: SessionInfo): Promise<ModuleList> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const names = await accountNames(tx, tenantId);
    const rows = await tx
      .select()
      .from(modules)
      .where(eq(modules.tenantId, tenantId))
      .orderBy(asc(modules.createdAt), asc(modules.id));
    // The latest assignment per Module: DISTINCT ON keeps the first row of each
    // module_id group, ordered by sequence descending.
    const latest = await tx
      .selectDistinctOn([moduleOwnerAssignments.moduleId])
      .from(moduleOwnerAssignments)
      .where(eq(moduleOwnerAssignments.tenantId, tenantId))
      .orderBy(moduleOwnerAssignments.moduleId, desc(moduleOwnerAssignments.sequence));
    const owners = new Map(latest.map((row) => [row.moduleId, ownerOf(row, names)]));

    const standardOwners = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.role, "Standard owner")))
      .orderBy(asc(accounts.name), asc(accounts.id));

    return {
      modules: rows.map((row) => toModuleInfo(row, owners.get(row.id) ?? null)),
      standardOwners: standardOwners.map((row) => ({ accountId: toId(row.id), name: row.name })),
    };
  });
}

/**
 * Create a Module with no owner (Buyer only). The kind is one of the two
 * Module kinds; the name is trimmed, 1 to 120 characters, and unique in the
 * tenant case-insensitively (`module_name_taken`).
 */
export async function createModule(db: RegistryDb, session: SessionInfo, input: ModuleCreateInput): Promise<ModuleInfo> {
  assertBuyer(session);
  const { kind, name } = input;
  if (!isModuleKind(kind)) {
    throw new EnvelopeError({
      code: "invalid_input",
      message: "kind must be code-stack or design-system",
      subject: "kind",
    });
  }
  if (!isModuleName(name)) {
    throw new EnvelopeError({
      code: "invalid_input",
      message: `name must be 1 to ${String(MODULE_NAME_MAX)} characters once trimmed`,
      subject: "name",
    });
  }
  const { tenantId } = session;
  const id = mintUuidV7();
  try {
    return await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(modules)
        .values({ id, tenantId, kind, name: normalizeModuleName(name), createdBy: session.accountId })
        .returning();
      if (row === undefined) throw new Error("insert returned no row");
      return toModuleInfo(row, null);
    });
  } catch (error) {
    if (isUniqueViolation(error, NAME_UNIQUE)) {
      throw new EnvelopeError(
        {
          code: MODULE_NAME_TAKEN,
          message: "another Module of this Company already has this name; nothing was written",
          subject: "name",
        },
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Make `accountId` the Module's Standard owner (Buyer only) by appending an
 * assignment row; earlier rows are never changed. Assigning the current owner
 * again writes nothing. Concurrent assignments to one Module serialise on a
 * transaction-scoped advisory lock keyed by the Module id, so sequences are
 * 1, 2, 3, ... and there is always exactly one current owner.
 */
export async function assignModuleOwner(
  db: RegistryDb,
  session: SessionInfo,
  moduleId: unknown,
  input: ModuleOwnerAssignInput,
): Promise<ModuleInfo> {
  assertBuyer(session);
  if (!isUuidV7(moduleId)) throw moduleNotFound();
  const { accountId } = input;
  const { tenantId } = session;

  return withTenant(db, tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${moduleId}, 0))`);
    const [module] = await tx
      .select()
      .from(modules)
      .where(and(eq(modules.tenantId, tenantId), eq(modules.id, moduleId)));
    if (module === undefined) throw moduleNotFound();

    if (!isUuidV7(accountId)) throw ineligibleOwner();
    const [account] = await tx
      .select({ role: accounts.role })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, accountId)));
    if (account?.role !== "Standard owner") throw ineligibleOwner();

    const [current] = await tx
      .select()
      .from(moduleOwnerAssignments)
      .where(and(eq(moduleOwnerAssignments.tenantId, tenantId), eq(moduleOwnerAssignments.moduleId, moduleId)))
      .orderBy(desc(moduleOwnerAssignments.sequence))
      .limit(1);

    let latest = current;
    if (current?.ownerAccountId !== accountId) {
      [latest] = await tx
        .insert(moduleOwnerAssignments)
        .values({
          id: mintUuidV7(),
          tenantId,
          moduleId,
          sequence: (current?.sequence ?? 0) + 1,
          ownerAccountId: accountId,
          assignedBy: session.accountId,
        })
        .returning();
    }
    if (latest === undefined) throw new Error("insert returned no row");
    return toModuleInfo(module, ownerOf(latest, await accountNames(tx, tenantId)));
  });
}

/** The operations the HTTP API needs, bound to one database. */
export interface ModuleService {
  listModules(session: SessionInfo): Promise<ModuleList>;
  createModule(session: SessionInfo, input: ModuleCreateInput): Promise<ModuleInfo>;
  assignModuleOwner(session: SessionInfo, moduleId: string, input: ModuleOwnerAssignInput): Promise<ModuleInfo>;
}

export function createModuleService(db: RegistryDb): ModuleService {
  return {
    listModules: (session) => listModules(db, session),
    createModule: (session, input) => createModule(db, session, input),
    assignModuleOwner: (session, moduleId, input) => assignModuleOwner(db, session, moduleId, input),
  };
}

export type ModuleRow = typeof modules.$inferSelect;
export type AssignmentRow = typeof moduleOwnerAssignments.$inferSelect;

/** Every account name of the tenant, by account id. */
export async function accountNames(tx: RegistryTx, tenantId: UuidV7): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export function accountRef(id: string, names: ReadonlyMap<string, string>): AccountRef {
  return { accountId: toId(id), name: names.get(id) ?? "" };
}

export function ownerOf(row: AssignmentRow, names: ReadonlyMap<string, string>): ModuleOwner {
  return {
    ...accountRef(row.ownerAccountId, names),
    assignedAt: row.assignedAt.toISOString(),
    assignedBy: accountRef(row.assignedBy, names),
  };
}

export function toModuleInfo(row: ModuleRow, owner: ModuleOwner | null): ModuleInfo {
  return { id: toId(row.id), kind: row.kind, name: row.name, owner, createdAt: row.createdAt.toISOString() };
}

export function toId(value: string): UuidV7 {
  if (!isUuidV7(value)) {
    throw new Error("stored id is not a canonical UUIDv7");
  }
  return value;
}
