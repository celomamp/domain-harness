/**
 * The Guidance tools contract (Story 4.4): the versioned tool descriptors the
 * service's MCP adapter registers — exactly the four granular tools — and the
 * typed result every tool call answers with (FR-11, UX-DR30).
 *
 * Tool names, descriptions and the request schema are versioned here: a
 * change to any of them is a contract change with a semver bump. The
 * descriptions are product copy reviewed as such (UX-DR30) — each states the
 * decision the tool serves and the input it takes.
 *
 * The deterministic matching rule (serving is defined once, in the service's
 * serving unit; this comment is the contract's rule text):
 *   - The asked `subject` competes casefold — trimmed, Unicode NFC,
 *     lowercased — against the WINNING Effective Standard set's slot names
 *     (one casefolded winner per slot, in `resolveEffectiveSet`'s
 *     deterministic order: Module kind, slot kind, normalised slot name,
 *     then Standard id).
 *   - `code_stack_rule`: any code-stack category; the match is the casefold
 *     equality of the subject against the entry's slot name.
 *   - `design_token`: token entries; casefold equality of the subject
 *     against the token name.
 *   - `design_import`: import entries; casefold equality of the subject
 *     against the module specifier.
 *   - `design_component`: first the casefold equality of the subject against
 *     the component name; otherwise the casefolded subject occurs INSIDE a
 *     component's casefolded `usageRule` (containment — a usage situation
 *     naming no component can still hit the component that governs it).
 *   - The first match in the deterministic order wins; no match is a `miss`.
 * A `hit`'s content is one deterministic text rendering of the winning
 * Standard's live entry, ending with `Correction: <instruction>` when the
 * entry carries a Correction instruction.
 */
import { isRecord } from "./guards.ts";
import type { GuidanceUnboundReason } from "./guidance-identity.ts";

/** The exact tool names; the list order is the registration and tools/list order. */
export const GUIDANCE_TOOL_NAMES = ["code_stack_rule", "design_component", "design_token", "design_import"] as const;

/** One Granular Guidance tool's name. */
export type GuidanceToolName = (typeof GUIDANCE_TOOL_NAMES)[number];

/** The asked `subject` is one required string of 1 to this many characters. */
export const GUIDANCE_TOOL_SUBJECT_MAX = 1000;

/** The versioned JSON schema of one tool call: exactly `{ subject }`. */
export interface GuidanceToolInputSchema {
  readonly type: "object";
  readonly properties: {
    readonly subject: {
      readonly type: "string";
      readonly minLength: 1;
      readonly maxLength: typeof GUIDANCE_TOOL_SUBJECT_MAX;
      readonly description: string;
    };
  };
  readonly required: readonly ["subject"];
  readonly additionalProperties: false;
}

/** One versioned tool descriptor: name, product-copy description, input schema. */
export interface GuidanceToolDescriptor {
  readonly name: GuidanceToolName;
  readonly description: string;
  readonly inputSchema: GuidanceToolInputSchema;
}

/** The descriptor shared by all four tools: one required `subject` string. */
function subjectSchema(description: string): GuidanceToolInputSchema {
  return {
    type: "object",
    properties: {
      subject: { type: "string", minLength: 1, maxLength: GUIDANCE_TOOL_SUBJECT_MAX, description },
    },
    required: ["subject"],
    additionalProperties: false,
  };
}

/** The four versioned tool descriptors, in registration order. */
export const GUIDANCE_TOOLS: readonly GuidanceToolDescriptor[] = [
  {
    name: "code_stack_rule",
    description:
      "Returns the Company's code-stack decision for the given language, framework or library name — what is approved, required or prohibited there (and its Correction instruction), so you can check before you adopt it. " +
      "Input: the language, framework or library name as one string.",
    inputSchema: subjectSchema("The language, framework or library name to ask the rule for."),
  },
  {
    name: "design_component",
    description:
      "Returns the Company's design-system decision about one component — its usage rule and tokens — before you use or build it. " +
      "Input: a component name, or a description of the usage situation you are about to place a component in, as one string.",
    inputSchema: subjectSchema("The component name, or the usage situation you are about to use a component in."),
  },
  {
    name: "design_token",
    description:
      "Returns the Company's design-token decision: whether the given token is required or prohibited for the styling you are about to write. " +
      "Input: the token name as one string.",
    inputSchema: subjectSchema("The design token name to ask the rule for."),
  },
  {
    name: "design_import",
    description:
      "Returns the Company's import decision for the given module specifier: whether importing it is required or prohibited. " +
      "Input: the module specifier as one string.",
    inputSchema: subjectSchema("The module specifier to ask the import rule for."),
  },
];

/** True when `value` is exactly one of {@link GUIDANCE_TOOL_NAMES}. Never throws. */
export function isGuidanceToolName(value: unknown): value is GuidanceToolName {
  return typeof value === "string" && (GUIDANCE_TOOL_NAMES as readonly string[]).includes(value);
}

/** Why a tool call answered `unbound`: the identity reasons plus the serving-only reasons. */
export type GuidanceToolUnboundReason =
  | GuidanceUnboundReason
  /** The presented fingerprint disagrees with the Application's binding (the refusal's fixed sentence). */
  | "refused"
  /** The bundle payload was invalid, or the Effective Standard set could not be resolved. */
  | "set_unreadable";

const UNBOUND_TOOL_REASONS: readonly GuidanceToolUnboundReason[] = [
  "commit_first",
  "missing_identification_file",
  "unknown_application",
  "unavailable",
  "refused",
  "set_unreadable",
];

/** A tool call that hit a live Standard of the Effective Standard set. */
export interface GuidanceToolHit {
  readonly kind: "hit";
  readonly tool: GuidanceToolName;
  /** The subject exactly as the caller asked it. */
  readonly subject: string;
  readonly standardId: string;
  /** The winning Standard's live version. */
  readonly version: number;
  /** The deterministic text rendering of the live entry (ends with the Correction instruction when present). */
  readonly content: string;
  /** The hash of the bundle the answer was resolved against. */
  readonly bundleHash: string;
  /** True when the pinned bundle is past its bound and not frozen; the content then says `bundle stale`. */
  readonly stale: boolean;
}

/** A tool call whose subject matched nothing in the winning set. */
export interface GuidanceToolMiss {
  readonly kind: "miss";
  readonly tool: GuidanceToolName;
  /** The subject exactly as the caller asked it. */
  readonly subject: string;
  /** One fixed sentence including the asked subject verbatim. */
  readonly sentence: string;
  /** The hash of the bundle the answer was resolved against. */
  readonly bundleHash: string;
  /** True when the pinned bundle is past its bound and not frozen. */
  readonly stale: boolean;
}

/** A tool call the caller was not bound to answer: reason + fixed sentence only. */
export interface GuidanceToolUnbound {
  readonly kind: "unbound";
  readonly reason: GuidanceToolUnboundReason;
  /** The fixed sentence a host prints verbatim. */
  readonly sentence: string;
}

/** One Guidance tool outcome: exactly one of `hit`, `miss` or `unbound`. Never a thrown error. */
export type GuidanceToolResult = GuidanceToolHit | GuidanceToolMiss | GuidanceToolUnbound;

/**
 * The asked `subject` is one required string of 1 to {@link
 * GUIDANCE_TOOL_SUBJECT_MAX} characters counted as Unicode code points —
 * the same bound JSON Schema's `minLength`/`maxLength` count, and the same
 * rule the serving adapter enforces at the protocol layer. A valid subject
 * is not trimmed or otherwise normalized here: a whitespace-only subject is
 * still a string the unit answers `miss` for.
 */
export function isGuidanceToolSubject(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Code-point count in the house form (modules.ts): Array.from iterates
  // code points, the count JSON Schema's maxLength uses.
  const codePoints = Array.from(value).length;
  return codePoints >= 1 && codePoints <= GUIDANCE_TOOL_SUBJECT_MAX;
}

/** The bundle hash a `hit` or `miss` quotes: 64 lowercase hex characters. */
function isBundleHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * True when `value` is a {@link GuidanceToolResult}: exactly one of `hit`,
 * `miss` or `unbound` with the fields each variant carries. Never throws.
 */
export function isGuidanceToolResult(value: unknown): value is GuidanceToolResult {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "hit":
      return (
        isGuidanceToolName(value["tool"]) &&
        isGuidanceToolSubject(value["subject"]) &&
        typeof value["standardId"] === "string" &&
        isNonEmpty(value["standardId"]) &&
        typeof value["version"] === "number" &&
        Number.isInteger(value["version"]) &&
        value["version"] >= 1 &&
        typeof value["content"] === "string" &&
        isNonEmpty(value["content"]) &&
        isBundleHash(value["bundleHash"]) &&
        typeof value["stale"] === "boolean"
      );
    case "miss":
      return (
        isGuidanceToolName(value["tool"]) &&
        isGuidanceToolSubject(value["subject"]) &&
        isNonEmpty(value["sentence"]) &&
        isBundleHash(value["bundleHash"]) &&
        typeof value["stale"] === "boolean"
      );
    case "unbound":
      return (
        typeof value["reason"] === "string" &&
        (UNBOUND_TOOL_REASONS as readonly string[]).includes(value["reason"]) &&
        isNonEmpty(value["sentence"])
      );
    default:
      return false;
  }
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
