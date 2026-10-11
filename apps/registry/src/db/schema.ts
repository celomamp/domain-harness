import { foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { isNull, sql } from "drizzle-orm";
import { CODE_STACK_CATEGORIES, MODULE_KINDS, PLANS, ROLES } from "@domain-harness/contract";
import type { CodeStackEntry } from "@domain-harness/contract";

// Drizzle mirror of migrations/0001_tenancy.sql to 0004_standards.sql, used for typed queries only.
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
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
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
    category: text("category", { enum: CODE_STACK_CATEGORIES }).notNull(),
    name: text("name").notNull(),
    entry: jsonb("entry").$type<CodeStackEntry>().notNull(),
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

/** The tenant-scoped tables created by migrations 0001 to 0004. */
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
] as const;

/** The NOLOGIN role that owns the cross-tenant email lookup; no runtime role may be a member. */
export const SIGN_IN_LOOKUP_ROLE = "dh_sign_in_lookup";
