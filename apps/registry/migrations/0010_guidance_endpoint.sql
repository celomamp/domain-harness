-- 0010_guidance_endpoint: the Company Guidance endpoint URL (Story 3.3).
--
-- guidance_endpoint_changes: every change of the tenant's Company Guidance
-- endpoint URL is one row, append-only. The current URL is the tenant's
-- highest-sequence row; a tenant with no row has no endpoint. `sequence` is
-- per tenant, computed as max + 1 under the tenant's standards:<root id>
-- advisory lock (the bundle lock). The URL is validated by the registry
-- (HTTPS, no credentials, no fragment); the CHECK only bounds its length.
-- The runtime role may only SELECT and INSERT: no UPDATE, no DELETE.

CREATE TABLE guidance_endpoint_changes (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  sequence    integer     NOT NULL CHECK (sequence >= 1),
  url         text        NOT NULL CHECK (url <> '' AND char_length(url) <= 2048),
  changed_by  uuid        NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guidance_endpoint_changes_tenant_id_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT guidance_endpoint_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE guidance_endpoint_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE guidance_endpoint_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON guidance_endpoint_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON guidance_endpoint_changes TO dh_registry_app;
