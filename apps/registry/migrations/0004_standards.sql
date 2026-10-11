-- 0004_standards: Standards and their append-only published versions, both
-- tenant-scoped behind forced RLS.
--
-- A Standard is one entry in one Module at one Project scope (the tenant's
-- root Project in this release). Its id never changes; every publish inserts
-- one standard_versions row with version = previous max + 1. The live version
-- of a Standard is its highest version. Rows are never updated or deleted: the
-- runtime role may only SELECT and INSERT.

CREATE TABLE standards (
  id         uuid        PRIMARY KEY,
  tenant_id  uuid        NOT NULL REFERENCES tenants (id),
  module_id  uuid        NOT NULL,
  project_id uuid        NOT NULL,
  created_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Composite target for the (tenant_id, standard_id) foreign key below.
  CONSTRAINT standards_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT standards_module_fkey FOREIGN KEY (tenant_id, module_id) REFERENCES modules (tenant_id, id),
  CONSTRAINT standards_project_fkey FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  CONSTRAINT standards_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES accounts (tenant_id, id)
);

CREATE INDEX standards_tenant_id_module_id_idx ON standards (tenant_id, module_id);

CREATE TABLE standard_versions (
  id           uuid        PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES tenants (id),
  standard_id  uuid        NOT NULL,
  -- Per Standard, 1, 2, 3, ...: computed as max + 1 under the tenant's publish lock.
  version      integer     NOT NULL CHECK (version >= 1),
  -- The Conflict slot kind and name, mirrored from the entry.
  category     text        NOT NULL CHECK (category IN ('language', 'framework', 'library')),
  name         text        NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200),
  -- The whole normalised code-stack entry.
  entry        jsonb       NOT NULL CHECK (
                             jsonb_typeof(entry) = 'object'
                             AND entry ->> 'category' = category
                             AND entry ->> 'name' = name
                             AND entry ->> 'status' IN ('approved', 'prohibited', 'required')
                           ),
  published_by uuid        NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT standard_versions_standard_id_version_key UNIQUE (standard_id, version),
  CONSTRAINT standard_versions_standard_fkey FOREIGN KEY (tenant_id, standard_id) REFERENCES standards (tenant_id, id),
  CONSTRAINT standard_versions_published_by_fkey FOREIGN KEY (tenant_id, published_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE standards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE standards         FORCE  ROW LEVEL SECURITY;
ALTER TABLE standard_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE standard_versions FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON standards
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON standard_versions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON standards, standard_versions TO dh_registry_app;
