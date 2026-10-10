import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Deterministic revision-fact extraction from file contents the adapter supplies. */
export const packageName = "@domain-harness/extractor";

/** Errors from this unit use the shared envelope; nothing is implemented yet. */
export type ExtractorError = ErrorEnvelope;
