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
export { consumeSignInLink, createSignInService, getSession, requestSignInLinks } from "./sign-in/service.ts";
export type { SignInConfig, SignInLinkReport, SignInService } from "./sign-in/service.ts";
export { hashToken, mintToken, parseToken } from "./sign-in/tokens.ts";
export { composeSignInMessage, SIGN_IN_SUBJECT, signInLinkUrl } from "./mail/transport.ts";
export type { MailMessage, MailTransport } from "./mail/transport.ts";
export { createTransportFromEnv, MAIL_ENV } from "./mail/from-env.ts";
export { MemoryTransport } from "./mail/memory.ts";
export { OutboxTransport } from "./mail/outbox.ts";
export { SmtpTransport } from "./mail/smtp.ts";
export {
  assertBuyer,
  assignModuleOwner,
  createModule,
  createModuleService,
  listModules,
} from "./modules/service.ts";
export type { ModuleCreateInput, ModuleOwnerAssignInput, ModuleService } from "./modules/service.ts";
export {
  createStandardService,
  listStandards,
  liveStandardInfos,
  listStandardVersions,
  publishStandard,
  publishStandardVersion,
} from "./standards/service.ts";
export type { StandardService } from "./standards/service.ts";
export { validateCodeStackEntry, validatePublishBody } from "./standards/validate.ts";
export {
  assertTreeBuyer,
  changeParent,
  createProject,
  createProjectService,
  getEffectiveSet,
  getProject,
  getTree,
  resolveEffectiveStandards,
} from "./projects/service.ts";
export type { ProjectService } from "./projects/service.ts";
export { validateCreateBody, validateParentBody } from "./projects/validate.ts";
export type { ProjectCreateBody, ProjectParentBody } from "./projects/validate.ts";
export {
  createLockedRuleService,
  currentLockedIds,
  currentLockedMarks,
  setLockedRule,
  validateLockedRuleBody,
} from "./locked-rules/service.ts";
export type { LockedRuleBody, LockedRuleService } from "./locked-rules/service.ts";
export {
  createChildPermissionService,
  hasChildPermission,
  listChildPermissions,
  setChildPermission,
  validateChildPermissionBody,
} from "./child-permissions/service.ts";
export type { ChildPermissionBody, ChildPermissionService } from "./child-permissions/service.ts";
export {
  createBuildGrantService,
  hasBuildGrant,
  listBuildGrants,
  setBuildGrant,
  validateBuildGrantBody,
} from "./build-grants/service.ts";
export type { BuildGrantBody, BuildGrantService } from "./build-grants/service.ts";
export {
  createApplication,
  applicationNotFound,
  createApplicationService,
  getIdentificationFile,
  listApplications,
} from "./applications/service.ts";
export type { ApplicationService } from "./applications/service.ts";
export { validateApplicationBody } from "./applications/validate.ts";
export type { ApplicationCreateBody } from "./applications/validate.ts";
export {
  assertGuidanceEndpointBuyer,
  createGuidanceEndpointService,
  currentGuidanceEndpoint,
  getGuidanceEndpoint,
  setGuidanceEndpoint,
} from "./guidance-endpoint/service.ts";
export type { GuidanceEndpointService } from "./guidance-endpoint/service.ts";
export { validateGuidanceEndpointBody } from "./guidance-endpoint/validate.ts";
export { createBoilerplateService, generateBoilerplate, validateBoilerplateBody } from "./boilerplate/service.ts";
export type { BoilerplateService } from "./boilerplate/service.ts";
export { isNpmPackageName, planBoilerplate, SUPPORTED_LANGUAGES } from "./boilerplate/plan.ts";
export type {
  BoilerplatePlan,
  BoilerplatePlanResult,
  ComponentReference,
  DesignSystemReferences,
  PinnedItem,
  StackItem,
} from "./boilerplate/plan.ts";
export {
  GUIDANCE_SKILL_NAME,
  MCP_SERVER_NAME,
  renderAgentsMd,
  renderBoilerplateFiles,
  renderClaudeMcpJson,
  renderClaudeMd,
  renderClaudeSkill,
  renderCursorMcpJson,
  renderCursorSkill,
  renderDesignSystem,
  renderIdentificationFile,
  renderPackageJson,
  renderSharedFiles,
} from "./boilerplate/render.ts";
export type { BoilerplateFile, RenderInput } from "./boilerplate/render.ts";
export { tar, tarGz } from "./boilerplate/archive.ts";
export type { ArchiveEntry } from "./boilerplate/archive.ts";
export { bundleHash, ed25519SignerFromEnv, sha256Hex } from "./bundles/sign.ts";
export type { Signer } from "./bundles/sign.ts";
export { compileBundle, currentFrozen, currentStalenessHours } from "./bundles/compile.ts";
export type { CompiledBundle } from "./bundles/compile.ts";
export {
  assertBundleSettingsBuyer,
  createBundleService,
  validateFreezeBody,
  validateStalenessBody,
} from "./bundles/service.ts";
export type { BundleService } from "./bundles/service.ts";
export { createRegistryServer, MAX_BODY_BYTES, stdoutLogger } from "./http/server.ts";
export type { LogEvent, Logger, RegistryServices } from "./http/server.ts";
