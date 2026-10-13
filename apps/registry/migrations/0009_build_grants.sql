-- 0009_build_grants: the Buyer's build grants and the Applications (Story 3.1).
--
-- build_grant_changes: every grant and revoke of the build grant (the right
-- to place a new Application on one Project) for one account is one row,
-- append-only. A (Project, account) pair's current state is its
-- highest-sequence row; a pair with no row is not granted. It is a separate
-- table from child_permission_changes, so one grant never implies the other.
--
-- applications: every Application of the Company, append-only, bound to
-- exactly one Project. `id` is a registry-minted UUIDv7. `from_flow` records
-- whether the New-application flow created it. `sequence` is the Application
-- list version of the bundle input.
--
-- Both `sequence` columns are per tenant, computed as max + 1 under the
-- tenant's standards:<root id> advisory lock (the bundle lock).
-- The runtime role may only SELECT and INSERT: no UPDATE, no DELETE.

CREATE TABLE build_grant_changes (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  project_id  uuid        NOT NULL,
  account_id  uuid        NOT NULL,
  sequence    integer     NOT NULL CHECK (sequence >= 1),
  granted     boolean     NOT NULL,
  changed_by  uuid        NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT build_grant_changes_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT build_grant_changes_project_fkey FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  CONSTRAINT build_grant_changes_account_fkey FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id),
  CONSTRAINT build_grant_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

CREATE INDEX build_grant_changes_pair_idx
  ON build_grant_changes (tenant_id, project_id, account_id, sequence DESC);

ALTER TABLE build_grant_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_grant_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON build_grant_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON build_grant_changes TO dh_registry_app;

CREATE TABLE applications (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  project_id  uuid        NOT NULL,
  description text        NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 500),
  from_flow   boolean     NOT NULL,
  sequence    integer     NOT NULL CHECK (sequence >= 1),
  created_by  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT applications_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT applications_project_fkey FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  CONSTRAINT applications_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON applications
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON applications TO dh_registry_app;
