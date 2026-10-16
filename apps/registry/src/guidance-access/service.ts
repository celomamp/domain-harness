import { desc, eq, max } from "drizzle-orm";
import {
  encodeRoleTokenBody,
  GRANTABLE_ROLES,
  GUIDANCE_EVENT_RETENTION_DAYS,
  GUIDANCE_ROLE_TOKEN_TTL_MINUTES,
  isGrantableRole,
  ROLE_DENIED,
  toBase64Url,
} from "@domain-harness/contract";
import type {
  GrantableRole,
  GuidanceAccessState,
  GuidanceRoleToken,
  SessionInfo,
  UuidV7,
} from "@domain-harness/contract";
import type { Signer } from "../bundles/sign.ts";
import { EnvelopeError } from "../errors.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { guidanceRetentionChanges, guidanceRoleGrantChanges } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { mintUuidV7 } from "../ids.ts";
import { lockBundle } from "../standards/service.ts";
import { validateGuidanceAccessBody } from "./validate.ts";

/** Throw `role_denied` unless the session is the Buyer's: only the Buyer configures Guidance access. */
export function assertGuidanceAccessBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "only the Buyer can configure Guidance access; nothing was changed",
      subject: "role",
    });
  }
}

/** The latest grant row per grantable role, by role. */
async function latestGrants(
  tx: RegistryTx,
  tenantId: UuidV7,
): Promise<Map<GrantableRole, { granted: boolean; changedAt: Date }>> {
  const rows = await tx
    .select({ role: guidanceRoleGrantChanges.role, granted: guidanceRoleGrantChanges.granted, changedAt: guidanceRoleGrantChanges.changedAt })
    .from(guidanceRoleGrantChanges)
    .where(eq(guidanceRoleGrantChanges.tenantId, tenantId))
    .orderBy(desc(guidanceRoleGrantChanges.sequence));
  const latest = new Map<GrantableRole, { granted: boolean; changedAt: Date }>();
  for (const row of rows) {
    const role = row.role as GrantableRole;
    if (!latest.has(role)) latest.set(role, { granted: row.granted, changedAt: row.changedAt });
  }
  return latest;
}

/** The latest retention row, or undefined when the tenant never configured one. */
async function latestRetention(
  tx: RegistryTx,
  tenantId: UuidV7,
): Promise<{ days: number; changedAt: Date } | undefined> {
  const [row] = await tx
    .select({ days: guidanceRetentionChanges.days, changedAt: guidanceRetentionChanges.changedAt })
    .from(guidanceRetentionChanges)
    .where(eq(guidanceRetentionChanges.tenantId, tenantId))
    .orderBy(desc(guidanceRetentionChanges.sequence))
    .limit(1);
  return row === undefined ? undefined : { days: row.days, changedAt: row.changedAt };
}

function toState(
  latest: ReadonlyMap<GrantableRole, { granted: boolean; changedAt: Date }>,
  retention: { days: number; changedAt: Date } | undefined,
): GuidanceAccessState {
  const grantedRoles = GRANTABLE_ROLES.filter((role) => latest.get(role)?.granted === true);
  const instants = [
    ...[...latest.values()].map((entry) => entry.changedAt.getTime()),
    ...(retention === undefined ? [] : [retention.changedAt.getTime()]),
  ];
  return {
    grantedRoles,
    retentionDays: retention?.days ?? GUIDANCE_EVENT_RETENTION_DAYS,
    updatedAt: instants.length === 0 ? null : new Date(Math.max(...instants)).toISOString(),
  };
}

/** The tenant's Guidance access state. Open to every role. */
export async function getGuidanceAccess(db: RegistryDb, session: SessionInfo): Promise<GuidanceAccessState> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => toState(await latestGrants(tx, tenantId), await latestRetention(tx, tenantId)));
}

/** The next per-tenant sequence for one change table: max + 1, read under the bundle lock. */
async function nextGrantSequence(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(guidanceRoleGrantChanges.sequence) })
    .from(guidanceRoleGrantChanges)
    .where(eq(guidanceRoleGrantChanges.tenantId, tenantId));
  return (row?.sequence ?? 0) + 1;
}

async function nextRetentionSequence(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(guidanceRetentionChanges.sequence) })
    .from(guidanceRetentionChanges)
    .where(eq(guidanceRetentionChanges.tenantId, tenantId));
  return (row?.sequence ?? 0) + 1;
}

/**
 * Set the tenant's grant and retention (Buyer only) by appending rows; earlier
 * rows are never changed. First failure wins and nothing is written: the role
 * (403 `role_denied`) → the body (400 `invalid_input`) → the same state as
 * now (200, nothing written). Runs under the tenant's bundle lock for
 * serialization; nothing here enters a bundle, so no rebuild is triggered.
 */
export async function setGuidanceAccess(
  db: RegistryDb,
  session: SessionInfo,
  body: unknown,
): Promise<GuidanceAccessState> {
  assertGuidanceAccessBuyer(session);
  const { grants, retentionDays } = validateGuidanceAccessBody(body);
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const latest = await latestGrants(tx, tenantId);
    const retention = await latestRetention(tx, tenantId);
    const current = toState(latest, retention);
    const wanted: readonly GrantableRole[] = GRANTABLE_ROLES.filter((role) => grants[role]);
    const sameGrants =
      current.grantedRoles.length === wanted.length && current.grantedRoles.every((role) => wanted.includes(role));
    if (sameGrants && current.retentionDays === retentionDays) return current;
    let grantSequence = await nextGrantSequence(tx, tenantId);
    for (const role of GRANTABLE_ROLES) {
      if ((latest.get(role)?.granted ?? false) === grants[role]) continue;
      await tx.insert(guidanceRoleGrantChanges).values({
        id: mintUuidV7(),
        tenantId,
        role,
        sequence: grantSequence,
        granted: grants[role],
        changedBy: session.accountId,
      });
      grantSequence += 1;
    }
    if ((retention?.days ?? GUIDANCE_EVENT_RETENTION_DAYS) !== retentionDays) {
      await tx.insert(guidanceRetentionChanges).values({
        id: mintUuidV7(),
        tenantId,
        days: retentionDays,
        sequence: await nextRetentionSequence(tx, tenantId),
        changedBy: session.accountId,
      });
    }
    return toState(await latestGrants(tx, tenantId), await latestRetention(tx, tenantId));
  });
}

/** True when the session's role may read Guidance events. The Buyer is always granted. */
export async function roleHoldsGuidanceGrant(db: RegistryDb, session: SessionInfo): Promise<boolean> {
  if (session.role === "Buyer") return true;
  if (!isGrantableRole(session.role)) return false;
  const { tenantId } = session;
  const role = session.role;
  return withTenant(db, tenantId, async (tx) => (await latestGrants(tx, tenantId)).get(role)?.granted === true);
}

/**
 * Mint one role token for the caller's own role, signed with the registry's
 * bundle key. Any role may call; a role without the grant is refused with
 * `role_denied` and no token is minted. The token lives
 * {@link GUIDANCE_ROLE_TOKEN_TTL_MINUTES} minutes and is scoped to the
 * session's tenant.
 */
export async function mintRoleToken(
  db: RegistryDb,
  signer: Signer,
  keyId: string,
  session: SessionInfo,
  now: Date = new Date(),
): Promise<GuidanceRoleToken> {
  if (!(await roleHoldsGuidanceGrant(db, session))) {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "this role holds no grant to read Guidance events; no token was minted",
      subject: "role",
    });
  }
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + GUIDANCE_ROLE_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  const body = encodeRoleTokenBody({ tenantId: session.tenantId, role: session.role, issuedAt, expiresAt });
  const signature = signer.sign(Buffer.from(body, "utf8"));
  return { token: `${keyId}.${body}.${toBase64Url(signature)}`, role: session.role, expiresAt };
}

/** The tenant's current retention days for the service's sweep: the latest row, or the 90-day default. */
export async function getRetentionDays(db: RegistryDb, tenantId: UuidV7): Promise<{ retentionDays: number }> {
  return withTenant(db, tenantId, async (tx) => {
    const retention = await latestRetention(tx, tenantId);
    return { retentionDays: retention?.days ?? GUIDANCE_EVENT_RETENTION_DAYS };
  });
}

/** The operations the HTTP API needs, bound to one database and the bundle signer. */
export interface GuidanceAccessService {
  getGuidanceAccess(session: SessionInfo): Promise<GuidanceAccessState>;
  setGuidanceAccess(session: SessionInfo, body: unknown): Promise<GuidanceAccessState>;
  mintRoleToken(session: SessionInfo): Promise<GuidanceRoleToken>;
  getRetentionDays(tenantId: UuidV7): Promise<{ retentionDays: number }>;
}

export function createGuidanceAccessService(db: RegistryDb, signer: Signer): GuidanceAccessService {
  return {
    getGuidanceAccess: (session) => getGuidanceAccess(db, session),
    setGuidanceAccess: (session, body) => setGuidanceAccess(db, session, body),
    mintRoleToken: (session) => mintRoleToken(db, signer, signer.keyId, session),
    getRetentionDays: (tenantId) => getRetentionDays(db, tenantId),
  };
}
