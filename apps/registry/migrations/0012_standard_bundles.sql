-- 0012_standard_bundles: Standard bundles (Story 4.1).
--
-- bundle_records: one immutable, signed Standard bundle per build, per tenant.
-- `hash` is SHA-256 hex (64 characters) over the canonical signed body and is
-- the bundle's identity; `sequence` is per tenant, max + 1 under the tenant's
-- standards:<root id> bundle lock. Append-only: runtime role may only SELECT
-- and INSERT.
--
-- tenant_service_credentials: one SHA-256 hex token hash per provisioning run,
-- used by the Company service to pull the tenant's latest bundle. Append-only
-- in practice (one per provisioning); runtime role may only SELECT and INSERT.
--
-- bundle_setting_changes: every change of the staleness bound or the freeze
-- state is one row, append-only. Each row carries exactly one of
-- `staleness_hours` or `frozen`. The current settings are the highest-sequence
-- non-null `staleness_hours` and the highest-sequence non-null `frozen` (or
-- the defaults when none). `sequence` is per tenant, max + 1 under the bundle
-- lock. Runtime role may only SELECT and INSERT.

CREATE TABLE bundle_records (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  sequence    integer     NOT NULL CHECK (sequence >= 1),
  hash        text        NOT NULL CHECK (char_length(hash) = 64),
  key_id      text        NOT NULL CHECK (key_id <> ''),
  payload     jsonb       NOT NULL,
  signature   text        NOT NULL CHECK (signature <> ''),
  issued_at   timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_records_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT bundle_records_hash_key UNIQUE (hash)
);

ALTER TABLE bundle_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_records FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON bundle_records
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON bundle_records TO dh_registry_app;

CREATE TABLE tenant_service_credentials (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  token_hash  text        NOT NULL CHECK (char_length(token_hash) = 64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_service_credentials_token_hash_key UNIQUE (token_hash)
);

ALTER TABLE tenant_service_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_service_credentials FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_service_credentials
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON tenant_service_credentials TO dh_registry_app;

CREATE TABLE bundle_setting_changes (
  id               uuid        PRIMARY KEY,
  tenant_id        uuid        NOT NULL REFERENCES tenants (id),
  sequence          integer     NOT NULL CHECK (sequence >= 1),
  staleness_hours   integer     CHECK (staleness_hours IS NULL OR (staleness_hours >= 1 AND staleness_hours <= 720)),
  frozen            boolean,
  changed_by        uuid        NOT NULL,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_setting_changes_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT bundle_setting_changes_one_value CHECK (
    (staleness_hours IS NULL) <> (frozen IS NULL)
  ),
  CONSTRAINT bundle_setting_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE bundle_setting_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_setting_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON bundle_setting_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON bundle_setting_changes TO dh_registry_app;