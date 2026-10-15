/**
 * The Guidance event contract (Story 4.5): the versioned shape of one
 * recorded Guidance tool outcome in the Company store. Every bound tool call
 * (`hit`/`miss`) appends one row service-side; a `miss` row IS the gap (one
 * table, miss projection — no second write).
 *
 * A `GuidanceEvent` carries exactly `id`, `applicationId`, `sequence`
 * (per-Application, store-assigned), `tool`, `subject` (as asked), `outcome`
 * (`hit` with `standardId` + `version`, or `miss`), `agentTool`
 * (`BoilerplateTarget` or `null`), `bundleHash`, and `createdAt` (UTC
 * ISO-8601). The field rules mirror Story 4.4's (`guidance-tools.ts`):
 * subject 1..1000 code points, 64-hex `bundleHash`, non-empty `standardId`,
 * integer `version` >= 1.
 *
 * `GUIDANCE_EVENT_RETENTION_DAYS` is the default lifetime (90 days);
 * scheduled enforcement is Story 6.7 — `created_at` is this story's only hook.
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import { isBoilerplateTarget } from "./boilerplate.ts";
import type { BoilerplateTarget } from "./boilerplate.ts";
import { isGuidanceToolName, isGuidanceToolSubject } from "./guidance-tools.ts";
import type { GuidanceToolName } from "./guidance-tools.ts";

/** The default lifetime of a Guidance event row, in days (enforcement is 6.7). */
export const GUIDANCE_EVENT_RETENTION_DAYS = 90;

/** The outcome a recorded event carries: a hit names its Standard, a miss names nothing more. */
export type GuidanceEventOutcome =
  | { readonly kind: "hit"; readonly standardId: string; readonly version: number }
  | { readonly kind: "miss" };

/** One recorded Guidance tool outcome, as the Company store holds it. */
export interface GuidanceEvent {
  readonly id: UuidV7;
  readonly applicationId: UuidV7;
  /** The per-Application sequence, assigned by the record store (max + 1). */
  readonly sequence: number;
  readonly tool: GuidanceToolName;
  /** The subject exactly as the caller asked it (never raw prompt text). */
  readonly subject: string;
  readonly outcome: GuidanceEventOutcome;
  /** The agent tool known to the PINNED bundle's application entry, or `null` when it predates the generation. */
  readonly agentTool: BoilerplateTarget | null;
  /** The hash of the bundle the answer was resolved against. */
  readonly bundleHash: string;
  /** UTC ISO-8601 of the recording. */
  readonly createdAt: string;
}

const GUIDANCE_EVENT_KEYS = new Set([
  "id",
  "applicationId",
  "sequence",
  "tool",
  "subject",
  "outcome",
  "agentTool",
  "bundleHash",
  "createdAt",
]);

function isBundleHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isGuidanceEventOutcome(value: unknown): value is GuidanceEventOutcome {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "hit":
      return (
        isNonEmpty(value["standardId"]) &&
        typeof value["version"] === "number" &&
        Number.isInteger(value["version"]) &&
        value["version"] >= 1 &&
        Object.keys(value).length === 3
      );
    case "miss":
      return Object.keys(value).length === 1;
    default:
      return false;
  }
}

/**
 * True when `value` is a {@link GuidanceEvent}: exactly the versioned keys
 * with the 4.4 field rules. Never throws.
 */
export function isGuidanceEvent(value: unknown): value is GuidanceEvent {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!GUIDANCE_EVENT_KEYS.has(key)) return false;
  }
  const sequence = value["sequence"];
  const agentTool = value["agentTool"];
  return (
    isUuidV7(value["id"]) &&
    isUuidV7(value["applicationId"]) &&
    typeof sequence === "number" &&
    Number.isInteger(sequence) &&
    sequence >= 1 &&
    isGuidanceToolName(value["tool"]) &&
    isGuidanceToolSubject(value["subject"]) &&
    isGuidanceEventOutcome(value["outcome"]) &&
    (agentTool === null || isBoilerplateTarget(agentTool)) &&
    isBundleHash(value["bundleHash"]) &&
    isUtcIso(value["createdAt"])
  );
}
