import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Record-to-Compilation projection and durable queue (Company side). */
export const packageName = "@domain-harness/collector";

/** Errors from this unit use the shared envelope; nothing is implemented yet. */
export type CollectorError = ErrorEnvelope;
