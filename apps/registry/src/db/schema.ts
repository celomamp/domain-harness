import { boolean, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { isNull, sql } from "drizzle-orm";
import { CODE_STACK_CATEGORIES, DESIGN_SYSTEM_ENTRY_KINDS, MODULE_KINDS, PLANS, ROLES } from "@domain-harness/contract";
import type { Compilation, StandardEntry } from "@domain-harness/contract";

// Drizzle mirror of migrations/0001_tenancy.sql to 0010_guidance_endpoint.sql, used for typed queries only.
// The SQL migration is the source of truth for constraints, RLS and grants.

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan", { enum: PLANS }).notNull().default("Team"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /**
     * The parent at creation, NOT the current parent: NULL only for the root,
     * kept for the one-root index and the same-tenant FK. A Project's current
     * parent is the `parentId` of its highest-sequence {@link projectParentChanges}
     * row (see `currentProjects` in projects/service.ts); never read this as it.
     */
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    // Exactly as the Buyer typed it (0006); NULL for the provisioned root.
    levelName: text("level_name"),
    // The Buyer who created it (0006); NULL for the provisioned root.
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("projects_tenant_id_id_key").on(table.tenantId, table.id),
    foreignKey({
      name: "projects_parent_fkey",
      columns: [table.tenantId, table.parentId],
      foreignColumns: [table.tenantId, table.id],
    }),
    uniqueIndex("projects_one_root_per_tenant").on(table.tenantId).where(isNull(table.parentId)),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("accounts_tenant_id_email_key").on(table.tenantId, table.email),
    unique("accounts_tenant_id_id_key").on(table.tenantId, table.id),
    index("accounts_email_idx").on(table.email),
  ],
);

/** Single-use sign-in links. Only the SHA-256 (hex) of the token is stored. */
export const signInLinks = pgTable(
  "sign_in_links",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    accountId: uuid("account_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("sign_in_links_token_hash_key").on(table.tokenHash),
    foreignKey({
      name: "sign_in_links_account_fkey",
      columns: [table.tenantId, table.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Panel sessions. Only the SHA-256 (hex) of the token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    accountId: uuid("account_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    unique("sessions_token_hash_key").on(table.tokenHash),
    foreignKey({
      name: "sessions_account_fkey",
      columns: [table.tenantId, table.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Modules. The owner is never a column: it is the latest {@link moduleOwnerAssignments} row. */
export const modules = pgTable(
  "modules",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    kind: text("kind", { enum: MODULE_KINDS }).notNull(),
    name: text("name").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("modules_tenant_id_id_key").on(table.tenantId, table.id),
    uniqueIndex("modules_tenant_id_lower_name_key").on(table.tenantId, sql`lower(${table.name})`),
    foreignKey({
      name: "modules_created_by_fkey",
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Append-only Standard-owner assignments; the current owner has the highest `sequence` for its Module. */
export const moduleOwnerAssignments = pgTable(
  "module_owner_assignments",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    moduleId: uuid("module_id").notNull(),
    sequence: integer("sequence").notNull(),
    ownerAccountId: uuid("owner_account_id").notNull(),
    assignedBy: uuid("assigned_by").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("module_owner_assignments_module_id_sequence_key").on(table.moduleId, table.sequence),
    foreignKey({
      name: "module_owner_assignments_module_fkey",
      columns: [table.tenantId, table.moduleId],
      foreignColumns: [modules.tenantId, modules.id],
    }),
    foreignKey({
      name: "module_owner_assignments_owner_fkey",
      columns: [table.tenantId, table.ownerAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    foreignKey({
      name: "module_owner_assignments_assigned_by_fkey",
      columns: [table.tenantId, table.assignedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Standards: one entry in one Module at one Project scope. The id is stable across versions. */
export const standards = pgTable(
  "standards",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    moduleId: uuid("module_id").notNull(),
    projectId: uuid("project_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("standards_tenant_id_id_key").on(table.tenantId, table.id),
    index("standards_tenant_id_module_id_idx").on(table.tenantId, table.moduleId),
    foreignKey({
      name: "standards_module_fkey",
      columns: [table.tenantId, table.moduleId],
      foreignColumns: [modules.tenantId, modules.id],
    }),
    foreignKey({
      name: "standards_project_fkey",
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: "standards_created_by_fkey",
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Every slot kind `standard_versions.category` may hold. */
const SLOT_KINDS = [...CODE_STACK_CATEGORIES, ...DESIGN_SYSTEM_ENTRY_KINDS] as const;

/** Append-only published versions; a Standard's live version has the highest `version`. */
export const standardVersions = pgTable(
  "standard_versions",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    standardId: uuid("standard_id").notNull(),
    version: integer("version").notNull(),
    // The slot kind: a code-stack category or a design-system entry kind (0005).
    category: text("category", { enum: SLOT_KINDS }).notNull(),
    // The slot name: the entry's name, or an import's module specifier.
    name: text("name").notNull(),
    entry: jsonb("entry").$type<StandardEntry>().notNull(),
    publishedBy: uuid("published_by").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("standard_versions_standard_id_version_key").on(table.standardId, table.version),
    foreignKey({
      name: "standard_versions_standard_fkey",
      columns: [table.tenantId, table.standardId],
      foreignColumns: [standards.tenantId, standards.id],
    }),
    foreignKey({
      name: "standard_versions_published_by_fkey",
      columns: [table.tenantId, table.publishedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/**
 * Append-only Project creates and parent changes (0006). A non-root Project's
 * current parent is the `parentId` of its highest-`sequence` row; `sequence`
 * is per tenant.
 */
export const projectParentChanges = pgTable(
  "project_parent_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id").notNull(),
    sequence: integer("sequence").notNull(),
    parentId: uuid("parent_id").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("project_parent_changes_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    index("project_parent_changes_project_idx").on(table.tenantId, table.projectId, table.sequence.desc()),
    foreignKey({
      name: "project_parent_changes_project_fkey",
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: "project_parent_changes_parent_fkey",
      columns: [table.tenantId, table.parentId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: "project_parent_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/**
 * Append-only Locked-rule marks and unmarks (0007). A Standard's current state
 * is the `locked` of its highest-`sequence` row; no row means not locked.
 * `sequence` is per tenant.
 */
export const lockedRuleChanges = pgTable(
  "locked_rule_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    standardId: uuid("standard_id").notNull(),
    sequence: integer("sequence").notNull(),
    locked: boolean("locked").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("locked_rule_changes_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    index("locked_rule_changes_standard_idx").on(table.tenantId, table.standardId, table.sequence.desc()),
    foreignKey({
      name: "locked_rule_changes_standard_fkey",
      columns: [table.tenantId, table.standardId],
      foreignColumns: [standards.tenantId, standards.id],
    }),
    foreignKey({
      name: "locked_rule_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

export const childPermissionChanges = pgTable(
  "child_permission_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id").notNull(),
    accountId: uuid("account_id").notNull(),
    sequence: integer("sequence").notNull(),
    granted: boolean("granted").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("child_permission_changes_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    index("child_permission_changes_pair_idx").on(
      table.tenantId,
      table.projectId,
      table.accountId,
      table.sequence.desc(),
    ),
    foreignKey({
      name: "child_permission_changes_project_fkey",
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: "child_permission_changes_account_fkey",
      columns: [table.tenantId, table.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    foreignKey({
      name: "child_permission_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Migration 0009: the build grant changes (Story 3.1), append-only, a copy of the child-Project permission changes. */
export const buildGrantChanges = pgTable(
  "build_grant_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id").notNull(),
    accountId: uuid("account_id").notNull(),
    sequence: integer("sequence").notNull(),
    granted: boolean("granted").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("build_grant_changes_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    index("build_grant_changes_pair_idx").on(
      table.tenantId,
      table.projectId,
      table.accountId,
      table.sequence.desc(),
    ),
    foreignKey({
      name: "build_grant_changes_project_fkey",
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: "build_grant_changes_account_fkey",
      columns: [table.tenantId, table.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    foreignKey({
      name: "build_grant_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Migration 0009: the Applications (Story 3.1), append-only, each bound to exactly one Project. */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id").notNull(),
    description: text("description").notNull(),
    fromFlow: boolean("from_flow").notNull(),
    sequence: integer("sequence").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("applications_tenant_id_id_key").on(table.tenantId, table.id),
    unique("applications_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    foreignKey({
      name: "applications_project_fkey",
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: "applications_created_by_fkey",
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Migration 0010: the Company Guidance endpoint URL changes (Story 3.3), append-only; the current URL is the highest sequence. */
export const guidanceEndpointChanges = pgTable(
  "guidance_endpoint_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    sequence: integer("sequence").notNull(),
    url: text("url").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("guidance_endpoint_changes_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    foreignKey({
      name: "guidance_endpoint_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/**
 * Migration 0011: the Application agent-tool changes (Story 3.4), append-only,
 * a per-Application sibling of the endpoint changes; the current tool of an
 * Application is the highest sequence of its rows.
 */
export const applicationAgentToolChanges = pgTable(
  "application_agent_tool_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    applicationId: uuid("application_id").notNull(),
    sequence: integer("sequence").notNull(),
    agentTool: text("agent_tool").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("application_agent_tool_changes_tenant_id_application_id_sequence_key").on(
      table.tenantId,
      table.applicationId,
      table.sequence,
    ),
    foreignKey({
      name: "application_agent_tool_changes_application_fkey",
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
    }),
    foreignKey({
      name: "application_agent_tool_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

export const bundleRecords = pgTable(
  "bundle_records",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sequence: integer("sequence").notNull(),
    hash: text("hash").notNull(),
    keyId: text("key_id").notNull(),
    payload: jsonb("payload").notNull(),
    signature: text("signature").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("bundle_records_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    unique("bundle_records_hash_key").on(table.hash),
    foreignKey({ name: "bundle_records_tenant_fkey", columns: [table.tenantId], foreignColumns: [tenants.id] }),
  ],
);

export const tenantServiceCredentials = pgTable(
  "tenant_service_credentials",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("tenant_service_credentials_token_hash_key").on(table.tokenHash),
    foreignKey({ name: "tenant_service_credentials_tenant_fkey", columns: [table.tenantId], foreignColumns: [tenants.id] }),
  ],
);

export const bundleSettingChanges = pgTable(
  "bundle_setting_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sequence: integer("sequence").notNull(),
    stalenessHours: integer("staleness_hours"),
    frozen: boolean("frozen"),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("bundle_setting_changes_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    foreignKey({
      name: "bundle_setting_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/**
 * Migration 0013: the Buyer's Accepted deviations (Story 5.5), append-only.
 * The version and slot are the ones the Effective Standard set carried when
 * the registry resolved the submitted key under the bundle lock.
 */
export const acceptedDeviationRecords = pgTable(
  "accepted_deviation_records",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sequence: integer("sequence").notNull(),
    applicationId: uuid("application_id").notNull(),
    standardId: uuid("standard_id").notNull(),
    standardVersion: integer("standard_version").notNull(),
    slotModuleKind: text("slot_module_kind", { enum: MODULE_KINDS }).notNull(),
    slotKind: text("slot_kind").notNull(),
    slotName: text("slot_name").notNull(),
    subject: text("subject").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    buyer: uuid("buyer").notNull(),
    justification: text("justification").notNull(),
    alertIntervalHours: integer("alert_interval_hours").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("accepted_deviation_records_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    foreignKey({ name: "accepted_deviation_records_tenant_fkey", columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: "accepted_deviation_records_application_fkey",
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
    }),
    foreignKey({
      name: "accepted_deviation_records_standard_fkey",
      columns: [table.tenantId, table.standardId],
      foreignColumns: [standards.tenantId, standards.id],
    }),
    foreignKey({
      name: "accepted_deviation_records_buyer_fkey",
      columns: [table.tenantId, table.buyer],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/**
 * Migration 0014: the Buyer's recurring alerts (Story 5.6), append-only. One
 * row per raised interval boundary of an acceptance (one alert per boundary
 * forever, made idempotent by the boundary key), and one row per Buyer
 * dismissal.
 */
export const acceptedDeviationAlerts = pgTable(
  "accepted_deviation_alerts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    acceptanceId: uuid("acceptance_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("accepted_deviation_alerts_boundary_key").on(table.tenantId, table.acceptanceId, table.dueAt),
    unique("accepted_deviation_alerts_tenant_id_id_key").on(table.tenantId, table.id),
    foreignKey({ name: "accepted_deviation_alerts_tenant_fkey", columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: "accepted_deviation_alerts_acceptance_fkey",
      columns: [table.tenantId, table.acceptanceId],
      foreignColumns: [acceptedDeviationRecords.tenantId, acceptedDeviationRecords.id],
    }),
  ],
);

export const acceptedDeviationAlertDismissals = pgTable(
  "accepted_deviation_alert_dismissals",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    alertId: uuid("alert_id").notNull(),
    dismissedBy: uuid("dismissed_by").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("accepted_deviation_alert_dismissals_alert_key").on(table.tenantId, table.alertId),
    foreignKey({
      name: "accepted_deviation_alert_dismissals_tenant_fkey",
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
    foreignKey({
      name: "accepted_deviation_alert_dismissals_alert_fkey",
      columns: [table.tenantId, table.alertId],
      foreignColumns: [acceptedDeviationAlerts.tenantId, acceptedDeviationAlerts.id],
    }),
    foreignKey({
      name: "accepted_deviation_alert_dismissals_dismissed_by_fkey",
      columns: [table.tenantId, table.dismissedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/**
 * Migration 0015: the published Compilation catalog (Story 6.1), append-only.
 * One catalog-read row per tenant per catalog version (re-reads insert
 * nothing), and one row per accepted Compilation (resends answer the stored
 * row; the per-Application order stays single).
 */
export const compilationCatalogReads = pgTable(
  "compilation_catalog_reads",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    catalogVersion: text("catalog_version").notNull(),
    readBy: uuid("read_by").notNull(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("compilation_catalog_reads_tenant_version_key").on(table.tenantId, table.catalogVersion),
    foreignKey({ name: "compilation_catalog_reads_tenant_fkey", columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: "compilation_catalog_reads_read_by_fkey",
      columns: [table.tenantId, table.readBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

export const compilations = pgTable(
  "compilations",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    applicationId: uuid("application_id").notNull(),
    typeName: text("type_name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    catalogVersion: text("catalog_version").notNull(),
    agentToolName: text("agent_tool_name").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    sequence: integer("sequence").notNull(),
    payload: jsonb("payload").$type<Compilation>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("compilations_tenant_idempotency_key").on(table.tenantId, table.idempotencyKey),
    unique("compilations_tenant_application_sequence_key").on(table.tenantId, table.applicationId, table.sequence),
    foreignKey({ name: "compilations_tenant_fkey", columns: [table.tenantId], foreignColumns: [tenants.id] }),
  ],
);

/** Migration 0016: the Guidance role-grant and retention changes (Story 6.7), append-only per tenant. */
export const guidanceRoleGrantChanges = pgTable(
  "guidance_role_grant_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    role: text("role").notNull(),
    sequence: integer("sequence").notNull(),
    granted: boolean("granted").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("guidance_role_grant_changes_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    index("guidance_role_grant_changes_role_idx").on(table.tenantId, table.role, table.sequence.desc()),
    foreignKey({ name: "guidance_role_grant_changes_tenant_fkey", columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: "guidance_role_grant_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** Migration 0016: the Guidance retention-setting changes (Story 6.7), append-only per tenant. */
export const guidanceRetentionChanges = pgTable(
  "guidance_retention_changes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    days: integer("days").notNull(),
    sequence: integer("sequence").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("guidance_retention_changes_tenant_id_sequence_key").on(table.tenantId, table.sequence),
    foreignKey({ name: "guidance_retention_changes_tenant_fkey", columns: [table.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: "guidance_retention_changes_changed_by_fkey",
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/** The tenant-scoped tables created by migrations 0001 to 0016. */
export const TENANT_TABLES = [
  "tenants",
  "accounts",
  "projects",
  "sign_in_links",
  "sessions",
  "modules",
  "module_owner_assignments",
  "standards",
  "standard_versions",
  "project_parent_changes",
  "locked_rule_changes",
  "child_permission_changes",
  "build_grant_changes",
  "applications",
  "guidance_endpoint_changes",
  "application_agent_tool_changes",
  "bundle_records",
  "tenant_service_credentials",
  "bundle_setting_changes",
  "accepted_deviation_records",
  "accepted_deviation_alerts",
  "accepted_deviation_alert_dismissals",
  "compilation_catalog_reads",
  "compilations",
  "guidance_role_grant_changes",
  "guidance_retention_changes",
] as const;

/** The NOLOGIN role that owns the cross-tenant email lookup; no runtime role may be a member. */
export const SIGN_IN_LOOKUP_ROLE = "dh_sign_in_lookup";

/** The NOLOGIN role that owns the cross-tenant live-acceptance lookup (migration 0014); never a runtime role. */
export const ALERT_SCHEDULER_ROLE = "dh_alert_scheduler";
