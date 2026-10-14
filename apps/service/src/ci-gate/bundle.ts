import type { AcceptedDeviation, EffectiveStandardSet } from "@domain-harness/contract";

/** Default staleness bound in hours when the snapshot omits `stalenessBoundHours` (AD-21). */
export const DEFAULT_STALENESS_BOUND_HOURS = 24;

export interface ActiveBundleSnapshot {
  readonly hash: string;
  readonly issuedAt: string;
  readonly applications: readonly unknown[];
  readonly effectiveSet: EffectiveStandardSet;
  readonly accepted: readonly AcceptedDeviation[];
  readonly stalenessBoundHours?: number | null | undefined;
  readonly frozenUntil?: string | null | undefined;
}

export type BundleSourceOutcome =
  | { readonly ok: true; readonly snapshot: ActiveBundleSnapshot }
  | { readonly ok: false; readonly reason: "verify-failed" }
  | { readonly ok: false; readonly reason: "missing-set" };

export type BundleSource =
  | (() => Promise<unknown>)
  | { get(): Promise<unknown> }
  | { load(): Promise<unknown> }
  | { snapshot: unknown };

export async function loadBundleSnapshot(source: BundleSource): Promise<BundleSourceOutcome> {
  let raw: unknown;
  try {
    if (typeof source === "function") {
      raw = await source();
    } else if (isGetSource(source)) {
      raw = await source.get();
    } else if (isLoadSource(source)) {
      raw = await source.load();
    } else if (isSnapshotSource(source)) {
      raw = source.snapshot;
    } else {
      raw = source;
    }
  } catch {
    return { ok: false, reason: "verify-failed" };
  }

  const record = asRecord(raw);
  if (!record) return { ok: false, reason: "verify-failed" };

  if (record["ok"] === false) {
    return { ok: false, reason: record["reason"] === "missing-set" ? "missing-set" : "verify-failed" };
  }
  if (record["kind"] === "verify-failed") return { ok: false, reason: "verify-failed" };
  if (record["kind"] === "missing-set") return { ok: false, reason: "missing-set" };
  if (record["kind"] === "ok" && isRecord(record["snapshot"])) {
    return { ok: true, snapshot: record["snapshot"] as unknown as ActiveBundleSnapshot };
  }
  if (record["ok"] === true && isRecord(record["snapshot"])) {
    return { ok: true, snapshot: record["snapshot"] as unknown as ActiveBundleSnapshot };
  }
  if (
    typeof record["hash"] === "string" &&
    typeof record["issuedAt"] === "string" &&
    Array.isArray(record["applications"])
  ) {
    return { ok: true, snapshot: record as unknown as ActiveBundleSnapshot };
  }
  return { ok: false, reason: "verify-failed" };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isGetSource(value: unknown): value is { get(): Promise<unknown> } {
  return isRecord(value) && typeof value["get"] === "function";
}
function isLoadSource(value: unknown): value is { load(): Promise<unknown> } {
  return isRecord(value) && typeof value["load"] === "function";
}
function isSnapshotSource(value: unknown): value is { snapshot: unknown } {
  return isRecord(value) && "snapshot" in value;
}

export function applicationIdsOf(snapshot: ActiveBundleSnapshot): ReadonlyArray<string> {
  if (!Array.isArray(snapshot.applications)) return [];
  return snapshot.applications.map((item) => {
    if (typeof item === "string") return item;
    const record = asRecord(item);
    if (record) {
      if (typeof record["id"] === "string") return record["id"];
      if (typeof record["applicationId"] === "string") return record["applicationId"];
    }
    return String(item);
  });
}
