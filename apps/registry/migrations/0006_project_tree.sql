-- 0006_project_tree: the Buyer's Project tree (Story 2.1).
--
-- `projects` gains the level name (stored exactly as typed; NULL for the root
-- Project provisioned by 0001) and who created the Project (NULL for the
-- provisioned root). `projects.parent_id` stays the parent at creation: it
-- keeps the one-root index and the same-tenant FK. The current parent of a
-- non-root Project is the parent_id of its highest-sequence row in
-- `project_parent_changes`, which records every create and every parent
-- change, append-only. The root has no rows and its parent stays NULL.
-- The runtime role may only SELECT and INSERT: no UPDATE, no DELETE.

ALTER TABLE projects ADD COLUMN level_name text NULL
  CONSTRAINT projects_level_name_check
  CHECK (level_name IS NULL OR (char_length(level_name) BETWEEN 1 AND 200 AND btrim(level_name) <> ''));

ALTER TABLE projects ADD COLUMN created_by uuid NULL;
ALTER TABLE projects ADD CONSTRAINT projects_created_by_fkey
  FOREIGN KEY (tenant_id, created_by) REFERENCES accounts (tenant_id, id);

CREATE TABLE project_parent_changes (
  id         uuid        PRIMARY KEY,
  tenant_id  uuid        NOT NULL REFERENCES tenants (id),
  project_id uuid        NOT NULL,
  -- Per tenant, 1, 2, 3, ...: computed as max + 1 under the tenant's
  -- standards:<root id> advisory lock, which every tree change and publish takes.
  sequence   integer     NOT NULL CHECK (sequence >= 1),
  parent_id  uuid        NOT NULL,
  changed_by uuid        NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_parent_changes_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT project_parent_changes_not_own_parent CHECK (parent_id <> project_id),
  CONSTRAINT project_parent_changes_project_fkey FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  CONSTRAINT project_parent_changes_parent_fkey FOREIGN KEY (tenant_id, parent_id) REFERENCES projects (tenant_id, id),
  CONSTRAINT project_parent_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

CREATE INDEX project_parent_changes_project_idx ON project_parent_changes (tenant_id, project_id, sequence DESC);

ALTER TABLE project_parent_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_parent_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON project_parent_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON project_parent_changes TO dh_registry_app;
