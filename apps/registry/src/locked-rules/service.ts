import { max, eq } from "drizzle-orm";
import { isUuidV7, ROLE_DENIED } from "@domain-harness/contract";
import type { LockedRuleState, SessionInfo, UuidV7 } from "@domain-harness/contract";
import { validateBundleInput } from "@domain-harness/core";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { lockedRuleChanges } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { accountNames, accountRef } from "../modules/service.ts";
import { currentProjects, treeNodes } from "../projects/current.ts";
import { findStandard, liveSet, liveStandardInfos, lockBundle, standardNotFound } from "../standards/service.ts";
import { currentLockedIds, latestLockedRuleRow } from "./current.ts";
import type { LockedRuleRow } from "./current.ts";

// The shared reads live in ./current.ts so the Standards and Projects services
// can pass the current Locked rules to core without an import cycle.
export { currentLockedIds, currentLockedMarks } from "./current.ts";

/** A validated `POST /v1/standards/{id}/locked-rule` body. */
export interface LockedRuleBody {
  readonly locked: boolean;
}

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was changed`, subject });

/** Validate `{ locked }` (exactly this key, a boolean). Throws `invalid_input` naming `locked`, `body` or the extra key. */
export function validateLockedRuleBody(body: unknown): LockedRuleBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with locked");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== "locked");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const locked = fields["locked"];
  if (typeof locked !== "boolean") throw invalid("locked", "locked must be true or false");
  return { locked };
}

/** The next per-tenant Locked-rule sequence: max + 1, read under the bundle lock. */
async function nextSequence(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(lockedRuleChanges.sequence) })
    .from(lockedRuleChanges)
    .where(eq(lockedRuleChanges.tenantId, tenantId));
  return (row?.sequence ?? 0) + 1;
}

/**
 * Mark or unmark a Standard as a Locked rule (Buyer only) by appending a
 * row; earlier rows are never changed. Checks run under the tenant's bundle
 * lock, first failure wins and nothing is written:
 * the Standard is the tenant's (404 `standard_not_found`) → the role (403
 * `role_denied`) → the body (400 `invalid_input`) → the same state as now
 * (200, nothing written) → for a mark, core validation of the whole proposed
 * bundle input with this Standard added to the Locked rules (409
 * `locked_rule_conflict`). Unmarking never conflicts.
 */
export async function setLockedRule(
  db: RegistryDb,
  session: SessionInfo,
  standardId: unknown,
  body: unknown,
): Promise<LockedRuleState> {
  if (!isUuidV7(standardId)) throw standardNotFound();
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const standard = await findStandard(tx, tenantId, standardId);
    if (standard === undefined) throw standardNotFound();
    if (session.role !== "Buyer") {
      throw new EnvelopeError({
        code: ROLE_DENIED,
        message: "only the Buyer can mark or remove a Locked rule; nothing was changed",
        subject: "role",
      });
    }
    const { locked } = validateLockedRuleBody(body);

    const latest = await latestLockedRuleRow(tx, tenantId, standardId);
    if ((latest?.locked ?? false) === locked) return toState(tx, tenantId, standardId, latest);

    if (locked) {
      const lockedIds = await currentLockedIds(tx, tenantId);
      const verdict = validateBundleInput({
        projects: treeNodes(await currentProjects(tx, tenantId)),
        standards: await liveSet(tx, tenantId),
        lockedStandardIds: [...lockedIds, standardId],
        lockProposal: standardId,
      });
      if (!verdict.ok) throw new EnvelopeError(verdict.error);
    }

    await tx.insert(lockedRuleChanges).values({
      id: mintUuidV7(),
      tenantId,
      standardId,
      sequence: await nextSequence(tx, tenantId),
      locked,
      changedBy: session.accountId,
    });
    return toState(tx, tenantId, standardId, await latestLockedRuleRow(tx, tenantId, standardId));
  });
}

async function toState(
  tx: RegistryTx,
  tenantId: UuidV7,
  standardId: string,
  row: LockedRuleRow | undefined,
): Promise<LockedRuleState> {
  const standard = (await liveStandardInfos(tx, tenantId)).get(standardId);
  if (standard === undefined) throw new Error("a Standard has no live version");
  if (row === undefined) return { standard, locked: false, changedAt: null, changedBy: null };
  return {
    standard,
    locked: row.locked,
    changedAt: row.changedAt.toISOString(),
    changedBy: accountRef(row.changedBy, await accountNames(tx, tenantId)),
  };
}

/** The operations the HTTP API needs, bound to one database. */
export interface LockedRuleService {
  setLockedRule(session: SessionInfo, standardId: string, body: unknown): Promise<LockedRuleState>;
}

export function createLockedRuleService(db: RegistryDb): LockedRuleService {
  return {
    setLockedRule: (session, standardId, body) => setLockedRule(db, session, standardId, body),
  };
}
