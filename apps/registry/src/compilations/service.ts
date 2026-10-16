import { and, eq, max } from "drizzle-orm";
import { CATALOG_UNREAD, COMPILATION_CATALOG_VERSION, ROLE_DENIED } from "@domain-harness/contract";
import type {
  Compilation,
  CompilationCatalogRead,
  CompilationCatalogReadState,
  InventoryEvidence,
  SessionInfo,
  UuidV7,
} from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { isUniqueViolation } from "../db/pg-errors.ts";
import { compilationCatalogReads, compilations } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { accountNames, accountRef, toId } from "../modules/service.ts";
import { validateCatalogReadBody, validateCompilationBody } from "./validate.ts";

/** Throw `role_denied` unless the session is the Buyer's: only the Buyer records reading the catalog. */
export function assertCompilationBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "only the Buyer can record reading the Compilation catalog; nothing was changed",
      subject: "role",
    });
  }
}

const catalogUnread = (): EnvelopeError =>
  new EnvelopeError({
    code: CATALOG_UNREAD,
    message: `the Buyer has not recorded reading catalog ${COMPILATION_CATALOG_VERSION}; nothing was stored`,
    subject: "catalog",
  });

const sequenceTaken = (): EnvelopeError =>
  new EnvelopeError({
    code: "invalid_input",
    message: "this Application already has a Compilation with this sequence; nothing was stored",
    subject: "sequence",
  });

/** One catalog-read row as its wire record, naming `buyerName` for its Buyer. */
function toCatalogRead(
  row: typeof compilationCatalogReads.$inferSelect,
  names: ReadonlyMap<string, string>,
): CompilationCatalogRead {
  return {
    catalogVersion: row.catalogVersion,
    readBy: accountRef(row.readBy, names),
    readAt: row.readAt.toISOString(),
  };
}

const SEQUENCE_TAKEN = "compilations_tenant_application_sequence_key";

/**
 * Record the Buyer's read of the catalog (Buyer only). First failure wins and
 * nothing is written: the role (`role_denied`; the HTTP layer checks it
 * before the body is read and drains the body) → the body (400
 * `invalid_input`, subject `catalogVersion`) → the insert, append-only with
 * `ON CONFLICT (tenant_id, catalog_version) DO NOTHING`. Re-reading the same
 * version stores no duplicate row and answers the existing record.
 */
export async function recordCatalogRead(
  db: RegistryDb,
  session: SessionInfo,
  body: unknown,
): Promise<{ record: CompilationCatalogRead; created: boolean }> {
  assertCompilationBuyer(session);
  const catalogVersion = validateCatalogReadBody(body);
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const id = mintUuidV7();
    await tx
      .insert(compilationCatalogReads)
      .values({ id, tenantId, catalogVersion, readBy: session.accountId, readAt: new Date() })
      .onConflictDoNothing({ target: [compilationCatalogReads.tenantId, compilationCatalogReads.catalogVersion] });
    const [row] = await tx
      .select()
      .from(compilationCatalogReads)
      .where(
        and(
          eq(compilationCatalogReads.tenantId, tenantId),
          eq(compilationCatalogReads.catalogVersion, catalogVersion),
        ),
      );
    if (row === undefined) throw new Error("catalog-read insert returned no row");
    return { record: toCatalogRead(row, await accountNames(tx, tenantId)), created: row.id === id };
  });
}

/**
 * The tenant's read state for the current catalog version: whether the Buyer
 * recorded reading it, by whom, and when. Open to every role. One read under
 * the tenant's scope: non-tenant rows never leave RLS.
 */
export async function getCatalogRead(
  db: RegistryDb,
  session: SessionInfo,
): Promise<CompilationCatalogReadState> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(compilationCatalogReads)
      .where(
        and(
          eq(compilationCatalogReads.tenantId, tenantId),
          eq(compilationCatalogReads.catalogVersion, COMPILATION_CATALOG_VERSION),
        ),
      );
    if (row === undefined) {
      return { catalogVersion: COMPILATION_CATALOG_VERSION, read: false, readBy: null, readAt: null };
    }
    const read = toCatalogRead(row, await accountNames(tx, tenantId));
    return { catalogVersion: read.catalogVersion, read: true, readBy: read.readBy, readAt: read.readAt };
  });
}

/**
 * One Application's Compilation evidence for the Inventory's agent-tool
 * groups (Story 6.5): the distinct agent tool names observed in its
 * Compilations, latest first. Open to every role, read-only, under the
 * tenant's scope: only Applications with at least one Compilation have a
 * row, ordered by Application id, and the wire never names who created an
 * Application.
 */
export async function getInventoryEvidence(db: RegistryDb, session: SessionInfo): Promise<InventoryEvidence> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        applicationId: compilations.applicationId,
        agentToolName: compilations.agentToolName,
        latest: max(compilations.sequence),
      })
      .from(compilations)
      .where(eq(compilations.tenantId, tenantId))
      .groupBy(compilations.applicationId, compilations.agentToolName);
    const toolsByApplication = new Map<string, { readonly name: string; readonly latest: number }[]>();
    for (const row of rows) {
      const tools = toolsByApplication.get(row.applicationId) ?? [];
      tools.push({ name: row.agentToolName, latest: row.latest ?? 0 });
      toolsByApplication.set(row.applicationId, tools);
    }
    const applications = [...toolsByApplication.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([applicationId, tools]) => ({
        applicationId: toId(applicationId),
        agentTools: tools.sort((left, right) => right.latest - left.latest).map((tool) => tool.name),
      }));
    return { applications };
  });
}

/**
 * Throw `catalog_unread` unless the tenant recorded a read of the current
 * catalog version. The HTTP layer calls this between authentication and body
 * parsing, so the gate is the first failure after auth; `ingestCompilation`
 * checks again inside its own transaction.
 */
export async function assertCatalogRead(db: RegistryDb, tenantId: UuidV7): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    const [read] = await tx
      .select({ id: compilationCatalogReads.id })
      .from(compilationCatalogReads)
      .where(
        and(
          eq(compilationCatalogReads.tenantId, tenantId),
          eq(compilationCatalogReads.catalogVersion, COMPILATION_CATALOG_VERSION),
        ),
      );
    if (read === undefined) throw catalogUnread();
  });
}

/**
 * Ingest one Compilation for the credential's tenant. First failure wins and
 * nothing is written: no read recorded for the current catalog version (403
 * `catalog_unread`, subject `catalog`) → the body (400 `invalid_input`,
 * subject naming the field) → the idempotent insert. A replay of the same
 * idempotency key stores no duplicate row and answers the stored Compilation
 * with `replay: true`. A different key reusing an Application's sequence is
 * refused (`invalid_input`, subject `sequence`).
 */
export async function ingestCompilation(
  db: RegistryDb,
  tenantId: UuidV7,
  body: unknown,
): Promise<{ compilation: Compilation; replay: boolean }> {
  return withTenant(db, tenantId, async (tx: RegistryTx) => {
    const [read] = await tx
      .select({ id: compilationCatalogReads.id })
      .from(compilationCatalogReads)
      .where(
        and(
          eq(compilationCatalogReads.tenantId, tenantId),
          eq(compilationCatalogReads.catalogVersion, COMPILATION_CATALOG_VERSION),
        ),
      );
    if (read === undefined) throw catalogUnread();
    const compilation = validateCompilationBody(body);
    const id = mintUuidV7();
    let inserted: (typeof compilations.$inferSelect)[];
    try {
      inserted = await tx
        .insert(compilations)
        .values({
          id,
          tenantId,
          idempotencyKey: compilation.idempotencyKey,
          applicationId: compilation.applicationId,
          typeName: compilation.type,
          schemaVersion: compilation.schemaVersion,
          catalogVersion: compilation.catalogVersion,
          agentToolName: compilation.agentToolName,
          occurredAt: new Date(compilation.occurredAt),
          sequence: compilation.sequence,
          payload: compilation,
        })
        .onConflictDoNothing({ target: [compilations.tenantId, compilations.idempotencyKey] })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, SEQUENCE_TAKEN)) throw sequenceTaken();
      throw error;
    }
    if (inserted[0] !== undefined) return { compilation, replay: false };
    const [stored] = await tx
      .select()
      .from(compilations)
      .where(
        and(eq(compilations.tenantId, tenantId), eq(compilations.idempotencyKey, compilation.idempotencyKey)),
      );
    if (stored === undefined) throw new Error("compilation insert returned no row");
    return { compilation: stored.payload, replay: true };
  });
}

/** The operations the HTTP API needs, bound to one database. */
export interface CompilationsService {
  assertCatalogRead(tenantId: UuidV7): Promise<void>;
  recordCatalogRead(session: SessionInfo, body: unknown): Promise<{ record: CompilationCatalogRead; created: boolean }>;
  getCatalogRead(session: SessionInfo): Promise<CompilationCatalogReadState>;
  getInventoryEvidence(session: SessionInfo): Promise<InventoryEvidence>;
  ingestCompilation(tenantId: UuidV7, body: unknown): Promise<{ compilation: Compilation; replay: boolean }>;
}

export function createCompilationsService(db: RegistryDb): CompilationsService {
  return {
    assertCatalogRead: (tenantId) => assertCatalogRead(db, tenantId),
    recordCatalogRead: (session, body) => recordCatalogRead(db, session, body),
    getCatalogRead: (session) => getCatalogRead(db, session),
    getInventoryEvidence: (session) => getInventoryEvidence(db, session),
    ingestCompilation: (tenantId, body) => ingestCompilation(db, tenantId, body),
  };
}
