/**
 * The Guidance retention sweep (Story 6.7): deletes Guidance event rows
 * older than the Buyer's setting on a schedule. The setting lives in the
 * registry (the Buyer configures it through the panel); the service fetches
 * it with its tenant credential and enforces the 90-day default whenever the
 * fetch fails. Nothing here throws to the scheduler: a failed tick is logged
 * and retried next interval.
 */
import { GUIDANCE_ACCESS_API_PATHS, isRetentionDays } from "@domain-harness/contract";
import { isRecord } from "@domain-harness/contract";
import type { GuidanceEventStore } from "./events.ts";

/** One day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The retention sweep tick: once a day, like the registry's alert schedule cadence. */
export const RETENTION_SWEEP_INTERVAL_MS = DAY_MS;

/** Bound on the retention fetch and its body read; a hung vendor never wedges a sweep. */
export const RETENTION_FETCH_TIMEOUT_MS = 5_000;

/** The outcome of {@link sweepGuidanceEvents}: how many rows the setting deleted. */
export interface RetentionSweepResult {
  readonly retentionDays: number;
  readonly deleted: number;
}

/**
 * Delete every Guidance event recorded strictly before `now - retentionDays`.
 * Returns what the setting deleted. Never throws beyond the store's own
 * transport errors.
 */
export async function sweepGuidanceEvents(input: {
  readonly store: GuidanceEventStore;
  readonly retentionDays: number;
  readonly now: Date;
}): Promise<RetentionSweepResult> {
  const cutoff = new Date(input.now.getTime() - input.retentionDays * DAY_MS).toISOString();
  const deleted = await input.store.deleteGuidanceEventsOlderThan(cutoff);
  return { retentionDays: input.retentionDays, deleted };
}

/** The outcome of {@link fetchRetentionDays}: the registry's setting, or no value. */
export type FetchRetentionResult = { readonly ok: true; readonly days: number } | { readonly ok: false };

/**
 * Fetch the tenant's retention days from the registry's credential-authed
 * retention path. Never throws and never returns a partial value: any
 * transport failure, non-200 status, unparsable body or out-of-range value is
 * `{ ok: false }`, and the caller enforces
 * 90-day default.
 */
export async function fetchRetentionDays(input: {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl: string;
  readonly credential: string;
  readonly timeoutMs?: number;
}): Promise<FetchRetentionResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? RETENTION_FETCH_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetchImpl(`${input.baseUrl}${GUIDANCE_ACCESS_API_PATHS.retention}`, {
      headers: { authorization: `Bearer ${input.credential}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false };
  }
  if (response.status !== 200) return { ok: false };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false };
  }
  if (!isRecord(body) || !isRetentionDays(body["retentionDays"])) return { ok: false };
  return { ok: true, days: body["retentionDays"] };
}
