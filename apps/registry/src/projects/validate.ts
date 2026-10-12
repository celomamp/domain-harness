import { isUuidV7, LEVEL_NAME_MAX, PROJECT_NAME_MAX } from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";

/** A validated `POST /v1/projects` body: the name trimmed, the level name exactly as typed. */
export interface ProjectCreateBody {
  readonly name: string;
  readonly levelName: string;
  readonly parentId: UuidV7;
}

/** A validated `POST /v1/projects/{id}/parent` body. */
export interface ProjectParentBody {
  readonly parentId: UuidV7;
}

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was changed`, subject });

/** Characters as PostgreSQL char_length counts them (code points). */
const length = (text: string): number => Array.from(text).length;

/** `body` as a record with only `allowed` keys; otherwise `invalid_input` naming `body` or the first extra key. */
function record(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", `the body must be an object with ${allowed.join(", ")}`);
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  return fields;
}

function parentId(fields: Record<string, unknown>): UuidV7 {
  const value = fields["parentId"];
  if (!isUuidV7(value)) throw invalid("parentId", "parentId must be the id of a Project of this Company");
  return value;
}

/**
 * Validate `{ name, levelName, parentId }` (exactly these keys), in that
 * order: the name is trimmed and 1 to 200 characters; the level name is kept
 * exactly as typed, 1 to 200 characters with at least one non-whitespace
 * character; the parent id is a canonical UUIDv7 (whether it exists is
 * checked later). Throws `invalid_input` whose subject names the field or the
 * extra key.
 */
export function validateCreateBody(body: unknown): ProjectCreateBody {
  const fields = record(body, ["name", "levelName", "parentId"]);
  const rawName = fields["name"];
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name === "" || length(name) > PROJECT_NAME_MAX) {
    throw invalid("name", `name must be 1 to ${String(PROJECT_NAME_MAX)} characters once trimmed`);
  }
  const levelName = fields["levelName"];
  if (typeof levelName !== "string" || levelName.trim() === "" || length(levelName) > LEVEL_NAME_MAX) {
    throw invalid(
      "levelName",
      `levelName must be 1 to ${String(LEVEL_NAME_MAX)} characters with at least one that is not whitespace`,
    );
  }
  return { name, levelName, parentId: parentId(fields) };
}

/** Validate `{ parentId }` (exactly this key). Throws `invalid_input` naming `parentId` or the extra key. */
export function validateParentBody(body: unknown): ProjectParentBody {
  return { parentId: parentId(record(body, ["parentId"])) };
}
