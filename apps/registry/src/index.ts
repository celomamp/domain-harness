import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Vendor registry: authoring, bundle builder and signer, Boilerplate. */
export const packageName = "@domain-harness/registry";

/** Errors from this unit use the shared envelope. */
export type RegistryError = ErrorEnvelope;

export { EnvelopeError, isEnvelopeError } from "./errors.ts";
export { encodeUuidV7, mintUuidV7, uuidV7Timestamp } from "./ids.ts";
export { createPool, createRegistryDb } from "./db/client.ts";
export type { RegistryDb, RegistryTx } from "./db/client.ts";
export { migrate, MIGRATIONS_DIR } from "./db/migrate.ts";
export type { MigrationReport } from "./db/migrate.ts";
export { assertRuntimeRoleSafe, assertTenantId, withTenant } from "./db/tenant-scope.ts";
export { provisionCompany } from "./tenancy/provision.ts";
export type { ProvisionResult } from "./tenancy/provision.ts";
export { getRootProject, getTenant, listAccounts } from "./tenancy/queries.ts";
export type { Account, Project, Tenant } from "./tenancy/queries.ts";
export { normalizeEmail, validateProvisionInput } from "./tenancy/validate.ts";
export type { AccountRequest, ProvisionRequest, ValidationResult } from "./tenancy/validate.ts";
