import { APPLICATION_DESCRIPTION_MAX } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";

/** A validated `POST /v1/applications` body: the description trimmed; whether the Project exists is checked later. */
export interface ApplicationCreateBody {
  readonly description: string;
  readonly projectId: string;
}

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was created`, subject });

/** Characters as PostgreSQL char_length counts them (code points). */
const length = (text: string): number => Array.from(text).length;

const ALLOWED = ["description", "projectId"] as const;

/**
 * Validate `{ description, projectId }` (exactly these keys), in this order:
 * the body is an object (subject `body`) with no other key (subject: that
 * key); the description is a string, 1 to 500 characters once trimmed
 * (subject `description`); the Project id is a non-empty string (subject
 * `projectId`; whether it names a Project of the tenant is checked later).
 */
export function validateApplicationBody(body: unknown): ApplicationCreateBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", `the body must be an object with ${ALLOWED.join(", ")}`);
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => !(ALLOWED as readonly string[]).includes(key));
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const raw = fields["description"];
  const description = typeof raw === "string" ? raw.trim() : "";
  if (description === "" || length(description) > APPLICATION_DESCRIPTION_MAX) {
    throw invalid("description", `description must be 1 to ${String(APPLICATION_DESCRIPTION_MAX)} characters once trimmed`);
  }
  const projectId = fields["projectId"];
  if (typeof projectId !== "string" || projectId === "") throw invalid("projectId", "choose a Project for the Application");
  return { description, projectId };
}
