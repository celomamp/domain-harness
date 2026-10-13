import { GUIDANCE_ENDPOINT_URL_MAX } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was changed`, subject });

const URL_RULE = `url must be an https URL of 1 to ${String(GUIDANCE_ENDPOINT_URL_MAX)} characters with no whitespace, user name, password or fragment`;

/**
 * Validate `{ url }` (exactly this key) and return the trimmed URL. The URL
 * is 1 to {@link GUIDANCE_ENDPOINT_URL_MAX} characters after trimming, parses
 * with `new URL`, uses `https:`, and carries no whitespace, no user name, no password and no
 * fragment. Throws `invalid_input` naming `body`, the extra key or `url`.
 */
export function validateGuidanceEndpointBody(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with url");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== "url");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const raw = fields["url"];
  if (typeof raw !== "string") throw invalid("url", URL_RULE);
  const url = raw.trim();
  if (url === "" || url.length > GUIDANCE_ENDPOINT_URL_MAX || /\s/.test(url)) throw invalid("url", URL_RULE);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid("url", URL_RULE);
  }
  // `hash` is "" for both no fragment and a bare "#", so look at the text too.
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    url.includes("#")
  ) {
    throw invalid("url", URL_RULE);
  }
  return url;
}
