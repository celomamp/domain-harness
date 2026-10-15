-- 0015_compilation_catalog: the published Compilation catalog (Story 6.1).
--
-- compilation_catalog_reads: the Buyer's "I have read catalog X", one row per
-- tenant per catalog version, append-only. Recording version X never satisfies
-- the gate for version Y: ingestion always checks the current
-- COMPILATION_CATALOG_VERSION. Re-reading the same version inserts nothing
-- (UNIQUE (tenant_id, catalog_version), inserts use ON CONFLICT DO NOTHING).
-- The runtime role may SELECT and INSERT only; no UPDATE, no DELETE.
--
-- compilations: one accepted Compilation per row, append-only. The envelope
-- columns carry the idempotency and ordering keys; the full validated body is
-- the jsonb payload. UNIQUE (tenant_id, idempotency_key) makes resends safe
-- (inserts use ON CONFLICT DO NOTHING and answer the stored row);
-- UNIQUE (tenant_id, application_id, sequence) keeps the per-Application order
-- single. The runtime role may SELECT and INSERT only; no UPDATE, no DELETE.

CREATE TABLE compilation_catalog_reads (
  id              uuid        PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenants (id),
  catalog_version text        NOT NULL CHECK (catalog_version <> ''),
  read_by         uuid        NOT NULL,
  read_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compilation_catalog_reads_tenant_version_key UNIQUE (tenant_id, catalog_version),
  CONSTRAINT compilation_catalog_reads_read_by_fkey FOREIGN KEY (tenant_id, read_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE compilation_catalog_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE compilation_catalog_reads FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON compilation_catalog_reads
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON compilation_catalog_reads TO dh_registry_app;

CREATE TABLE compilations (
  id              uuid        PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenants (id),
  idempotency_key uuid        NOT NULL,
  application_id  uuid        NOT NULL,
  type_name       text        NOT NULL CHECK (type_name IN ('guidance', 'gate_run', 'deviation', 'binding_refusal', 'bundle_status', 'collector_health')),
  schema_version  text        NOT NULL CHECK (schema_version <> ''),
  catalog_version text        NOT NULL CHECK (catalog_version <> ''),
  agent_tool_name text        NOT NULL CHECK (agent_tool_name <> ''),
  occurred_at     timestamptz NOT NULL,
  sequence        integer     NOT NULL CHECK (sequence >= 1),
  payload         jsonb       NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compilations_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT compilations_tenant_application_sequence_key UNIQUE (tenant_id, application_id, sequence)
);

ALTER TABLE compilations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compilations FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON compilations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON compilations TO dh_registry_app;
