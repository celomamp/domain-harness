import {
  CODE_STACK_CATEGORIES,
  CODE_STACK_ENTRY_FIELDS,
  CODE_STACK_STATUSES,
  COMPONENT_TOKENS_MAX,
  CORRECTION_INSTRUCTION_MAX,
  DESIGN_SYSTEM_ENTRY_FIELDS,
  DESIGN_SYSTEM_ENTRY_KINDS,
  DESIGN_SYSTEM_STATUSES,
  isCodeStackCategory,
  isCodeStackStatus,
  isDesignSystemEntryKind,
  isDesignSystemStatus,
  STANDARD_NAME_MAX,
  USAGE_RULE_MAX,
  VERSION_CONSTRAINT_MAX,
} from "@domain-harness/contract";
import type {
  CodeStackEntry,
  DesignSystemEntry,
  DesignSystemStatus,
  ModuleKind,
  StandardEntry,
} from "@domain-harness/contract";
import { normalizeSlotName } from "@domain-harness/core";
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

/** Required text: trimmed, 1 to `max` characters. */
function requiredText(entry: Record<string, unknown>, field: string, max: number): string {
  const value = entry[field];
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "" || length(trimmed) > max) {
    throw invalid(field, `${field} must be 1 to ${String(max)} characters once trimmed`);
  }
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
  const name = requiredText(entry, "name", STANDARD_NAME_MAX);
  const versionConstraint = optionalText(entry, "versionConstraint", VERSION_CONSTRAINT_MAX);
  const status = entry["status"];
  if (!isCodeStackStatus(status)) {
    throw invalid("status", `status must be one of ${CODE_STACK_STATUSES.join(", ")}`);
  }
  const correctionInstruction = optionalText(entry, "correctionInstruction", CORRECTION_INSTRUCTION_MAX);
  return { category, name, versionConstraint, status, correctionInstruction };
}

function designSystemStatus(entry: Record<string, unknown>): DesignSystemStatus {
  const status = entry["status"];
  if (!isDesignSystemStatus(status)) {
    throw invalid("status", `status must be one of ${DESIGN_SYSTEM_STATUSES.join(", ")}`);
  }
  return status;
}

/** A component's token names: an array of 0 to 50 texts, each 1 to 200 characters, no two equal as slot names. */
function componentTokens(entry: Record<string, unknown>): string[] {
  const value = entry["tokens"];
  if (!Array.isArray(value)) throw invalid("tokens", "tokens must be a list of token names");
  if (value.length > COMPONENT_TOKENS_MAX) {
    throw invalid("tokens", `a component depends on at most ${String(COMPONENT_TOKENS_MAX)} tokens`);
  }
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    const token = typeof item === "string" ? item.trim() : "";
    if (token === "" || length(token) > STANDARD_NAME_MAX) {
      throw invalid("tokens", `each token name must be 1 to ${String(STANDARD_NAME_MAX)} characters once trimmed`);
    }
    const key = normalizeSlotName(token);
    if (seen.has(key)) throw invalid("tokens", "a token is listed more than once");
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

/**
 * Validate and normalise a design-system entry: `kind` first (subject
 * `kind`), then any key not allowed for that kind (subject = that key), then
 * the fields in form order (subject = the field). Throws `invalid_input`.
 */
export function validateDesignSystemEntry(entry: unknown): DesignSystemEntry {
  if (!isRecord(entry)) throw invalid("entry", "entry must be an object");
  const kind = entry["kind"];
  if (!isDesignSystemEntryKind(kind)) {
    throw invalid("kind", `kind must be one of ${DESIGN_SYSTEM_ENTRY_KINDS.join(", ")}`);
  }
  const allowed = DESIGN_SYSTEM_ENTRY_FIELDS[kind] as readonly string[];
  const extra = Object.keys(entry).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw invalid(extra, `a ${kind} entry has no such field`);

  switch (kind) {
    case "component": {
      const name = requiredText(entry, "name", STANDARD_NAME_MAX);
      const usageRule = requiredText(entry, "usageRule", USAGE_RULE_MAX);
      const tokens = componentTokens(entry);
      const correctionInstruction = optionalText(entry, "correctionInstruction", CORRECTION_INSTRUCTION_MAX);
      return { kind, name, usageRule, tokens, correctionInstruction };
    }
    case "token": {
      const name = requiredText(entry, "name", STANDARD_NAME_MAX);
      return { kind, name, status: designSystemStatus(entry) };
    }
    case "import": {
      const specifier = requiredText(entry, "specifier", STANDARD_NAME_MAX);
      return { kind, specifier, status: designSystemStatus(entry) };
    }
  }
}

export interface PublishBodyOptions {
  /** True for version 1 of a new Standard: the body may carry an optional `projectId` (its Project scope). */
  readonly allowProjectId: boolean;
}

/** A validated publish body: the normalised entry and, for a new Standard, the requested Project scope. */
export interface PublishBody {
  readonly entry: StandardEntry;
  /** The requested Project scope (not yet looked up), or `undefined` for the root Project / a new version. */
  readonly projectId: string | undefined;
}

/**
 * Validate `{ entry, projectId? }` (a new Standard) or exactly `{ entry }` (a
 * new version, whose Project scope is fixed). Unknown keys are refused first,
 * then the entry for the Module's kind, then the `projectId` type.
 */
export function validatePublishBody(body: unknown, moduleKind: ModuleKind, options: PublishBodyOptions): PublishBody {
  if (!isRecord(body)) throw invalid("body", "the body must be { \"entry\": { ... } }");
  const extra = Object.keys(body).find((key) => key !== "entry" && !(options.allowProjectId && key === "projectId"));
  if (extra === "projectId") {
    throw invalid("projectId", "a Standard's Project scope is fixed when it is first published, so a new version takes no projectId");
  }
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const entry =
    moduleKind === "design-system" ? validateDesignSystemEntry(body["entry"]) : validateCodeStackEntry(body["entry"]);
  const projectId = body["projectId"];
  if (projectId !== undefined && typeof projectId !== "string") {
    throw invalid("projectId", "projectId must be a Project id string, or left out for the root Project");
  }
  return { entry, projectId };
}
