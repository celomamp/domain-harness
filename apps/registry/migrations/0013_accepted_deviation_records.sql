-- 0013_accepted_deviation_records: the Buyer's Accepted deviations (Story 5.5).
--
-- accepted_deviation_records: every acceptance the Buyer records is one row,
-- append-only. The key is (application_id, standard_id, standard_version,
-- slot_module_kind, slot_kind, slot_name, subject); the version and the slot
-- are the ones the Effective Standard set carried when the registry resolved
-- the submitted key, under the tenant's bundle lock. `sequence` is per
-- tenant, computed as max + 1 under the tenant's standards:<root id> advisory
-- lock (the bundle lock). Ends_at strictly after starts_at is enforced by the
-- registry (subject `end`) and by the CHECK. The runtime role may only SELECT
-- and INSERT: no UPDATE, no DELETE.

CREATE TABLE accepted_deviation_records (
  id                  uuid        PRIMARY KEY,
  tenant_id           uuid        NOT NULL REFERENCES tenants (id),
  sequence            integer     NOT NULL CHECK (sequence >= 1),
  application_id      uuid        NOT NULL,
  standard_id         uuid        NOT NULL,
  standard_version    integer     NOT NULL CHECK (standard_version >= 1),
  slot_module_kind    text        NOT NULL CHECK (slot_module_kind IN ('code-stack', 'design-system')),
  slot_kind           text        NOT NULL CHECK (slot_kind <> ''),
  slot_name           text        NOT NULL CHECK (slot_name <> ''),
  subject             text        NOT NULL CHECK (subject <> ''),
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  buyer               uuid        NOT NULL,
  justification       text        NOT NULL CHECK (justification <> ''),
  alert_interval_hours integer    NOT NULL CHECK (alert_interval_hours >= 1 AND alert_interval_hours <= 8760),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accepted_deviation_records_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT accepted_deviation_records_window_check CHECK (ends_at > starts_at),
  CONSTRAINT accepted_deviation_records_application_fkey FOREIGN KEY (tenant_id, application_id) REFERENCES applications (tenant_id, id),
  CONSTRAINT accepted_deviation_records_standard_fkey FOREIGN KEY (tenant_id, standard_id) REFERENCES standards (tenant_id, id),
  CONSTRAINT accepted_deviation_records_buyer_fkey FOREIGN KEY (tenant_id, buyer) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE accepted_deviation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE accepted_deviation_records FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON accepted_deviation_records
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON accepted_deviation_records TO dh_registry_app;
