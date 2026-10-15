import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { isUuidV7, ROLE_DENIED } from "@domain-harness/contract";
import type { AcceptedDeviationAlert, EffectiveSlot, SessionInfo, UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import { toId } from "../modules/service.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import {
  acceptedDeviationAlertDismissals,
  acceptedDeviationAlerts,
  acceptedDeviationRecords,
  applications,
} from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";

/** How often `serve-cli` evaluates the alert schedule, in seconds. */
export const ALERT_TICK_SECONDS = 60;

/** Throw `role_denied` unless the session is the Buyer's: only the Buyer dismisses an alert. */
export function assertAcceptedDeviationAlertBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "The Buyer dismisses the Accepted-deviation alert.",
      subject: "role",
    });
  }
}

/** How many alerts raising found due and how many tenants could not be raised. */
export interface AlertsRaised {
  readonly raised: number;
  readonly failed: number;
}

interface TenantRow extends Record<string, unknown> {
  tenant_id: string;
}

/**
 * The tenants holding a live acceptance at `now`, read outside any tenant
 * context through the SECURITY DEFINER function of migration 0014 — the one
 * narrow cross-tenant access. Every returned id is validated before use: the
 * table itself is never trusted blindly.
 */
async function liveTenantIds(db: RegistryDb, now: Date): Promise<UuidV7[]> {
  const { rows } = await db.execute<TenantRow>(
    sql`select tenant_id::text as tenant_id from live_accepted_deviation_alert_tenants(${now})`,
  );
  const ids: UuidV7[] = [];
  for (const row of rows) {
    if (isUuidV7(row["tenant_id"])) ids.push(row["tenant_id"]);
  }
  return ids;
}

/**
 * Raise every due boundary of one tenant's live acceptances. A boundary is
 * `start + k * alertIntervalHours` (k >= 1) that `now` has reached and is
 * still strictly before the acceptance's end; insert one row per boundary
 * with ON CONFLICT DO NOTHING, so a repeat tick (or a catch-up that meets a
 * raised boundary again) writes nothing and raises nothing twice.
 */
async function raiseTenantAlerts(tx: RegistryTx, tenantId: UuidV7, now: Date): Promise<number> {
  const nowMs = now.getTime();
  const live = await tx
    .select({
      id: acceptedDeviationRecords.id,
      interval: acceptedDeviationRecords.alertIntervalHours,
      startsAt: acceptedDeviationRecords.startsAt,
      endsAt: acceptedDeviationRecords.endsAt,
    })
    .from(acceptedDeviationRecords)
    .where(
      and(
        eq(acceptedDeviationRecords.tenantId, tenantId),
        lte(acceptedDeviationRecords.startsAt, now),
        gt(acceptedDeviationRecords.endsAt, now),
      ),
    );
  const inserts: { id: UuidV7; tenantId: UuidV7; acceptanceId: UuidV7; dueAt: Date; raisedAt: Date }[] = [];
  for (const acceptance of live) {
    const startMs = acceptance.startsAt.getTime();
    const endMs = acceptance.endsAt.getTime();
    for (let boundary = startMs + acceptance.interval * 3_600_000; boundary <= nowMs && boundary < endMs; boundary += acceptance.interval * 3_600_000) {
      inserts.push({
        id: mintUuidV7(),
        tenantId,
        acceptanceId: toId(acceptance.id),
        dueAt: new Date(boundary),
        raisedAt: now,
      });
    }
  }
  /** Rows per INSERT statement: a long legal window stays fixed-size. */
  const BATCH = 1_000;
  let raised = 0;
  for (let from = 0; from < inserts.length; from += BATCH) {
    const inserted = await tx
      .insert(acceptedDeviationAlerts)
      .values(inserts.slice(from, from + BATCH))
      .onConflictDoNothing()
      .returning();
    raised += inserted.length;
  }
  return raised;
}

/**
 * Evaluate the alert schedule with the registry's own clock: raise every
 * deferred boundary the clock has passed, oldest first (the insert order), one
 * alert per boundary forever. Tenants are raised one at a time in their own
 * `withTenant` scope, so a failed tenant never starves the others — its
 * failure is only counted.
 */
export async function raiseDueAlerts(db: RegistryDb, now: Date): Promise<AlertsRaised> {
  const tenants = await liveTenantIds(db, now);
  let raised = 0;
  let failed = 0;
  for (const tenantId of tenants) {
    try {
      raised += await withTenant(db, tenantId, (tx) => raiseTenantAlerts(tx, tenantId, now));
    } catch {
      failed += 1;
    }
  }
  return { raised, failed };
}

/** One joined read row as its wire alert. */
function toAlert(row: {
  id: string;
  acceptanceId: string;
  applicationId: string;
  applicationName: string;
  standardId: string;
  standardVersion: number;
  slotModuleKind: string;
  slotKind: string;
  slotName: string;
  subject: string;
  end: Date;
  dueAt: Date;
  raisedAt: Date;
}): AcceptedDeviationAlert {
  return {
    id: toId(row.id),
    acceptanceId: toId(row.acceptanceId),
    applicationId: toId(row.applicationId),
    applicationName: row.applicationName,
    standardId: toId(row.standardId),
    standardVersion: row.standardVersion,
    slot: { moduleKind: row.slotModuleKind as EffectiveSlot["moduleKind"], slotKind: row.slotKind, name: row.slotName },
    subject: row.subject,
    end: row.end.toISOString(),
    dueAt: row.dueAt.toISOString(),
    raisedAt: row.raisedAt.toISOString(),
  };
}

const alertNotFound = (): EnvelopeError =>
  new EnvelopeError({
    code: "not_found",
    message: "no Accepted-deviation alert with this id is raised in this Company; nothing was changed",
    subject: "alertId",
  });

/**
 * The tenant's live alerts: raised, not dismissed, and the acceptance's
 * window still open (`end > now`, the registry clock). One read under the
 * tenant's scope, joined to the acceptance and the Application so the alert
 * names the Application description, the Standard id and version, the slot
 * and subject and the acceptance's end; ordered (dueAt asc, id asc).
 */
export async function listAlerts(
  db: RegistryDb,
  session: SessionInfo,
): Promise<{ alerts: AcceptedDeviationAlert[] }> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const now = new Date();
    const rows = await tx
      .select({
        id: acceptedDeviationAlerts.id,
        acceptanceId: acceptedDeviationAlerts.acceptanceId,
        applicationId: acceptedDeviationRecords.applicationId,
        applicationName: applications.description,
        standardId: acceptedDeviationRecords.standardId,
        standardVersion: acceptedDeviationRecords.standardVersion,
        slotModuleKind: acceptedDeviationRecords.slotModuleKind,
        slotKind: acceptedDeviationRecords.slotKind,
        slotName: acceptedDeviationRecords.slotName,
        subject: acceptedDeviationRecords.subject,
        end: acceptedDeviationRecords.endsAt,
        dueAt: acceptedDeviationAlerts.dueAt,
        raisedAt: acceptedDeviationAlerts.raisedAt,
      })
      .from(acceptedDeviationAlerts)
      .innerJoin(
        acceptedDeviationRecords,
        and(
          eq(acceptedDeviationRecords.tenantId, acceptedDeviationAlerts.tenantId),
          eq(acceptedDeviationRecords.id, acceptedDeviationAlerts.acceptanceId),
        ),
      )
      .innerJoin(
        applications,
        and(
          eq(applications.tenantId, acceptedDeviationRecords.tenantId),
          eq(applications.id, acceptedDeviationRecords.applicationId),
        ),
      )
      .where(
        and(
          eq(acceptedDeviationAlerts.tenantId, tenantId),
          gt(acceptedDeviationRecords.endsAt, now),
          sql`not exists (select 1 from ${acceptedDeviationAlertDismissals} where ${acceptedDeviationAlerts.tenantId} = ${acceptedDeviationAlertDismissals.tenantId} and ${acceptedDeviationAlerts.id} = ${acceptedDeviationAlertDismissals.alertId})`,
        ),
      )
      .orderBy(asc(acceptedDeviationAlerts.dueAt), asc(acceptedDeviationAlerts.id));
    return { alerts: rows.map(toAlert) };
  });
}

/**
 * Dismiss one alert (the Buyer only). First failure wins and nothing is
 * written: the role (`role_denied`; the HTTP layer checks it before the body
 * is read and drains it) → the alert id in the path (400, subject `alertId`)
 * → the body (400, subject `alertId`) → the alert is raised in this tenant
 * (404 `not_found`, subject `alertId`) → the ON CONFLICT DO NOTHING insert
 * (`accepted_deviation_alert_dismissals`, append-only; a repeat answers the
 * same `{ dismissed: true }` and stays one row). The body must be exactly
 * `{ alertId }`, and its id the one the path names.
 */
export async function dismissAlert(
  db: RegistryDb,
  session: SessionInfo,
  alertId: string,
  body: unknown,
): Promise<{ dismissed: true }> {
  assertAcceptedDeviationAlertBuyer(session);
  if (!isUuidV7(alertId)) {
    throw new EnvelopeError({
      code: "invalid_input",
      message: "alertId must be the id of a raised Accepted-deviation alert; nothing was changed",
      subject: "alertId",
    });
  }
  const input = validateDismissalBody(body);
  if (input !== alertId) {
    throw new EnvelopeError({
      code: "invalid_input",
      message: "the body's alertId must be the one the path names; nothing was changed",
      subject: "alertId",
    });
  }
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const [raised] = await tx
      .select({ id: acceptedDeviationAlerts.id })
      .from(acceptedDeviationAlerts)
      .where(and(eq(acceptedDeviationAlerts.tenantId, tenantId), eq(acceptedDeviationAlerts.id, input)));
    if (raised === undefined) throw alertNotFound();
    await tx
      .insert(acceptedDeviationAlertDismissals)
      .values({
        id: mintUuidV7(),
        tenantId,
        alertId: input,
        dismissedBy: session.accountId,
        dismissedAt: new Date(),
      })
      .onConflictDoNothing();
    return { dismissed: true } as const;
  });
}

/**
 * Exactly `{ alertId }` as submitted: any other key set, a missing, empty,
 * non-string or non-UUID id is `invalid_input` under the alert id's own name.
 */
function validateDismissalBody(body: unknown): UuidV7 {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new EnvelopeError({
      code: "invalid_input",
      message: "the body must be { \"alertId\": ... }; nothing was changed",
      subject: "alertId",
    });
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => key !== "alertId");
  const value = record["alertId"];
  if (extra !== undefined || typeof value !== "string" || value.trim() === "" || !isUuidV7(value)) {
    throw new EnvelopeError({
      code: "invalid_input",
      message: "alertId must be the id of a raised Accepted-deviation alert; nothing was changed",
      subject: "alertId",
    });
  }
  // Canonical ids only: mintUuidV7 writes are UUIDv7, so a non-canonical
  // spelling names a raised alert just as dead as an unknown one.
  return value;
}

/** The operations the HTTP API and the serve tick need, bound to one database. */
export interface AcceptedDeviationAlertsService {
  /** Evaluate the schedule with the registry's clock (the serve-cli tick). */
  raiseDueAlerts(now: Date): Promise<AlertsRaised>;
  listAlerts(session: SessionInfo): Promise<{ alerts: AcceptedDeviationAlert[] }>;
  dismissAlert(session: SessionInfo, alertId: string, body: unknown): Promise<{ dismissed: true }>;
}

export function createAcceptedDeviationAlertsService(db: RegistryDb): AcceptedDeviationAlertsService {
  return {
    raiseDueAlerts: (now) => raiseDueAlerts(db, now),
    listAlerts: (session) => listAlerts(db, session),
    dismissAlert: (session, alertId, body) => dismissAlert(db, session, alertId, body),
  };
}
