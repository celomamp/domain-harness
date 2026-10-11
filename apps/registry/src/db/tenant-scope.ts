import { sql } from "drizzle-orm";
import { isUuidV7 } from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import type { RegistryDb, RegistryTx } from "./client.ts";
import { SIGN_IN_LOOKUP_ROLE, TENANT_TABLES } from "./schema.ts";

/**
 * Throw `tenant_required` unless `tenantId` is a canonical UUIDv7.
 * Every data-access function calls this before issuing any query.
 */
export function assertTenantId(tenantId: unknown): asserts tenantId is UuidV7 {
  if (!isUuidV7(tenantId)) {
    throw new EnvelopeError({
      code: "tenant_required",
      message: "a data-access call needs a tenant id that is a canonical UUIDv7; no query was issued",
      subject: "tenantId",
    });
  }
}

/**
 * Run `fn` in one transaction whose tenant context is `tenantId`.
 *
 * The guard runs before the connection is touched. Inside the transaction,
 * `set_config('app.tenant_id', id, true)` is transaction-local, so the context
 * never leaks to the next user of the pooled connection. RLS policies key on it.
 */
export async function withTenant<T>(db: RegistryDb, tenantId: unknown, fn: (tx: RegistryTx) => Promise<T>): Promise<T> {
  assertTenantId(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

interface RoleFacts extends Record<string, unknown> {
  role: string;
  is_superuser: boolean;
  bypasses_rls: boolean;
  owns_tables: boolean;
  is_lookup_member: boolean;
}

/**
 * Refuse a runtime connection whose current role would defeat RLS: a
 * superuser, a role with BYPASSRLS, or a role that owns (or is a member of the
 * owner of) any tenant-scoped table, or a member of the cross-tenant lookup
 * role `dh_sign_in_lookup` (its policy sees every account). Throws
 * `unsafe_database_role`.
 */
export async function assertRuntimeRoleSafe(db: RegistryDb): Promise<void> {
  const tables = sql.join(
    TENANT_TABLES.map((t) => sql`${t}`),
    sql`, `,
  );
  const result = await db.execute<RoleFacts>(sql`
    select
      current_user::text as role,
      r.rolsuper as is_superuser,
      r.rolbypassrls as bypasses_rls,
      exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (${tables})
          and pg_has_role(current_user, c.relowner, 'MEMBER')
      ) as owns_tables,
      exists (
        select 1
        from pg_roles l
        where l.rolname = ${SIGN_IN_LOOKUP_ROLE}
          and pg_has_role(current_user, l.oid, 'MEMBER')
      ) as is_lookup_member
    from pg_roles r
    where r.rolname = current_user
  `);
  const facts = result.rows[0];
  const reason =
    facts === undefined
      ? "the current role could not be inspected"
      : facts.is_superuser
        ? "the current role is a superuser"
        : facts.bypasses_rls
          ? "the current role has BYPASSRLS"
          : facts.owns_tables
            ? "the current role owns a tenant-scoped table"
            : facts.is_lookup_member
              ? "the current role is a member of dh_sign_in_lookup"
              : undefined;
  if (reason !== undefined) {
    throw new EnvelopeError({
      code: "unsafe_database_role",
      message: `refusing to run: ${reason}, which would bypass row-level security`,
      subject: "REGISTRY_DATABASE_URL",
    });
  }
}
