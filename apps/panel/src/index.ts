import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Vendor management panel. */
export const packageName = "@domain-harness/panel";

/** Errors from this unit use the shared envelope; nothing is implemented yet. */
export type PanelError = ErrorEnvelope;
