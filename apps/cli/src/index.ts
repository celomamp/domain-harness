import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Offline CLI Gate (Community). */
export const packageName = "@domain-harness/cli";

/** Errors from this unit use the shared envelope; nothing is implemented yet. */
export type CliError = ErrorEnvelope;
