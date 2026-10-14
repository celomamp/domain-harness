/** Workspace name of this unit. The stdio MCP bridge run inside a Builder's repository. */
export const packageName = "@domain-harness/mcp-bridge";

export { computeBridgeFingerprint, readIdentificationFile } from "./identity.ts";
export type { CallIdentity, ParsedIdentification } from "./identity.ts";

export { BridgeConfigError, endpointUrlFromArgv } from "./configuration.ts";

export { runBridge } from "./bridge.ts";
