import { foreignKey, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { isNull } from "drizzle-orm";
import { PLANS, ROLES } from "@domain-harness/contract";

// Drizzle mirror of migrations/0001_tenancy.sql, used for typed queries only.
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
  (table) => [unique("accounts_tenant_id_email_key").on(table.tenantId, table.email)],
);

/** The tenant-scoped tables created by migration 0001. */
export const TENANT_TABLES = ["tenants", "accounts", "projects"] as const;
