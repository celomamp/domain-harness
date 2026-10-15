/**
 * Local last-seen bundle state (Story 8.1): a JSON file mapping tenant id to
 * its last verified `{ sequence, hash }` pointer. First run records; the
 * file is written only on success, atomically (temp file plus rename). A
 * missing, unreadable, or malformed file reads as no entries; a malformed
 * entry reads as no entry for that tenant only. Nothing here throws.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** The last verified pointer for one tenant. */
export interface StoredBundlePointer {
  readonly sequence: number;
  readonly hash: string;
}

/** True when `value` is a well-formed stored pointer. Never throws. */
export function isStoredBundlePointer(value: unknown): value is StoredBundlePointer {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const sequence = record["sequence"];
    const hash = record["hash"];
    if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) return false;
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the whole state file. Never throws. Missing, unreadable, or
 * non-object content yields no entries; malformed entries are skipped so a
 * corrupt entry affects only its own tenant.
 */
export function readStateFile(statePath: string): Record<string, StoredBundlePointer> {
  try {
    const text = readFileSync(statePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {};
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const state: Record<string, StoredBundlePointer> = {};
    for (const [tenantId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isStoredBundlePointer(entry)) {
        state[tenantId] = { sequence: entry.sequence, hash: entry.hash };
      }
    }
    return state;
  } catch {
    return {};
  }
}

/**
 * Write the whole state file atomically (temp file in the same directory
 * plus rename). Never throws. Returns true on success, false otherwise.
 */
export function writeStateFile(statePath: string, state: Record<string, StoredBundlePointer>): boolean {
  let tmpPath: string | null = null;
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    tmpPath = `${statePath}.tmp.${String(process.pid)}.${randomBytes(8).toString("hex")}`;
    writeFileSync(tmpPath, `${JSON.stringify(state)}\n`, "utf8");
    renameSync(tmpPath, statePath);
    return true;
  } catch {
    if (tmpPath !== null) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // Ignore cleanup failures; the write already failed.
      }
    }
    return false;
  }
}

/**
 * Read one tenant's entry. Never throws. Returns null when there is no
 * entry or the entry is corrupt.
 */
export function readStateEntry(statePath: string, tenantId: string): StoredBundlePointer | null {
  try {
    const state = readStateFile(statePath);
    const entry = state[tenantId];
    if (entry === undefined) return null;
    return isStoredBundlePointer(entry) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Record one tenant's entry, preserving every other tenant's entry.
 * Never throws. Returns true on success, false otherwise.
 */
export function writeStateEntry(statePath: string, tenantId: string, entry: StoredBundlePointer): boolean {
  try {
    if (!isStoredBundlePointer(entry)) return false;
    const state = readStateFile(statePath);
    const next: Record<string, StoredBundlePointer> = {
      ...state,
      [tenantId]: { sequence: entry.sequence, hash: entry.hash },
    };
    return writeStateFile(statePath, next);
  } catch {
    return false;
  }
}
