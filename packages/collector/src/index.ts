import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Record-to-Compilation projection and durable queue (Company side). */
export const packageName = "@domain-harness/collector";

/** Errors from this unit use the shared envelope. */
export type CollectorError = ErrorEnvelope;

export { encodeUuidV7, mintUuidV7 } from "./ids.ts";
export {
  hashGuidanceSubject,
  projectBindingRefusalCompilation,
  projectBundleStatusCompilation,
  projectCollectorHealthCompilation,
  projectDeviationCompilation,
  projectGateRunCompilation,
  projectGuidanceCompilation,
  projectGuidanceSubject,
} from "./project.ts";
export type {
  BindingRefusalInput,
  BundleStatusInput,
  CollectorHealthInput,
  GateRunRecordInput,
  GateRunProjectionContext,
  GuidanceProjectionContext,
  RecordProjectionContext,
} from "./project.ts";
export { DROP_REASONS, DropLedger, validateForSend } from "./validate.ts";
export type { DropReason, ValidateForSendResult } from "./validate.ts";
export { PUSH_TIMEOUT_MS, pushCompilation } from "./push.ts";
export type { PushCompilationInput, PushResult } from "./push.ts";
