import {
  CODE_STACK_CATEGORIES,
  CODE_STACK_ENTRY_FIELDS,
  CODE_STACK_STATUSES,
  CORRECTION_INSTRUCTION_MAX,
  isCodeStackCategory,
  isCodeStackStatus,
  STANDARD_NAME_MAX,
  VERSION_CONSTRAINT_MAX,
} from "@domain-harness/contract";
import type { CodeStackEntry } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was published`, subject });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Characters as PostgreSQL char_length counts them (code points). */
const length = (text: string): number => Array.from(text).length;

/** Optional text: missing, `null` or blank → `null`; otherwise trimmed and at most `max` characters. */
function optionalText(entry: Record<string, unknown>, field: string, max: number): string | null {
  const value = entry[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalid(field, `${field} must be text or null`);
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (length(trimmed) > max) throw invalid(field, `${field} must be at most ${String(max)} characters once trimmed`);
  return trimmed;
}

/**
 * Validate and normalise a code-stack entry: fields are checked in form order
 * (category, name, versionConstraint, status, correctionInstruction) after any
 * unknown key. Throws `invalid_input` whose subject names the field.
 */
export function validateCodeStackEntry(entry: unknown): CodeStackEntry {
  if (!isRecord(entry)) throw invalid("entry", "entry must be an object");
  const extra = Object.keys(entry).find((key) => !(CODE_STACK_ENTRY_FIELDS as readonly string[]).includes(key));
  if (extra !== undefined) throw invalid(extra, "the entry has an unsupported field");

  const category = entry["category"];
  if (!isCodeStackCategory(category)) {
    throw invalid("category", `category must be one of ${CODE_STACK_CATEGORIES.join(", ")}`);
  }
  const rawName = entry["name"];
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name === "" || length(name) > STANDARD_NAME_MAX) {
    throw invalid("name", `name must be 1 to ${String(STANDARD_NAME_MAX)} characters once trimmed`);
  }
  const versionConstraint = optionalText(entry, "versionConstraint", VERSION_CONSTRAINT_MAX);
  const status = entry["status"];
  if (!isCodeStackStatus(status)) {
    throw invalid("status", `status must be one of ${CODE_STACK_STATUSES.join(", ")}`);
  }
  const correctionInstruction = optionalText(entry, "correctionInstruction", CORRECTION_INSTRUCTION_MAX);
  return { category, name, versionConstraint, status, correctionInstruction };
}

/**
 * The entry of a publish body, which must be exactly `{ entry }`: any other
 * key is refused with that key as the subject. Throws `invalid_input`.
 */
export function validatePublishBody(body: unknown): CodeStackEntry {
  if (!isRecord(body)) throw invalid("body", "the body must be { \"entry\": { ... } }");
  const extra = Object.keys(body).find((key) => key !== "entry");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  return validateCodeStackEntry(body["entry"]);
}
