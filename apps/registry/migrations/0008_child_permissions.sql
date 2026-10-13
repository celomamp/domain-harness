-- 0008_child_permissions: the Buyer's child-Project permission grants (Story 2.5).
--
-- Every grant and revoke of the permission for one account to create child
-- Projects directly under one Project is one row, append-only. A (Project,
-- account) pair's current state is its highest-sequence row; a pair with no
-- row is not granted. `sequence` is per tenant, computed as max + 1 under the
-- tenant's standards:<root id> advisory lock (the bundle lock), which every
-- grant, tree change and publish takes.
-- The runtime role may only SELECT and INSERT: no UPDATE, no DELETE.

CREATE TABLE child_permission_changes (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  project_id  uuid        NOT NULL,
  account_id  uuid        NOT NULL,
  sequence    integer     NOT NULL CHECK (sequence >= 1),
  granted     boolean     NOT NULL,
  changed_by  uuid        NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT child_permission_changes_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT child_permission_changes_project_fkey FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  CONSTRAINT child_permission_changes_account_fkey FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id),
  CONSTRAINT child_permission_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

CREATE INDEX child_permission_changes_pair_idx
  ON child_permission_changes (tenant_id, project_id, account_id, sequence DESC);

ALTER TABLE child_permission_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_permission_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON child_permission_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON child_permission_changes TO dh_registry_app;
