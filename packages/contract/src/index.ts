/** Workspace name of this unit. */
export const packageName = "@domain-harness/contract";

export { DEFAULT_PLAN, isPlan, isRole, PLANS, ROLES } from "./accounts.ts";
export type { Plan, Role } from "./accounts.ts";
export { isErrorEnvelope, PLAN_REFUSED } from "./errors.ts";
export type { ErrorEnvelope } from "./errors.ts";
export { isRecord, isUtcIso } from "./guards.ts";
export { isUuidV7 } from "./ids.ts";
export type { UuidV7 } from "./ids.ts";
export {
  isEmailAddress,
  isSessionCreated,
  isSessionInfo,
  normalizeEmail,
  REGISTRY_API_PATHS,
  SESSION_INVALID,
  SESSION_TTL_HOURS,
  SIGN_IN_LINK_INVALID,
  SIGN_IN_LINK_TTL_MINUTES,
} from "./sign-in.ts";
export type { SessionCreated, SessionCreateRequest, SessionInfo, SignInLinkRequest } from "./sign-in.ts";
export {
  isModuleInfo,
  isModuleKind,
  isModuleList,
  isModuleName,
  MODULE_API_PATHS,
  MODULE_KIND_LABELS,
  MODULE_KINDS,
  MODULE_NAME_MAX,
  MODULE_NAME_TAKEN,
  MODULE_NOT_FOUND,
  moduleOwnerPath,
  normalizeModuleName,
  ROLE_DENIED,
} from "./modules.ts";
export type {
  AccountRef,
  ModuleCreateRequest,
  ModuleInfo,
  ModuleKind,
  ModuleList,
  ModuleOwner,
  ModuleOwnerAssignRequest,
} from "./modules.ts";
export {
  CODE_STACK_CATEGORIES,
  CODE_STACK_ENTRY_FIELDS,
  CODE_STACK_STATUSES,
  COMPONENT_ENTRY_FIELDS,
  COMPONENT_TOKENS_MAX,
  CORRECTION_INSTRUCTION_MAX,
  DESIGN_SYSTEM_ENTRY_FIELDS,
  DESIGN_SYSTEM_ENTRY_KINDS,
  DESIGN_SYSTEM_STATUSES,
  entrySlotKind,
  entrySlotName,
  IMPORT_ENTRY_FIELDS,
  isCodeStackCategory,
  isCodeStackEntry,
  isCodeStackStatus,
  isDesignSystemEntry,
  isDesignSystemEntryKind,
  isDesignSystemStatus,
  isStandardEntry,
  isStandardInfo,
  isStandardList,
  isStandardVersionList,
  MODULE_HAS_NO_OWNER,
  moduleStandardsPath,
  NOT_MODULE_OWNER,
  SLOT_CONFLICT,
  STANDARD_API_PATHS,
  STANDARD_NAME_MAX,
  STANDARD_NOT_FOUND,
  standardVersionsPath,
  TOKEN_ENTRY_FIELDS,
  USAGE_RULE_MAX,
  VERSION_CONSTRAINT_MAX,
} from "./standards.ts";
export type {
  CodeStackCategory,
  CodeStackEntry,
  CodeStackEntryField,
  CodeStackEntryRequest,
  CodeStackStatus,
  ComponentEntry,
  DesignSystemEntry,
  DesignSystemEntryField,
  DesignSystemEntryKind,
  DesignSystemEntryRequest,
  DesignSystemStatus,
  ImportEntry,
  ProjectRef,
  StandardEntry,
  StandardInfo,
  StandardList,
  StandardModuleRef,
  StandardPublishRequest,
  StandardVersionList,
  TokenEntry,
} from "./standards.ts";
export {
  isProjectInfo,
  isProjectTree,
  LEVEL_NAME_MAX,
  PROJECT_API_PATHS,
  PROJECT_CYCLE,
  PROJECT_NAME_MAX,
  PROJECT_NOT_FOUND,
  projectParentPath,
  projectPath,
  ROOT_PROJECT_FIXED,
} from "./projects.ts";
export type { ProjectCreateRequest, ProjectInfo, ProjectParentRequest, ProjectTree } from "./projects.ts";
export { isLockedRuleMark, isLockedRuleState, LOCKED_RULE_CONFLICT, lockedRulePath } from "./locked-rules.ts";
export type { LockedRuleMark, LockedRuleRequest, LockedRuleState } from "./locked-rules.ts";
export { effectiveStandardsPath, isEffectiveSlot, isEffectiveStandard, isEffectiveStandardSet } from "./effective.ts";
export type { EffectiveSlot, EffectiveStandard, EffectiveStandardSet } from "./effective.ts";
export { BUNDLE_UNREADABLE, READ_API_PATHS, isReadEffectiveSetResponse, isReadStandardsResponse } from "./read-api.ts";
export type { ReadEffectiveSetResponse, ReadStandardsResponse } from "./read-api.ts";
export {
  CHILD_PERMISSION_DENIED,
  childPermissionsPath,
  isChildPermission,
  isChildPermissionList,
  isChildPermissionState,
} from "./child-permissions.ts";
export type {
  ChildPermission,
  ChildPermissionList,
  ChildPermissionRequest,
  ChildPermissionState,
  RoledAccountRef,
} from "./child-permissions.ts";
export {
  BUILD_GRANT_DENIED,
  buildGrantsPath,
  isBuildGrant,
  isBuildGrantList,
  isBuildGrantState,
} from "./build-grants.ts";
export type { BuildGrant, BuildGrantList, BuildGrantRequest, BuildGrantState } from "./build-grants.ts";
export {
  APPLICATION_API_PATHS,
  APPLICATION_DESCRIPTION_MAX,
  applicationEvidencePath,
  isApplicationEvidence,
  isApplicationInfo,
  isApplicationList,
} from "./applications.ts";
export type { ApplicationCreateRequest, ApplicationEvidence, ApplicationInfo, ApplicationList } from "./applications.ts";
export {
  APPLICATION_NOT_FOUND,
  applicationIdentificationFilePath,
  formatIdentificationFile,
  IDENTIFICATION_FILE_MAJOR,
  IDENTIFICATION_FILE_NAME,
  IDENTIFICATION_FILE_UNREADABLE,
  IDENTIFICATION_FILE_VERSION,
  isIdentificationFileRendering,
  parseIdentificationFile,
} from "./identification-file.ts";
export type {
  IdentificationFile,
  IdentificationFileRendering,
  IdentificationFileResult,
} from "./identification-file.ts";
export {
  applicationBoilerplatePath,
  BOILERPLATE_ARTIFACT_KINDS,
  BOILERPLATE_CONFLICT,
  BOILERPLATE_TARGETS,
  boilerplateArchiveName,
  GUIDANCE_ENDPOINT_PATH,
  GUIDANCE_ENDPOINT_UNSET,
  GUIDANCE_ENDPOINT_URL_MAX,
  isBoilerplateResult,
  isBoilerplateTarget,
  isGuidanceEndpointState,
  MCP_BRIDGE_PACKAGE,
  UNSUPPORTED_ECOSYSTEM,
} from "./boilerplate.ts";
export type {
  BoilerplateArtifact,
  BoilerplateArtifactKind,
  BoilerplateRequest,
  BoilerplateResult,
  BoilerplateTarget,
  GuidanceEndpointRequest,
  GuidanceEndpointState,
} from "./boilerplate.ts";
export {
  ACCEPTED_DEVIATION_ALERT_API_PATHS,
  ACCEPTED_DEVIATION_API_PATHS,
  DEVIATION_KINDS,
  DEVIATION_STATUSES,
  acceptedDeviationAlertDismissalPath,
  isAcceptedDeviation,
  isAcceptedDeviationAlert,
  isAcceptedDeviationAlertList,
  isAcceptedDeviationAlerts,
  isAcceptedDeviationRecord,
  isAcceptedDeviationRecordList,
  isAlertDismissedResult,
  isDeviation,
  parseDeviationLine,
} from "./deviations.ts";
export type {
  AcceptedDeviation,
  AcceptedDeviationAlert,
  AcceptedDeviationRecord,
  AlertDismissedResult,
  Deviation,
  DeviationKind,
  DeviationMatchKey,
  DeviationStatus,
} from "./deviations.ts";
export {
  EXTRACTOR_VERSION,
  FACT_SCHEMA_MAJOR,
  FACT_SCHEMA_VERSION,
  isDependencyFact,
  isImportFact,
  isRevisionFacts,
  isTokenFact,
  isUnreadableFile,
} from "./facts.ts";
export type {
  DependencyFact,
  ImportFact,
  RevisionFacts,
  TokenFact,
  UnreadableFile,
} from "./facts.ts";
export {
  BUNDLE_API_PATHS,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_TYPE,
  canonicalJson,
  DEFAULT_STALENESS_HOURS,
  isBundleApplication,
  isBundleFormat,
  isSignedStandardBundle,
  isStandardBundlePayload,
  standardBundleLatestPath,
} from "./bundles.ts";
export type {
  BundleApplication,
  BundleFormat,
  SignedStandardBundle,
  StandardBundlePayload,
} from "./bundles.ts";
export {
  GUIDANCE_IDENTITY_HEADERS,
  isGuidanceIdentityResult,
  REPOSITORY_FINGERPRINT_ALGORITHM_VERSION,
} from "./guidance-identity.ts";
export {
  GUIDANCE_TOOL_NAMES,
  GUIDANCE_TOOL_SUBJECT_MAX,
  GUIDANCE_TOOLS,
  isGuidanceToolName,
  isGuidanceToolResult,
  isGuidanceToolSubject,
} from "./guidance-tools.ts";
export type {
  GuidanceToolDescriptor,
  GuidanceToolHit,
  GuidanceToolInputSchema,
  GuidanceToolMiss,
  GuidanceToolName,
  GuidanceToolResult,
  GuidanceToolUnbound,
  GuidanceToolUnboundReason,
} from "./guidance-tools.ts";
export { GUIDANCE_EVENT_RETENTION_DAYS, isGuidanceEvent } from "./guidance-events.ts";
export type { GuidanceEvent, GuidanceEventOutcome } from "./guidance-events.ts";
export {
  decodeRoleTokenBody,
  defaultGuidanceAccessState,
  encodeRoleTokenBody,
  fromBase64Url,
  GRANTABLE_ROLES,
  GUIDANCE_ACCESS_API_PATHS,
  GUIDANCE_EVENT_READ_PATH,
  GUIDANCE_RETENTION_DAYS_MAX,
  GUIDANCE_RETENTION_DAYS_MIN,
  GUIDANCE_ROLE_TOKEN_TTL_MINUTES,
  isGrantableRole,
  isGuidanceAccessState,
  isGuidanceRoleToken,
  isGuidanceRoleTokenPayload,
  isRetentionDays,
  toBase64Url,
} from "./guidance-access.ts";
export type {
  GrantableRole,
  GuidanceAccessState,
  GuidanceRoleToken,
  GuidanceRoleTokenPayload,
} from "./guidance-access.ts";
export type {
  GuidanceAdvisoryProjectMismatch,
  GuidanceIdentityResult,
  GuidanceUnboundReason,
} from "./guidance-identity.ts";
export {
  BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION,
  BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION,
  CATALOG_UNREAD,
  COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION,
  COMPILATION_API_PATHS,
  COMPILATION_CATALOG_MAJOR,
  COMPILATION_CATALOG_VERSION,
  COMPILATION_KEYS,
  COMPILATION_SCHEMA_DOCS,
  COMPILATION_TYPE_NAMES,
  DEVIATION_COMPILATION_SCHEMA_VERSION,
  GATE_RUN_COMPILATION_SCHEMA_VERSION,
  GATE_RUN_VERDICTS,
  GUIDANCE_COMPILATION_OUTCOMES,
  GUIDANCE_COMPILATION_SCHEMA_VERSION,
  isBindingRefusalCompilation,
  isBundleStatusCompilation,
  isCollectorHealthCompilation,
  isCompilation,
  isCompilationCatalogRead,
  isCompilationCatalogReadState,
  isCompilationTypeName,
  isDeviationCompilation,
  isGateRunCompilation,
  isGateRunDeviationSummary,
  isGuidanceCompilation,
  isGuidanceCompilationSubject,
  isSupportedCompilationSchemaVersion,
} from "./compilations.ts";
export type {
  BindingRefusalCompilation,
  BundleStatusCompilation,
  CollectorHealthCompilation,
  Compilation,
  CompilationCatalogRead,
  CompilationCatalogReadRequest,
  CompilationCatalogReadState,
  CompilationSchemaDoc,
  CompilationSchemaFieldDoc,
  CompilationTypeName,
  DeviationCompilation,
  GateRunCompilation,
  GateRunDeviationSummary,
  GateRunVerdict,
  GuidanceCompilation,
  GuidanceCompilationOutcome,
  GuidanceCompilationSubject,
} from "./compilations.ts";
