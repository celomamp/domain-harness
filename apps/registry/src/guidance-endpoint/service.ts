import { desc, eq, max } from "drizzle-orm";
import { ROLE_DENIED } from "@domain-harness/contract";
import type { GuidanceEndpointState, SessionInfo, UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { guidanceEndpointChanges } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { lockBundle } from "../standards/service.ts";
import { validateGuidanceEndpointBody } from "./validate.ts";

/** Throw `role_denied` unless the session is the Buyer's: only the Buyer sets the Guidance endpoint. */
export function assertGuidanceEndpointBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "only the Buyer can set the Company Guidance endpoint; nothing was changed",
      subject: "role",
    });
  }
}

/** The tenant's current Guidance endpoint: its highest-sequence change row, or both `null` when there is none. */
export async function currentGuidanceEndpoint(tx: RegistryTx, tenantId: UuidV7): Promise<GuidanceEndpointState> {
  const [row] = await tx
    .select({ url: guidanceEndpointChanges.url, changedAt: guidanceEndpointChanges.changedAt })
    .from(guidanceEndpointChanges)
    .where(eq(guidanceEndpointChanges.tenantId, tenantId))
    .orderBy(desc(guidanceEndpointChanges.sequence))
    .limit(1);
  return row === undefined ? { url: null, changedAt: null } : { url: row.url, changedAt: row.changedAt.toISOString() };
}

/** The tenant's Guidance endpoint. Open to every role. */
export async function getGuidanceEndpoint(db: RegistryDb, session: SessionInfo): Promise<GuidanceEndpointState> {
  const { tenantId } = session;
  return withTenant(db, tenantId, (tx) => currentGuidanceEndpoint(tx, tenantId));
}

/** The next per-tenant sequence: max + 1, read under the bundle lock. */
async function nextSequence(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(guidanceEndpointChanges.sequence) })
    .from(guidanceEndpointChanges)
    .where(eq(guidanceEndpointChanges.tenantId, tenantId));
  return (row?.sequence ?? 0) + 1;
}

/**
 * Set the tenant's Company Guidance endpoint URL (Buyer only) by appending a
 * row; earlier rows are never changed. First failure wins and nothing is
 * written: the role (403 `role_denied`) → the body (400 `invalid_input`,
 * subject `body`, the extra key or `url`) → the same URL as now (200,
 * nothing written). Runs under the tenant's bundle lock.
 */
export async function setGuidanceEndpoint(
  db: RegistryDb,
  session: SessionInfo,
  body: unknown,
): Promise<GuidanceEndpointState> {
  assertGuidanceEndpointBuyer(session);
  const url = validateGuidanceEndpointBody(body);
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const current = await currentGuidanceEndpoint(tx, tenantId);
    if (current.url === url) return current;
    await tx.insert(guidanceEndpointChanges).values({
      id: mintUuidV7(),
      tenantId,
      sequence: await nextSequence(tx, tenantId),
      url,
      changedBy: session.accountId,
    });
    return currentGuidanceEndpoint(tx, tenantId);
  });
}

/** The operations the HTTP API needs, bound to one database. */
export interface GuidanceEndpointService {
  getGuidanceEndpoint(session: SessionInfo): Promise<GuidanceEndpointState>;
  setGuidanceEndpoint(session: SessionInfo, body: unknown): Promise<GuidanceEndpointState>;
}

export function createGuidanceEndpointService(db: RegistryDb): GuidanceEndpointService {
  return {
    getGuidanceEndpoint: (session) => getGuidanceEndpoint(db, session),
    setGuidanceEndpoint: (session, body) => setGuidanceEndpoint(db, session, body),
  };
}
