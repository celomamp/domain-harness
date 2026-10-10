import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Company Standards service: Guidance MCP, CI Gate runner, Read API, bundle puller. */
export const packageName = "@domain-harness/service";

/** Errors from this unit use the shared envelope; nothing is implemented yet. */
export type ServiceError = ErrorEnvelope;
