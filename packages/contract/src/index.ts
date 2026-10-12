/** Workspace name of this unit. */
export const packageName = "@domain-harness/contract";

export { DEFAULT_PLAN, isPlan, isRole, PLANS, ROLES } from "./accounts.ts";
export type { Plan, Role } from "./accounts.ts";
export { isErrorEnvelope } from "./errors.ts";
export type { ErrorEnvelope } from "./errors.ts";
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
