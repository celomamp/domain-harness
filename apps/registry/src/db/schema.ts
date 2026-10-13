import { boolean, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { isNull, sql } from "drizzle-orm";
import { CODE_STACK_CATEGORIES, DESIGN_SYSTEM_ENTRY_KINDS, MODULE_KINDS, PLANS, ROLES } from "@domain-harness/contract";
import type { StandardEntry } from "@domain-harness/contract";

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

/** The tenant-scoped tables created by migrations 0001 to 0010. */
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
] as const;

/** The NOLOGIN role that owns the cross-tenant email lookup; no runtime role may be a member. */
export const SIGN_IN_LOOKUP_ROLE = "dh_sign_in_lookup";
