-- 0011_application_agent_tool: the agent tool of an Application's latest
-- successful Boilerplate generation (Story 3.4).
--
-- application_agent_tool_changes: every change of an Application's agent tool
-- is one row, append-only. The current tool of an Application is its
-- highest-sequence row; an Application with no row has no agent tool yet
-- (`agentTool: null`). `sequence` is per (tenant, Application), computed as
-- max + 1 under the tenant's standards:<root id> advisory lock (the bundle
-- lock), the same pattern as guidance_endpoint_changes (0010). A generation
-- of the Application's current tool writes nothing. `agent_tool` is one of the
-- Boilerplate targets. The runtime role may only SELECT and INSERT: no UPDATE,
-- no DELETE.

CREATE TABLE application_agent_tool_changes (
  id             uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL REFERENCES tenants (id),
  application_id uuid        NOT NULL,
  sequence       integer     NOT NULL CHECK (sequence >= 1),
  agent_tool     text        NOT NULL CHECK (agent_tool IN ('claude-code', 'cursor')),
  changed_by     uuid        NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_agent_tool_changes_tenant_id_application_id_sequence_key UNIQUE (tenant_id, application_id, sequence),
  CONSTRAINT application_agent_tool_changes_application_fkey FOREIGN KEY (tenant_id, application_id) REFERENCES applications (tenant_id, id),
  CONSTRAINT application_agent_tool_changes_changed_by_fkey FOREIGN KEY (tenant_id, changed_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE application_agent_tool_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_agent_tool_changes FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON application_agent_tool_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON application_agent_tool_changes TO dh_registry_app;
