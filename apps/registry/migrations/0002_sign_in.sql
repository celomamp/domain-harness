-- 0002_sign_in: magic-link sign-in. Single-use link tokens and sessions, both
-- tenant-scoped behind forced RLS, plus the one narrow cross-tenant exception:
-- looking up which accounts hold an email address.
--
-- Only the SHA-256 of a token is stored (64 lowercase hex characters). A token
-- is "<tenantId>.<secret>", so every link and session lookup runs in the
-- tenant context parsed from the token, like every other query.

-- The lookup role owns the SECURITY DEFINER function below and nothing else.
-- It can read accounts(id, tenant_id, email) across tenants and nothing more;
-- no login role may be a member of it (assertRuntimeRoleSafe refuses one).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dh_sign_in_lookup') THEN
    CREATE ROLE dh_sign_in_lookup NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- Same rule as dh_registry_app in 0001: a pre-existing role must not be able
-- to log in or bypass anything; it is altered only when wrong.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'dh_sign_in_lookup'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
  ) THEN
    ALTER ROLE dh_sign_in_lookup NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Handing the function to dh_sign_in_lookup (ALTER FUNCTION ... OWNER TO)
-- needs the migrator to be able to SET ROLE to it. A superuser can; a
-- CREATEROLE migrator that created the role holds ADMIN OPTION on it and
-- grants itself SET here. The migrator already owns every table, so this
-- widens nothing.
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND NOT pg_has_role(current_user, 'dh_sign_in_lookup', 'SET') THEN
    EXECUTE format('GRANT dh_sign_in_lookup TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
END
$$;

-- Composite target for the (tenant_id, account_id) foreign keys below, so a
-- link or session always belongs to an account of its own tenant.
ALTER TABLE accounts ADD CONSTRAINT accounts_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE sign_in_links (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  account_id  uuid        NOT NULL,
  token_hash  text        NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  CONSTRAINT sign_in_links_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sign_in_links_account_fkey FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id)
);

CREATE TABLE sessions (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  account_id  uuid        NOT NULL,
  token_hash  text        NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_account_fkey FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id)
);

ALTER TABLE sign_in_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE sign_in_links FORCE  ROW LEVEL SECURITY;
ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sign_in_links
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON sign_in_links, sessions TO dh_registry_app;
-- Consuming a link is the only update the runtime may make.
GRANT UPDATE (consumed_at) ON sign_in_links TO dh_registry_app;

-- The cross-tenant email lookup. dh_sign_in_lookup sees every account row,
-- but only three columns, and only through this function.
GRANT USAGE ON SCHEMA public TO dh_sign_in_lookup;
GRANT SELECT (id, tenant_id, email) ON accounts TO dh_sign_in_lookup;
CREATE POLICY sign_in_lookup ON accounts FOR SELECT TO dh_sign_in_lookup USING (true);

-- The lookup filters on email across tenants; (tenant_id, email) cannot serve it.
CREATE INDEX accounts_email_idx ON accounts (email);

-- Returns only (tenant_id, account_id) for a normalized email: never names,
-- roles or other emails.
CREATE FUNCTION sign_in_account_lookup(p_email text)
  RETURNS TABLE (tenant_id uuid, account_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT a.tenant_id, a.id
  FROM public.accounts a
  WHERE a.email = lower(btrim(p_email))
  ORDER BY a.tenant_id, a.id
$$;

-- Managed Postgres (e.g. Supabase) runs the migrator without superuser: OWNER
-- TO also needs CREATE on the schema for the new owner, so grant it
-- transiently and revoke right after. Steady state keeps USAGE-only, as
-- designed above.
GRANT CREATE ON SCHEMA public TO dh_sign_in_lookup;
ALTER FUNCTION sign_in_account_lookup(text) OWNER TO dh_sign_in_lookup;
REVOKE CREATE ON SCHEMA public FROM dh_sign_in_lookup;
REVOKE ALL ON FUNCTION sign_in_account_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sign_in_account_lookup(text) TO dh_registry_app;
