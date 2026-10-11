-- 0003_modules: Modules and their append-only Standard-owner assignments,
-- both tenant-scoped behind forced RLS.
--
-- A Module never stores its owner. The current owner is the assignment with
-- the highest sequence for that Module; earlier assignments stay as written.
-- The runtime role may only SELECT and INSERT: no UPDATE, no DELETE.

CREATE TABLE modules (
  id         uuid        PRIMARY KEY,
  tenant_id  uuid        NOT NULL REFERENCES tenants (id),
  kind       text        NOT NULL CHECK (kind IN ('code-stack', 'design-system')),
  -- Stored trimmed; 1 to 120 characters.
  name       text        NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  created_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Composite target for the (tenant_id, module_id) foreign key below.
  CONSTRAINT modules_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT modules_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES accounts (tenant_id, id)
);

-- A name is unique per tenant, compared case-insensitively.
CREATE UNIQUE INDEX modules_tenant_id_lower_name_key ON modules (tenant_id, lower(name));

CREATE TABLE module_owner_assignments (
  id               uuid        PRIMARY KEY,
  tenant_id        uuid        NOT NULL REFERENCES tenants (id),
  module_id        uuid        NOT NULL,
  -- Per Module, 1, 2, 3, ...: computed as max + 1 under an advisory lock on the Module id.
  sequence         integer     NOT NULL CHECK (sequence >= 1),
  owner_account_id uuid        NOT NULL,
  assigned_by      uuid        NOT NULL,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_owner_assignments_module_id_sequence_key UNIQUE (module_id, sequence),
  CONSTRAINT module_owner_assignments_module_fkey FOREIGN KEY (tenant_id, module_id) REFERENCES modules (tenant_id, id),
  CONSTRAINT module_owner_assignments_owner_fkey FOREIGN KEY (tenant_id, owner_account_id) REFERENCES accounts (tenant_id, id),
  CONSTRAINT module_owner_assignments_assigned_by_fkey FOREIGN KEY (tenant_id, assigned_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE modules                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE module_owner_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_owner_assignments FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON modules
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON module_owner_assignments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON modules, module_owner_assignments TO dh_registry_app;
