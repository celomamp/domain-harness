/**
 * The binding subset of the Gate's record store (Story 5.4): the direct
 * in-process adapter needs exactly the TOFU binding checks the service
 * runner performs — look up the Application's binding, bind on first use,
 * and record a Binding refusal — with no gate-run storage at all (run
 * recording is an adapter's own side effect and stays with each store).
 */
import type { UuidV7 } from "@domain-harness/contract";

/** An Application's repository fingerprint binding. */
export interface GateBinding {
  readonly applicationId: UuidV7;
  readonly fingerprint: string;
}

/** The record a binding refusal produces (record-keeping, not output). */
export interface GateBindingRefusal {
  readonly applicationId: UuidV7;
  readonly presentedFingerprint: string;
  readonly boundFingerprint: string;
}

/** The binding surface every Gate adapter's record store supplies. */
export interface BindingLedger {
  getBinding(applicationId: UuidV7): Promise<GateBinding | null>;
  bindApplication(applicationId: UuidV7, fingerprint: string): Promise<GateBinding>;
  recordBindingRefusal(input: GateBindingRefusal): Promise<GateBindingRefusal>;
}

/**
 * An in-memory ledger, optionally seeded with bindings: a seeded entry plays
 * the "Application already bound" state, an empty ledger plays first use.
 */
export function createInMemoryBindingLedger(seeded: readonly GateBinding[] = []): BindingLedger {
  const bindings = new Map<string, GateBinding>();
  for (const binding of seeded) bindings.set(binding.applicationId, binding);
  const refusals: GateBindingRefusal[] = [];
  return {
    async getBinding(applicationId: UuidV7): Promise<GateBinding | null> {
      await Promise.resolve();
      return bindings.get(applicationId) ?? null;
    },
    async bindApplication(applicationId: UuidV7, fingerprint: string): Promise<GateBinding> {
      await Promise.resolve();
      const existing = bindings.get(applicationId);
      if (existing !== undefined) return existing;
      const binding: GateBinding = { applicationId, fingerprint };
      bindings.set(applicationId, binding);
      return binding;
    },
    async recordBindingRefusal(input: GateBindingRefusal): Promise<GateBindingRefusal> {
      await Promise.resolve();
      const record: GateBindingRefusal = { ...input };
      refusals.push(record);
      return record;
    },
  };
}
