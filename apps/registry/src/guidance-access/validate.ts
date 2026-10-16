import {
  GRANTABLE_ROLES,
  GUIDANCE_RETENTION_DAYS_MAX,
  GUIDANCE_RETENTION_DAYS_MIN,
  isRetentionDays,
} from "@domain-harness/contract";
import type { GrantableRole } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was changed`, subject });

/** A validated `POST /v1/guidance-access` body: the grant per grantable role plus the retention days. */
export interface GuidanceAccessBody {
  readonly grants: Record<GrantableRole, boolean>;
  readonly retentionDays: number;
}

/**
 * Validate `{ grants, retentionDays }` (exactly these keys): `grants` carries
 * exactly the grantable-role names mapping to booleans and `retentionDays` is
 * an integer of 1..3650 days. Throws `invalid_input` naming `body`, the extra
 * key, `grants`, the role name or `retentionDays`.
 */
export function validateGuidanceAccessBody(body: unknown): GuidanceAccessBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with grants, retentionDays");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== "grants" && key !== "retentionDays");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const grants = fields["grants"];
  if (typeof grants !== "object" || grants === null || Array.isArray(grants)) {
    throw invalid("grants", "grants must map each grantable role to true or false");
  }
  const entries = grants as Record<string, unknown>;
  const names = new Set(Object.keys(entries));
  for (const role of GRANTABLE_ROLES) {
    if (!names.has(role)) throw invalid("grants", `grants must map each grantable role to true or false`);
    if (typeof entries[role] !== "boolean") throw invalid(role, `${role} must be true or false`);
  }
  for (const name of names) {
    if (!(GRANTABLE_ROLES as readonly string[]).includes(name)) throw invalid(name, "the body has an unsupported role");
  }
  const retentionDays = fields["retentionDays"];
  if (!isRetentionDays(retentionDays)) {
    throw invalid(
      "retentionDays",
      `retentionDays must be an integer of ${String(GUIDANCE_RETENTION_DAYS_MIN)} to ${String(GUIDANCE_RETENTION_DAYS_MAX)} days`,
    );
  }
  return {
    grants: {
      "Standard owner": entries["Standard owner"] === true,
      Builder: entries["Builder"] === true,
    },
    retentionDays,
  };
}
