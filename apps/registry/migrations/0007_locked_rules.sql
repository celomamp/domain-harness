-- 0007_locked_rules: the Buyer's Locked rules (Story 2.4).
--
-- Every mark and unmark of a Standard as a Locked rule is one row, append-only.
-- A Standard's current state is its highest-sequence row; a Standard with no
-- row is not locked. `sequence` is per tenant, computed as max + 1 under the
-- tenant's standards:<root id> advisory lock (the bundle lock), which every
-- mark, tree change and publish takes.
-- The runtime role may only SELECT and INSERT: no UPDATE, no DELETE.

CREATE TABLE locked_rule_changes (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  standard_id uuid        NOT NULL,
  sequence    integer     NOT NULL CHECK (sequence >= 1),
  locked      boolean     NOT NULL,
  changed_by  uuid        NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locked_rule_changes_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT locked_rule_changes_standard_fkey FOREIGN KEY (tenant_id, standard_id) REFERENCES standards (tenant_id, id),
  CONSTRAINT locked_rule_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

CREATE INDEX locked_rule_changes_standard_idx ON locked_rule_changes (tenant_id, standard_id, sequence DESC);

ALTER TABLE locked_rule_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE locked_rule_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON locked_rule_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON locked_rule_changes TO dh_registry_app;
