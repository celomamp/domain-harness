-- 0014_accepted_deviation_alerts: the Buyer's recurring alerts (Story 5.6).
--
-- accepted_deviation_alerts: one row per raised interval boundary of an
-- accepted deviation, append-only. A boundary is due_at = starts_at + k *
-- alert_interval_hours (k >= 1) while the acceptance is live
-- (starts_at <= now < ends_at); the UNIQUE (tenant_id, acceptance_id, due_at)
-- key makes raising idempotent and catch-up exact. The scheduler runs outside
-- any tenant context, so the cross-tenant candidate read is the established
-- narrow exception pattern of 0002: a NOLOGIN role owning one SECURITY
-- DEFINER function that returns only tenant ids of tenants holding live
-- acceptances, and column-limited SELECT behind its own policy.
--
-- accepted_deviation_alert_dismissals: one row per Buyer dismissal,
-- append-only and idempotent (UNIQUE (tenant_id, alert_id), inserts use ON
-- CONFLICT DO NOTHING). Neither table is ever updated, deleted or pruned.
-- The runtime role may SELECT and INSERT only; no UPDATE, no DELETE.

-- Composite target for the (tenant_id, acceptance_id) foreign key below, as
-- 0002 did for accounts and 0009 for applications. An ADD CONSTRAINT only;
-- no column changes and no existing constraint is touched.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accepted_deviation_records_tenant_id_id_key'
      AND conrelid = 'accepted_deviation_records'::regclass
  ) THEN
    ALTER TABLE accepted_deviation_records
      ADD CONSTRAINT accepted_deviation_records_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

CREATE TABLE accepted_deviation_alerts (
  id            uuid        PRIMARY KEY,
  tenant_id     uuid        NOT NULL REFERENCES tenants (id),
  acceptance_id uuid        NOT NULL,
  due_at        timestamptz NOT NULL,
  raised_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accepted_deviation_alerts_boundary_key UNIQUE (tenant_id, acceptance_id, due_at),
  CONSTRAINT accepted_deviation_alerts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT accepted_deviation_alerts_acceptance_fkey FOREIGN KEY (tenant_id, acceptance_id) REFERENCES accepted_deviation_records (tenant_id, id)
);

CREATE TABLE accepted_deviation_alert_dismissals (
  id           uuid        PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES tenants (id),
  alert_id     uuid        NOT NULL,
  dismissed_by uuid        NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accepted_deviation_alert_dismissals_alert_key UNIQUE (tenant_id, alert_id),
  CONSTRAINT accepted_deviation_alert_dismissals_alert_fkey FOREIGN KEY (tenant_id, alert_id) REFERENCES accepted_deviation_alerts (tenant_id, id),
  CONSTRAINT accepted_deviation_alert_dismissals_dismissed_by_fkey FOREIGN KEY (tenant_id, dismissed_by) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE accepted_deviation_alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE accepted_deviation_alerts           FORCE  ROW LEVEL SECURITY;
ALTER TABLE accepted_deviation_alert_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE accepted_deviation_alert_dismissals FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON accepted_deviation_alerts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON accepted_deviation_alert_dismissals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON accepted_deviation_alerts, accepted_deviation_alert_dismissals TO dh_registry_app;

-- The alert scheduler role owns the SECURITY DEFINER function below and
-- nothing else. It can read the acceptance windows across tenants and only
-- through this function's own three columns; no login role may be a member
-- of it (assertRuntimeRoleSafe refuses anything that would bypass its own
-- tenants, and the scheduler role is never a runtime role).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dh_alert_scheduler') THEN
    CREATE ROLE dh_alert_scheduler NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- Same rule as dh_registry_app in 0001: a pre-existing role must not be able
-- to log in or bypass anything; it is altered only when wrong.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'dh_alert_scheduler'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
  ) THEN
    ALTER ROLE dh_alert_scheduler NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Handing the function to dh_alert_scheduler (ALTER FUNCTION ... OWNER TO)
-- needs the migrator to be able to SET ROLE to it, as in 0002.
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND NOT pg_has_role(current_user, 'dh_alert_scheduler', 'SET') THEN
    EXECUTE format('GRANT dh_alert_scheduler TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
END
$$;

-- The cross-tenant live-acceptance read: dh_alert_scheduler sees every
-- acceptance row, but only three columns, and only through this function.
GRANT USAGE ON SCHEMA public TO dh_alert_scheduler;
GRANT SELECT (tenant_id, starts_at, ends_at) ON accepted_deviation_records TO dh_alert_scheduler;
CREATE POLICY alert_scheduler ON accepted_deviation_records FOR SELECT TO dh_alert_scheduler USING (true);

-- Returns one row per tenant holding a live acceptance at `p_now`. Never any
-- acceptance text, id or window: the callers re-enter tenant scope for the
-- data itself.
CREATE FUNCTION live_accepted_deviation_alert_tenants(p_now timestamptz)
  RETURNS TABLE (tenant_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT r.tenant_id
  FROM public.accepted_deviation_records r
  WHERE r.starts_at <= p_now AND r.ends_at > p_now
  ORDER BY 1
$$;

-- Managed Postgres (e.g. Supabase) runs the migrator without superuser: OWNER
-- TO also needs CREATE on the schema for the new owner, so grant it
-- transiently and revoke right after. Steady state keeps USAGE-only, as
-- designed above.
GRANT CREATE ON SCHEMA public TO dh_alert_scheduler;
ALTER FUNCTION live_accepted_deviation_alert_tenants(timestamptz) OWNER TO dh_alert_scheduler;
REVOKE CREATE ON SCHEMA public FROM dh_alert_scheduler;
REVOKE ALL ON FUNCTION live_accepted_deviation_alert_tenants(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION live_accepted_deviation_alert_tenants(timestamptz) TO dh_registry_app;
