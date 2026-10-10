import { and, asc, eq, isNull } from "drizzle-orm";
import { isUuidV7 } from "@domain-harness/contract";
import type { Plan, Role, UuidV7 } from "@domain-harness/contract";
import type { RegistryDb } from "../db/client.ts";
import { accounts, projects, tenants } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";

export interface Tenant {
  readonly id: UuidV7;
  readonly name: string;
  readonly plan: Plan;
  /** UTC ISO-8601. */
  readonly createdAt: string;
}

export interface Account {
  readonly id: UuidV7;
  readonly tenantId: UuidV7;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  /** UTC ISO-8601. */
  readonly createdAt: string;
}

export interface Project {
  readonly id: UuidV7;
  readonly tenantId: UuidV7;
  readonly parentId: UuidV7 | null;
  readonly name: string;
  /** UTC ISO-8601. */
  readonly createdAt: string;
}

// Every query filters by tenant explicitly; RLS is the second guard.

/** The tenant itself, or undefined when it is not visible in its own context. */
export async function getTenant(db: RegistryDb, tenantId: UuidV7): Promise<Tenant | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    return row === undefined
      ? undefined
      : { id: toId(row.id), name: row.name, plan: row.plan, createdAt: row.createdAt.toISOString() };
  });
}

/** The tenant's accounts, oldest first. */
export async function listAccounts(db: RegistryDb, tenantId: UuidV7): Promise<Account[]> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId))
      .orderBy(asc(accounts.createdAt), asc(accounts.id));
    return rows.map((row) => ({
      id: toId(row.id),
      tenantId: toId(row.tenantId),
      name: row.name,
      email: row.email,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

/** The tenant's single root Project (no parent), or undefined. */
export async function getRootProject(db: RegistryDb, tenantId: UuidV7): Promise<Project | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), isNull(projects.parentId)));
    return row === undefined
      ? undefined
      : {
          id: toId(row.id),
          tenantId: toId(row.tenantId),
          parentId: row.parentId === null ? null : toId(row.parentId),
          name: row.name,
          createdAt: row.createdAt.toISOString(),
        };
  });
}

function toId(value: string): UuidV7 {
  if (!isUuidV7(value)) {
    throw new Error("stored id is not a canonical UUIDv7");
  }
  return value;
}
