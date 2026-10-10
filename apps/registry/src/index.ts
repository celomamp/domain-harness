import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Vendor registry: authoring, bundle builder and signer, Boilerplate. */
export const packageName = "@domain-harness/registry";

/** Errors from this unit use the shared envelope; nothing is implemented yet. */
export type RegistryError = ErrorEnvelope;
