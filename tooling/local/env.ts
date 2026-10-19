/**
 * Pure helpers behind `pnpm local:*` (tooling/local/*.sh). Everything here is
 * synchronous and offline: no Docker, no network, no database. The shell
 * wrappers own the side effects; this module owns the fail-closed decisions
 * so vitest can pin them (see the I/O matrix in
 * `_bmad-output/implementation-artifacts/spec-local-env-stabilization.md`).
 */

/** The two database suites' opt-in URLs (house rule: skip unless set). */
export const TEST_URL_VARS = ["REGISTRY_TEST_DATABASE_URL", "SERVICE_TEST_DATABASE_URL"] as const;

/** Placeholder values that must never start a daemon (compose `:?` guards). */
export const SERVICE_PLACEHOLDERS = [
  "replace-with-your-tenant-service-credential",
  "replace-with-your-json-trust-set",
] as const;

/** True when the `CI` fail-closed rule applies (matches every db suite). */
export function isCi(env: Readonly<Record<string, string | undefined>>): boolean {
  const ci = env["CI"];
  return ci !== undefined && ci !== "" && ci !== "false";
}

/** Test-URL variables that are unset or blank. */
export function missingTestUrls(env: Readonly<Record<string, string | undefined>>): string[] {
  return TEST_URL_VARS.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === "";
  });
}

/**
 * Plain `pnpm test` with no DB URLs: pass with printed skip reasons, unless
 * `CI` is set, when the run fails as today. `run` means the DB suites
 * execute (URLs are present); it does not run anything itself.
 */
export function plainTestOutcome(env: Readonly<Record<string, string | undefined>>): { run: "skip" | "fail" | "run" } {
  if (missingTestUrls(env).length === 0) return { run: "run" };
  return isCi(env) ? { run: "fail" } : { run: "skip" };
}

/** One sentence naming Docker when the daemon is unreachable. */
export function dockerDownMessage(command: string): string {
  return `${command}: Docker is not running; start Docker Desktop (or dockerd) and retry.`;
}

/**
 * Exactly one of SMTP or the file outbox must be set, otherwise the registry
 * refuses before listen. Returns the one-sentence refusal, or null when the
 * choice is valid. Blank counts as unset.
 */
export function mailChoiceError(env: Readonly<Record<string, string | undefined>>): string | null {
  const smtp = env["REGISTRY_SMTP_URL"];
  const outbox = env["REGISTRY_MAIL_OUTBOX_DIR"];
  const hasSmtp = smtp !== undefined && smtp.trim() !== "";
  const hasOutbox = outbox !== undefined && outbox.trim() !== "";
  if (hasSmtp === hasOutbox) {
    return "set exactly one of REGISTRY_SMTP_URL (with REGISTRY_MAIL_FROM) or REGISTRY_MAIL_OUTBOX_DIR.";
  }
  return null;
}

/**
 * The Company service never starts on placeholder credentials or trust keys.
 * Returns the one-sentence refusal naming the variable, or null when both
 * are provided (emptiness is the daemon's own missing_configuration).
 */
export function serviceCredentialRefusal(env: Readonly<Record<string, string | undefined>>): string | null {
  const credential = env["SERVICE_TENANT_CREDENTIAL"];
  if (credential !== undefined && SERVICE_PLACEHOLDERS.includes(credential.trim() as (typeof SERVICE_PLACEHOLDERS)[number])) {
    return "set SERVICE_TENANT_CREDENTIAL from the registry's provision output (see README); placeholders never start the service.";
  }
  const trustKeys = env["SERVICE_BUNDLE_TRUST_KEYS"];
  if (trustKeys !== undefined && SERVICE_PLACEHOLDERS.includes(trustKeys.trim() as (typeof SERVICE_PLACEHOLDERS)[number])) {
    return "set SERVICE_BUNDLE_TRUST_KEYS to the registry's Ed25519 public keys (see README); placeholders never start the service.";
  }
  return null;
}
