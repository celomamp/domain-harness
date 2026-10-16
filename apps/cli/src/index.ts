import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Offline CLI Gate (Community). */
export const packageName = "@domain-harness/cli";

/** Errors from this unit use the shared envelope. */
export type CliError = ErrorEnvelope;

export * from "./trust-keys.ts";
export * from "./bundle-state.ts";
export * from "./bundle-file.ts";
export * from "./gate-snapshot.ts";
export * from "./binding-file.ts";
export * from "./gate.ts";
export * from "./version.ts";
export { defaultStatePath, formatSuccessLine, isCliEntryPoint, parseVerifyArgs, run, runCli } from "./cli.ts";
export type { CliDispatchResult, CliRunResult, VerifyCommandOptions } from "./cli.ts";
