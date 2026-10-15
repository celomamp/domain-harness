/**
 * File-backed binding ledger (Story 8.2): the local binding file holding the
 * Application id ↔ repository fingerprint TOFU bindings plus the recorded
 * refusals.
 *
 * File form: JSON `{ bindings: { appId: fingerprint }, refusals: [...] }`,
 * written atomically (temp file plus rename) like the 8.1 bundle state. A
 * missing, unreadable, or corrupt file reads as an empty ledger. Nothing
 * here throws.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { UuidV7 } from "@domain-harness/contract";
import type {
  BindingLedger,
  GateBinding,
  GateBindingRefusal,
} from "@domain-harness/gate";

/** The JSON file shape. */
export interface StoredBindingFile {
  readonly bindings: Record<string, string>;
  readonly refusals: readonly GateBindingRefusal[];
}

function isGateBindingRefusal(value: unknown): value is GateBindingRefusal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["applicationId"] === "string" &&
    typeof record["presentedFingerprint"] === "string" &&
    typeof record["boundFingerprint"] === "string"
  );
}

/**
 * Read and normalize the whole binding file. Never throws. Missing,
 * unreadable, or non-object content yields an empty ledger; malformed
 * binding values are skipped and a malformed refusals list reads as empty.
 */
export function readBindingFile(bindingPath: string): StoredBindingFile {
  try {
    if (typeof bindingPath !== "string" || bindingPath === "") {
      return { bindings: {}, refusals: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(bindingPath, "utf8")) as unknown;
    } catch {
      return { bindings: {}, refusals: [] };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { bindings: {}, refusals: [] };
    }
    const record: Record<string, unknown> = parsed as Record<string, unknown>;
    const bindings: Record<string, string> = {};
    const rawBindings = record["bindings"];
    if (
      typeof rawBindings === "object" &&
      rawBindings !== null &&
      !Array.isArray(rawBindings)
    ) {
      for (const [appId, fingerprint] of Object.entries(
        rawBindings as Record<string, unknown>,
      )) {
        if (appId !== "" && typeof fingerprint === "string") {
          bindings[appId] = fingerprint;
        }
      }
    }
    const refusals: GateBindingRefusal[] = [];
    const rawRefusals: unknown = record["refusals"];
    if (Array.isArray(rawRefusals)) {
      for (const item of rawRefusals) {
        if (isGateBindingRefusal(item)) {
          refusals.push({
            applicationId: item.applicationId,
            presentedFingerprint: item.presentedFingerprint,
            boundFingerprint: item.boundFingerprint,
          });
        }
      }
    }
    return { bindings, refusals };
  } catch {
    return { bindings: {}, refusals: [] };
  }
}

/**
 * Write the whole binding file atomically (temp file in the same directory
 * plus rename). Never throws. Returns true on success, false otherwise.
 */
export function writeBindingFile(
  bindingPath: string,
  data: StoredBindingFile,
): boolean {
  let tmpPath: string | null = null;
  try {
    if (typeof bindingPath !== "string" || bindingPath === "") return false;
    const bindings: Record<string, string> = {};
    const rawData: unknown = data;
    const rawBindings: unknown =
      typeof rawData === "object" && rawData !== null
        ? (rawData as Record<string, unknown>)["bindings"]
        : undefined;
    if (
      typeof rawBindings === "object" &&
      rawBindings !== null &&
      !Array.isArray(rawBindings)
    ) {
      for (const [appId, fingerprint] of Object.entries(
        rawBindings as Record<string, unknown>,
      )) {
        if (appId !== "" && typeof fingerprint === "string") {
          bindings[appId] = fingerprint;
        }
      }
    }
    const refusals: GateBindingRefusal[] = [];
    const rawRefusals: unknown =
      typeof rawData === "object" && rawData !== null
        ? (rawData as Record<string, unknown>)["refusals"]
        : undefined;
    if (Array.isArray(rawRefusals)) {
      for (const item of rawRefusals) {
        if (isGateBindingRefusal(item)) refusals.push({ ...item });
      }
    }
    mkdirSync(dirname(bindingPath), { recursive: true });
    tmpPath = `${bindingPath}.tmp.${String(process.pid)}.${randomBytes(8).toString("hex")}`;
    writeFileSync(tmpPath, `${JSON.stringify({ bindings, refusals })}\n`, "utf8");
    renameSync(tmpPath, bindingPath);
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
 * Read one Application's binding. Never throws. Returns null when there is
 * no binding or the file cannot be read.
 */
export function readBinding(
  bindingPath: string,
  applicationId: string,
): GateBinding | null {
  try {
    if (typeof applicationId !== "string" || applicationId === "") return null;
    const file = readBindingFile(bindingPath);
    const fingerprint = file.bindings[applicationId];
    if (typeof fingerprint !== "string") return null;
    return { applicationId: applicationId as UuidV7, fingerprint };
  } catch {
    return null;
  }
}

/**
 * Bind on first use: when the Application already has a binding the existing
 * entry wins (TOFU pass-through, never overwritten); otherwise the new
 * fingerprint is recorded best-effort and returned. Never throws.
 */
export function writeBinding(
  bindingPath: string,
  applicationId: string,
  fingerprint: string,
): GateBinding | null {
  try {
    if (typeof applicationId !== "string" || applicationId === "") return null;
    if (typeof fingerprint !== "string") return null;
    const file = readBindingFile(bindingPath);
    const existing = file.bindings[applicationId];
    if (typeof existing === "string") {
      return { applicationId: applicationId as UuidV7, fingerprint: existing };
    }
    const next: StoredBindingFile = {
      bindings: { ...file.bindings, [applicationId]: fingerprint },
      refusals: [...file.refusals],
    };
    try {
      writeBindingFile(bindingPath, next);
    } catch {
      // Best-effort persist: the binding is still returned.
    }
    return { applicationId: applicationId as UuidV7, fingerprint };
  } catch {
    return null;
  }
}

/**
 * A file-backed {@link BindingLedger} over one binding-file path.
 * Best-effort persistence: I/O failures never reject — reads fall back to
 * null/empty and writes still return the in-memory record so the gate fails
 * closed downstream instead of throwing.
 */
export function createFileBindingLedger(bindingPath: string): BindingLedger {
  return {
    async getBinding(applicationId: UuidV7): Promise<GateBinding | null> {
      try {
        await Promise.resolve();
        return readBinding(bindingPath, String(applicationId));
      } catch {
        return null;
      }
    },
    async bindApplication(
      applicationId: UuidV7,
      fingerprint: string,
    ): Promise<GateBinding> {
      try {
        await Promise.resolve();
        const existing = readBinding(bindingPath, String(applicationId));
        if (existing !== null) return existing;
        const written = writeBinding(
          bindingPath,
          String(applicationId),
          fingerprint,
        );
        if (written !== null) return written;
        return { applicationId, fingerprint };
      } catch {
        return { applicationId, fingerprint };
      }
    },
    async recordBindingRefusal(
      input: GateBindingRefusal,
    ): Promise<GateBindingRefusal> {
      try {
        await Promise.resolve();
        const record: GateBindingRefusal = { ...input };
        try {
          const file = readBindingFile(bindingPath);
          const next: StoredBindingFile = {
            bindings: { ...file.bindings },
            refusals: [...file.refusals, record],
          };
          writeBindingFile(bindingPath, next);
        } catch {
          // Best-effort persist: the refusal is still returned.
        }
        return record;
      } catch {
        return { ...input };
      }
    },
  };
}
