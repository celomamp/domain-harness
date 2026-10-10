import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Pure resolver core: no I/O, no clock reads, no network. */
export const packageName = "@domain-harness/core";

/** Errors from this unit use the shared envelope; nothing is implemented yet. */
export type CoreError = ErrorEnvelope;
