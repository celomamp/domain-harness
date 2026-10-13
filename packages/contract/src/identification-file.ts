/**
 * The Project identification file contract (Story 3.2): the one small file at
 * a repository's root that lets Guidance, the Gate and Collectors find an
 * Application the same way.
 *
 * The file is versioned by semver. A reader of major 1 parses any minor or
 * patch of major 1 (a minor may add keys, which are ignored) and reports any
 * other major as unreadable. The parser never fills a default: it answers
 * parsed, missing or unreadable. Pure: no I/O, no dependency.
 */
import type { ErrorEnvelope } from "./errors.ts";
import { isRecord } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import { APPLICATION_API_PATHS } from "./applications.ts";

/** The file's name: a hidden dotfile at the repository root. */
export const IDENTIFICATION_FILE_NAME = ".domain-harness.json";

/** The version this contract writes. */
export const IDENTIFICATION_FILE_VERSION = "1.0.0";

/** The only major version this contract reads. */
export const IDENTIFICATION_FILE_MAJOR = 1;

/** The file is not valid JSON, not an object, or a field is wrong (subject: `file` or the field name). */
export const IDENTIFICATION_FILE_UNREADABLE = "identification_file_unreadable";

/** The Application id is malformed, unknown or another tenant's (404, subject `applicationId`). */
export const APPLICATION_NOT_FOUND = "application_not_found";

/** The parsed content of a Project identification file. */
export interface IdentificationFile {
  /** Semver `MAJOR.MINOR.PATCH`; the major is {@link IDENTIFICATION_FILE_MAJOR}. */
  readonly version: string;
  /** The registry-minted Application id: the key consumers resolve by. */
  readonly applicationId: UuidV7;
  /**
   * Advisory only. Consumers resolve the Project from the bundle by
   * Application id; a mismatch with this value is reported, never used.
   */
  readonly projectId: UuidV7;
}

/** The answer of {@link parseIdentificationFile}. Never a default. */
export type IdentificationFileResult =
  | { readonly kind: "parsed"; readonly file: IdentificationFile }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly error: ErrorEnvelope };

/**
 * The only serializer of the file. Keys in a fixed order (`version`,
 * `applicationId`, `projectId`), two-space indent and a trailing newline, so
 * equal inputs give byte-identical output.
 */
export function formatIdentificationFile(applicationId: UuidV7, projectId: UuidV7): string {
  return `${JSON.stringify({ version: IDENTIFICATION_FILE_VERSION, applicationId, projectId }, null, 2)}\n`;
}

// MAJOR.MINOR.PATCH: non-negative integers without leading zeros; no pre-release or build suffix.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function unreadable(subject: string, message: string): IdentificationFileResult {
  return { kind: "unreadable", error: { code: IDENTIFICATION_FILE_UNREADABLE, message, subject } };
}

/**
 * Parse the content of a Project identification file; `null` means there is
 * no file. Never throws and never fills a default. First failure wins: no
 * file → `missing`; not JSON or not an object (subject `file`); `version` not
 * `MAJOR.MINOR.PATCH` or of another major (subject `version`);
 * `applicationId`, then `projectId`, not a UUIDv7 (subject: that field).
 * Messages carry field names and versions only, never the file's content.
 * Unknown extra keys are ignored.
 */
export function parseIdentificationFile(content: string | null): IdentificationFileResult {
  if (content === null) return { kind: "missing" };
  let value: unknown;
  try {
    // Some editors save a leading UTF-8 byte order mark; strip exactly one.
    value = JSON.parse(content.startsWith("\uFEFF") ? content.slice(1) : content) as unknown;
  } catch {
    return unreadable("file", `${IDENTIFICATION_FILE_NAME} is not valid JSON`);
  }
  if (!isRecord(value)) return unreadable("file", `${IDENTIFICATION_FILE_NAME} must hold a JSON object`);

  const version = value["version"];
  const major = typeof version === "string" ? SEMVER.exec(version)?.[1] : undefined;
  if (typeof version !== "string" || major === undefined) {
    return unreadable("version", "version must be a semver string MAJOR.MINOR.PATCH");
  }
  if (major !== String(IDENTIFICATION_FILE_MAJOR)) {
    return unreadable(
      "version",
      `major version ${major} is not supported; this reader supports major version ${String(IDENTIFICATION_FILE_MAJOR)}`,
    );
  }

  const applicationId = value["applicationId"];
  if (!isUuidV7(applicationId)) return unreadable("applicationId", "applicationId must be a lowercase UUIDv7");
  const projectId = value["projectId"];
  if (!isUuidV7(projectId)) return unreadable("projectId", "projectId must be a lowercase UUIDv7");

  return { kind: "parsed", file: { version, applicationId, projectId } };
}

/** Response of `GET /v1/applications/{id}/identification-file`. */
export interface IdentificationFileRendering {
  /** Always {@link IDENTIFICATION_FILE_NAME}. */
  readonly fileName: string;
  /** The file's exact bytes, as {@link formatIdentificationFile} writes them. */
  readonly content: string;
}

/** True when `value` is an {@link IdentificationFileRendering} named {@link IDENTIFICATION_FILE_NAME}. Never throws. */
export function isIdentificationFileRendering(value: unknown): value is IdentificationFileRendering {
  return isRecord(value) && value["fileName"] === IDENTIFICATION_FILE_NAME && typeof value["content"] === "string";
}

/**
 * `GET`: 200 {@link IdentificationFileRendering} (every role); 404
 * {@link APPLICATION_NOT_FOUND} for a malformed, unknown or other tenant's id.
 */
export function applicationIdentificationFilePath(applicationId: string): string {
  return `${APPLICATION_API_PATHS.applications}/${encodeURIComponent(applicationId)}/identification-file`;
}
