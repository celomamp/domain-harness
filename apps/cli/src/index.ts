import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Offline CLI Gate (Community). */
export const packageName = "@domain-harness/cli";

/** Errors from this unit use the shared envelope. */
export type CliError = ErrorEnvelope;

export * from "./trust-keys.ts";
export * from "./bundle-state.ts";
export * from "./bundle-file.ts";
export { defaultStatePath, formatSuccessLine, isCliEntryPoint, parseVerifyArgs, run } from "./cli.ts";
export type { CliRunResult, VerifyCommandOptions } from "./cli.ts";
