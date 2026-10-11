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
  CORRECTION_INSTRUCTION_MAX,
  isCodeStackCategory,
  isCodeStackEntry,
  isCodeStackStatus,
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
  VERSION_CONSTRAINT_MAX,
} from "./standards.ts";
export type {
  CodeStackCategory,
  CodeStackEntry,
  CodeStackEntryField,
  CodeStackStatus,
  ProjectRef,
  StandardInfo,
  StandardList,
  StandardModuleRef,
  StandardPublishRequest,
  StandardVersionList,
} from "./standards.ts";
