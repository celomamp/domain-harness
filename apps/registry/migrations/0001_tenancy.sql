-- 0001_tenancy: tenant, account and root-Project tables behind row-level security.
--
-- Runs as the migrator (table owner). The registry runtime connects as a login
-- role that is a member of dh_registry_app, which owns nothing and may only
-- SELECT and INSERT; RLS is FORCEd so even the owner is filtered by tenant.
-- An unset app.tenant_id makes every policy compare against NULL: zero rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dh_registry_app') THEN
    CREATE ROLE dh_registry_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- A pre-existing dh_registry_app must not carry LOGIN, SUPERUSER, BYPASSRLS,
-- CREATEDB or CREATEROLE. Altered only when wrong, because changing SUPERUSER
-- or BYPASSRLS needs a superuser migrator; a migrator without that right then
-- fails here loudly instead of accepting an unsafe role.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'dh_registry_app'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
  ) THEN
    ALTER ROLE dh_registry_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

CREATE TABLE tenants (
  id         uuid        PRIMARY KEY,
  name       text        NOT NULL CHECK (btrim(name) <> ''),
  plan       text        NOT NULL DEFAULT 'Team'
                         CHECK (plan IN ('Community', 'Team', 'Business', 'Enterprise')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id         uuid        PRIMARY KEY,
  tenant_id  uuid        NOT NULL REFERENCES tenants (id),
  parent_id  uuid        NULL,
  name       text        NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_tenant_id_id_key UNIQUE (tenant_id, id),
  -- A parent is always a Project of the same tenant.
  CONSTRAINT projects_parent_fkey FOREIGN KEY (tenant_id, parent_id) REFERENCES projects (tenant_id, id),
  CONSTRAINT projects_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Exactly one root Project (no parent) per tenant.
CREATE UNIQUE INDEX projects_one_root_per_tenant ON projects (tenant_id) WHERE parent_id IS NULL;

CREATE TABLE accounts (
  id         uuid        PRIMARY KEY,
  tenant_id  uuid        NOT NULL REFERENCES tenants (id),
  name       text        NOT NULL CHECK (btrim(name) <> ''),
  -- Stored normalized: trimmed and lower-cased before the uniqueness check.
  email      text        NOT NULL CHECK (email <> '' AND email = lower(btrim(email))),
  role       text        NOT NULL CHECK (role IN ('Buyer', 'Standard owner', 'Builder')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_tenant_id_email_key UNIQUE (tenant_id, email)
);

ALTER TABLE tenants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants  FORCE  ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE  ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON accounts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA public TO dh_registry_app;
GRANT SELECT, INSERT ON tenants, projects, accounts TO dh_registry_app;
