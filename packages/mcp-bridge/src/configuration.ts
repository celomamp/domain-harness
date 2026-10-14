/**
 * Bridge configuration (Story 4.3): the one start-up input — the Guidance
 * endpoint URL, argv's second element — validated before anything listens:
 * a missing or invalid URL throws one {@link BridgeConfigError} that the
 * entry prints once to stderr before exiting 1.
 */
import type { ErrorEnvelope } from "@domain-harness/contract";

/** One bridge start-up failure: printed once to stderr, then exit 1. */
export class BridgeConfigError extends Error implements ErrorEnvelope {
  readonly code: string;
  readonly subject: string;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = "BridgeConfigError";
    this.code = envelope.code;
    this.subject = envelope.subject;
  }
}

/**
 * Validate the bridge's one configuration: the endpoint URL is argv's second
 * element and must be an http or https URL. Throws exactly one
 * {@link BridgeConfigError} otherwise.
 */
export function endpointUrlFromArgv(argv: readonly string[]): URL {
  const raw = argv[2];
  if (raw === undefined || raw.trim() === "") {
    throw new BridgeConfigError({
      code: "missing_configuration",
      message: "the Guidance endpoint URL is required: mcp-bridge <endpoint URL>",
      subject: "endpoint",
    });
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BridgeConfigError({
      code: "invalid_configuration",
      message: "the Guidance endpoint URL must be a URL",
      subject: "endpoint",
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BridgeConfigError({
      code: "invalid_configuration",
      message: "the Guidance endpoint URL must be an http or https URL",
      subject: "endpoint",
    });
  }
  return url;
}
