import { and, desc, eq, max } from "drizzle-orm";
import { sameSlot } from "@domain-harness/core";
import { ROLE_DENIED } from "@domain-harness/contract";
import type {
  AcceptedDeviationRecord,
  SessionInfo,
  UuidV7,
} from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { acceptedDeviationRecords, applications } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { currentProjects } from "../projects/current.ts";
import { applicationNotFound } from "../applications/service.ts";
import { accountRef, accountNames, toId } from "../modules/service.ts";
import { resolveEffectiveStandards } from "../projects/service.ts";
import { lockBundle } from "../standards/service.ts";
import { assertAcceptedDeviationPlan } from "../tenancy/plan.ts";
import { validateAcceptedDeviationBody } from "./validate.ts";

/** Throw `role_denied` unless the session is the Buyer's: only the Buyer records an acceptance. */
export function assertAcceptedDeviationBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "A Builder cannot accept their own Deviation. The Buyer records the acceptance.",
      subject: "role",
    });
  }
}

/** The next per-tenant sequence: max + 1, read under the bundle lock. */
async function nextSequence(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(acceptedDeviationRecords.sequence) })
    .from(acceptedDeviationRecords)
    .where(eq(acceptedDeviationRecords.tenantId, tenantId));
  return (row?.sequence ?? 0) + 1;
}

/** One stored acceptance row as its wire record, naming `buyerName` for its Buyer. */
function toRecord(
  row: typeof acceptedDeviationRecords.$inferSelect,
  names: ReadonlyMap<string, string>,
): AcceptedDeviationRecord {
  return {
    id: toId(row.id),
    applicationId: toId(row.applicationId),
    standardId: toId(row.standardId),
    standardVersion: row.standardVersion,
    slot: { moduleKind: row.slotModuleKind, slotKind: row.slotKind, name: row.slotName },
    subject: row.subject,
    start: row.startsAt.toISOString(),
    end: row.endsAt.toISOString(),
    buyer: accountRef(row.buyer, names),
    justification: row.justification,
    alertIntervalHours: row.alertIntervalHours,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The key-resolve failure: the submitted (Standard id, slot) pair is absent from the Effective set. */
const unresolvedKey = (): EnvelopeError =>
  new EnvelopeError({
    code: "invalid_input",
    message: "no Standard with this id in this Conflict slot; nothing was changed",
    subject: "standardId",
  });

/**
 * The instant a UTC ISO-8601 text names, or throws `invalid_input` naming its
 * own field. `isUtcIso` is regex-only, so a calendar-invalid text (February
 * 30; a non-calendar text making `Date.parse` yield NaN too) must not pass
 * the window gate as a rolled-over or NaN instant: the date must round-trip
 * back to what was submitted.
 */
const utcInstant = (value: string, subject: string): number => {
  const at = Date.parse(value);
  const iso = Number.isFinite(at) ? new Date(at).toISOString() : null;
  if (iso === null || (iso !== value && iso.replace(".000Z", "Z") !== value)) {
    throw new EnvelopeError({
      code: "invalid_input",
      message: `${subject} is not a UTC ISO-8601 timestamp for a real calendar instant; nothing was changed`,
      subject,
    });
  }
  return at;
};

/**
 * Record an acceptance (Buyer only). First failure wins and nothing is
 * written: the role (`role_denied`; the HTTP layer checks it before the body
 * is read and drains the body) → the tenant's plan includes recording an
 * Accepted deviation (`plan_refused`, subject `plan`) → the body (400
 * `invalid_input`, subject naming the field) → the Application is the
 * tenant's (404 `application_not_found`, subject `applicationId`) → the key
 * resolves in the Application's current Effective Standard set under the
 * tenant's bundle lock (400, subject `standardId`) → each window instant is
 * calendar-valid (400, naming `start` or `end`) → the window `end > start`
 * (400, subject `end`) → the insert (`accepted_deviation_records`,
 * append-only). `standardVersion` is never submitted: the registry stores
 * the resolved entry's canonical slot and its live Standard version.
 */
export async function recordAcceptance(
  db: RegistryDb,
  session: SessionInfo,
  body: unknown,
): Promise<AcceptedDeviationRecord> {
  assertAcceptedDeviationBuyer(session);
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    // The capability may not exist on this plan at all, so the plan comes
    // before the body: field errors would invite a fix that can never succeed.
    await assertAcceptedDeviationPlan(tx, tenantId);
    const input = validateAcceptedDeviationBody(body);

    const [application] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.tenantId, tenantId), eq(applications.id, input.applicationId)));
    if (application === undefined) throw applicationNotFound();

    // The resolution runs in the same transaction under the same bundle lock
    // the bundle build takes, so the Standard version stored is the one the
    // next built bundle carries.
    const current = await currentProjects(tx, tenantId);
    const project = current.get(application.projectId);
    if (project === undefined) throw new Error("an Application's Project is missing");
    const set = await resolveEffectiveStandards(tx, tenantId, project, current);
    const entry = set.standards.find(
      (candidate) => candidate.standard.id === input.standardId && sameSlot(candidate.slot, input.slot),
    );
    if (entry === undefined) throw unresolvedKey();
    // An invalid instant would make the window gate compare NaNs or a
    // rolled-over calendar-invalid date, so each field is refused naming
    // itself first; then an end not strictly after its start is never live
    // (`start <= now < end`), so it is unrecordable, nothing written.
    const startsAt = utcInstant(input.start, "start");
    const endsAt = utcInstant(input.end, "end");
    if (!(endsAt > startsAt)) {
      throw new EnvelopeError({
        code: "invalid_input",
        message: "an end not strictly after its start can never be live; nothing was changed",
        subject: "end",
      });
    }

    const now = new Date();
    const [row] = await tx
      .insert(acceptedDeviationRecords)
      .values({
        id: mintUuidV7(),
        tenantId,
        sequence: await nextSequence(tx, tenantId),
        applicationId: input.applicationId,
        standardId: input.standardId,
        standardVersion: entry.standard.version,
        slotModuleKind: entry.slot.moduleKind,
        slotKind: entry.slot.slotKind,
        slotName: entry.slot.name,
        subject: input.subject,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        buyer: session.accountId,
        justification: input.justification,
        alertIntervalHours: input.alertIntervalHours,
        createdAt: now,
      })
      .returning();
    if (row === undefined) throw new Error("insert returned no row");
    return toRecord(row, await accountNames(tx, tenantId));
  });
}

/**
 * The tenant's acceptance records, newest sequence first, each with its
 * stored extras (the Buyer, the justification, the alert interval and the
 * creation time — DR16). Open to every role, but the plan check runs here
 * too, so a Community tenant shows the refusal whatever its role. One read
 * under the tenant's scope: non-tenant rows never leave RLS.
 */
export async function listAcceptances(
  db: RegistryDb,
  session: SessionInfo,
): Promise<{ records: AcceptedDeviationRecord[] }> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await assertAcceptedDeviationPlan(tx, tenantId);
    const rows = await tx
      .select()
      .from(acceptedDeviationRecords)
      .where(eq(acceptedDeviationRecords.tenantId, tenantId))
      .orderBy(desc(acceptedDeviationRecords.sequence));
    const names = await accountNames(tx, tenantId);
    return { records: rows.map((row) => toRecord(row, names)) };
  });
}

/** The operations the HTTP API needs, bound to one database. */
export interface AcceptedDeviationsService {
  recordAcceptance(session: SessionInfo, body: unknown): Promise<AcceptedDeviationRecord>;
  listAcceptances(session: SessionInfo): Promise<{ records: AcceptedDeviationRecord[] }>;
}

export function createAcceptedDeviationsService(db: RegistryDb): AcceptedDeviationsService {
  return {
    recordAcceptance: (session, body) => recordAcceptance(db, session, body),
    listAcceptances: (session) => listAcceptances(db, session),
  };
}
