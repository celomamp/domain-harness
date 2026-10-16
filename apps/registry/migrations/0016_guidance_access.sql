-- 0016_guidance_access: the Buyer's Guidance access control (Story 6.7).
--
-- guidance_role_grant_changes: every grant and revoke of the right to read
-- stored Guidance events for one role is one row, append-only. A role's
-- current state is its highest-sequence row; a role with no row is not
-- granted. Only the non-Buyer roles are stored: the Buyer is always
-- implicitly granted and can never be revoked. It is a separate table from
-- build_grant_changes, so one grant never implies the other.
--
-- guidance_retention_changes: every retention-setting change (the lifetime of
-- a Guidance event row, in days) is one row, append-only. The current setting
-- is the highest-sequence row; a tenant with no row uses the 90-day default
-- (GUIDANCE_EVENT_RETENTION_DAYS). The service enforces the setting on its
-- own store on a schedule.
--
-- Both `sequence` columns are per tenant, computed as max + 1 under the
-- tenant's bundle lock (the advisory-lock serialization the settings writers
-- share). The runtime role may only SELECT and INSERT: no UPDATE, no DELETE.

CREATE TABLE guidance_role_grant_changes (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  role        text        NOT NULL CHECK (role IN ('Buyer', 'Standard owner', 'Builder')),
  sequence    integer     NOT NULL CHECK (sequence >= 1),
  granted     boolean     NOT NULL,
  changed_by  uuid        NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guidance_role_grant_changes_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT guidance_role_grant_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

CREATE INDEX guidance_role_grant_changes_role_idx
  ON guidance_role_grant_changes (tenant_id, role, sequence DESC);

ALTER TABLE guidance_role_grant_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE guidance_role_grant_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON guidance_role_grant_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON guidance_role_grant_changes TO dh_registry_app;

CREATE TABLE guidance_retention_changes (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  days        integer     NOT NULL CHECK (days >= 1 AND days <= 3650),
  sequence    integer     NOT NULL CHECK (sequence >= 1),
  changed_by  uuid        NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guidance_retention_changes_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT guidance_retention_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE guidance_retention_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE guidance_retention_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON guidance_retention_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON guidance_retention_changes TO dh_registry_app;
