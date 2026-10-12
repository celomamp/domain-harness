// Database suite for magic-link sign-in: runs against a real PostgreSQL 18
// named by REGISTRY_TEST_DATABASE_URL (an admin connection). Like the tenancy
// suite it creates a throwaway database, migrates it as the admin (owner) and
// runs every data-access call as dh_registry_app (`-c role=dh_registry_app`).
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSessionCreated } from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { assertRuntimeRoleSafe } from "../db/tenant-scope.ts";
import { createRegistryServer } from "../http/server.ts";
import { createModuleService } from "../modules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { consumeSignInLink, createSignInService, getSession, requestSignInLinks } from "./service.ts";
import { hashToken, mintToken } from "./tokens.ts";
import { createProjectService } from "../projects/service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const LOOKUP_ROLE = "dh_sign_in_lookup";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL_URL = "http://panel.test";
const config = { panelUrl: PANEL_URL };
const JSON_HEADERS = { "content-type": "application/json" };
const run = promisify(execFile);
const REGISTRY_ROOT = resolve(import.meta.dirname, "../..");

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("sign-in database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`sign-in.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

/** The token inside the link of an emailed sign-in message. */
function tokenFrom(text: string): string {
  const match = /\/sign-in\/verify\?token=(\S+)/.exec(text);
  if (match?.[1] === undefined) throw new Error("no link in the message");
  return decodeURIComponent(match[1]);
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("sign-in against PostgreSQL", () => {
  const database = `dh_registry_signin_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let tenantA: UuidV7;
  let tenantB: UuidV7;

  async function linkCount(): Promise<number> {
    const { rows } = await owner.query<{ n: number }>("select count(*)::int as n from sign_in_links");
    return rows[0]?.n ?? -1;
  }

  /** Request a link for `email` and return the tokens mailed, one per account. */
  async function mailedTokens(email: string): Promise<string[]> {
    const mail = new MemoryTransport();
    await requestSignInLinks(db, mail, config, email);
    return mail.messages.map((m) => tokenFrom(m.text));
  }

  async function oneToken(email: string): Promise<string> {
    const [token] = await mailedTokens(email);
    if (token === undefined) throw new Error("no link was mailed");
    return token;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);
    owner = new pg.Client({ connectionString: withDatabase(adminUrl ?? "", database) });
    await owner.connect();
    await admin.query("select pg_advisory_lock($1)", [MIGRATION_SUITE_LOCK]);
    try {
      await migrate(owner);
    } finally {
      await admin.query("select pg_advisory_unlock($1)", [MIGRATION_SUITE_LOCK]);
    }
    appPool = new pg.Pool({ connectionString: withDatabase(adminUrl ?? "", database, APP_ROLE), max: 6 });
    db = createRegistryDb(appPool);

    tenantA = (
      await provisionCompany(db, {
        company: "Acme",
        accounts: [
          { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
          { name: "Sam Owner", email: "sam@acme.io", role: "Standard owner" },
          { name: "Shared", email: "shared@both.io", role: "Builder" },
        ],
      })
    ).tenantId;
    tenantB = (
      await provisionCompany(db, {
        company: "Bolt",
        accounts: [
          { name: "Bo Buyer", email: "bo@bolt.io", role: "Buyer" },
          { name: "Shared", email: "shared@both.io", role: "Standard owner" },
        ],
      })
    ).tenantId;
  }, 60_000);

  afterAll(async () => {
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0002", () => {
    it("enables and forces RLS on sign_in_links and sessions", async () => {
      const { rows } = await owner.query<{ relname: string; rls: boolean; forced: boolean }>(
        `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in ('sign_in_links', 'sessions') order by 1`,
      );
      expect(rows).toEqual([
        { relname: "sessions", rls: true, forced: true },
        { relname: "sign_in_links", rls: true, forced: true },
      ]);
    });

    it("lets the app role update only consumed_at on sign_in_links", async () => {
      const { rows } = await owner.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.column_privileges
         where grantee = $1 and privilege_type = 'UPDATE' order by 1, 2`,
        [APP_ROLE],
      );
      expect(rows).toEqual([{ table_name: "sign_in_links", column_name: "consumed_at" }]);
    });

    it("makes dh_sign_in_lookup a NOLOGIN role that sees only id, tenant_id and email of accounts", async () => {
      const role = await owner.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
        "select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = $1",
        [LOOKUP_ROLE],
      );
      expect(role.rows).toEqual([{ rolcanlogin: false, rolsuper: false, rolbypassrls: false }]);
      const columns = await owner.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
         where grantee = $1 and table_name = 'accounts' and privilege_type = 'SELECT' order by 1`,
        [LOOKUP_ROLE],
      );
      expect(columns.rows.map((r) => r.column_name)).toEqual(["email", "id", "tenant_id"]);
      const tables = await owner.query("select 1 from information_schema.role_table_grants where grantee = $1", [
        LOOKUP_ROLE,
      ]);
      expect(tables.rowCount).toBe(0);
    });

    it("gives EXECUTE on the lookup function to dh_registry_app only, owned by dh_sign_in_lookup, SECURITY DEFINER", async () => {
      const { rows } = await owner.query<{ owner: string; definer: boolean; acl: string[] }>(
        `select pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer, p.proacl::text[] as acl
         from pg_proc p where p.proname = 'sign_in_account_lookup'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.owner).toBe(LOOKUP_ROLE);
      expect(rows[0]?.definer).toBe(true);
      const grantees = (rows[0]?.acl ?? []).map((entry) => entry.split("=")[0]).sort();
      expect(grantees).toEqual([APP_ROLE, LOOKUP_ROLE]);
    });

    it("returns only (tenant_id, account_id) and still shows the app role no account outside a tenant context", async () => {
      const { rows, fields } = await appPool.query("select * from sign_in_account_lookup($1)", [" Shared@Both.io "]);
      expect(fields.map((f) => f.name)).toEqual(["tenant_id", "account_id"]);
      expect(rows.map((r: { tenant_id: string }) => r.tenant_id).sort()).toEqual([tenantA, tenantB].sort());
      const direct = await appPool.query("select count(*)::int as n from accounts");
      expect(direct.rows).toEqual([{ n: 0 }]);
    });
  });

  describe("requesting a link", () => {
    it("mails exactly one link to a provisioned address, storing only its hash", async () => {
      const before = await linkCount();
      const mail = new MemoryTransport();
      const report = await requestSignInLinks(db, mail, config, " Bea@Acme.io ");

      expect(report).toEqual({ links: 1, sent: 1, failed: 0 });
      expect(mail.messages).toHaveLength(1);
      const [message] = mail.messages;
      expect(message?.to).toBe("bea@acme.io");
      expect(message?.subject).toBe("Your Domain Harness sign-in link");
      expect(message?.text).toContain("management panel for Acme");
      const token = tokenFrom(message?.text ?? "");
      expect(token.startsWith(`${tenantA}.`)).toBe(true);
      expect(message?.text).toContain(`${PANEL_URL}/sign-in/verify?token=`);

      expect(await linkCount()).toBe(before + 1);
      const { rows } = await owner.query<{ token_hash: string; ttl: number }>(
        `select token_hash, extract(epoch from expires_at - created_at)::int as ttl
         from sign_in_links order by id desc limit 1`,
      );
      expect(rows[0]?.token_hash).toBe(hashToken(token));
      expect(rows[0]?.ttl).toBe(15 * 60);
      const leaked = await owner.query("select 1 from sign_in_links where row_to_json(sign_in_links)::text like $1", [
        `%${token.slice(37)}%`,
      ]);
      expect(leaked.rowCount).toBe(0);
    });

    it("mails nothing and writes nothing for an unknown address", async () => {
      const before = await linkCount();
      const mail = new MemoryTransport();
      expect(await requestSignInLinks(db, mail, config, "nobody@else.io")).toEqual({ links: 0, sent: 0, failed: 0 });
      expect(mail.messages).toEqual([]);
      expect(await linkCount()).toBe(before);
    });

    it("mails one link per tenant for an address held in two tenants, each signing into its own tenant", async () => {
      const tokens = await mailedTokens("shared@both.io");
      expect(tokens).toHaveLength(2);
      const sessions = await Promise.all(tokens.map((token) => consumeSignInLink(db, token)));
      expect(sessions.map((s) => s.session.tenantId).sort()).toEqual([tenantA, tenantB].sort());
      const roles = Object.fromEntries(sessions.map((s) => [s.session.tenantId, s.session.role]));
      expect(roles).toEqual({ [tenantA]: "Builder", [tenantB]: "Standard owner" });
    });

    it("counts a failed send without throwing", async () => {
      const failing = { send: () => Promise.reject(new Error("smtp down for bea@acme.io")) };
      expect(await requestSignInLinks(db, failing, config, "bea@acme.io")).toEqual({ links: 1, sent: 0, failed: 1 });
    });
  });

  describe("consuming a link", () => {
    it("opens a 12-hour session with the account's role for an unused, unexpired link", async () => {
      const created = await consumeSignInLink(db, await oneToken("sam@acme.io"));
      expect(isSessionCreated(created)).toBe(true);
      expect(created.session).toMatchObject({ tenantId: tenantA, role: "Standard owner" });
      const hours = (Date.parse(created.expiresAt) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(11.9);
      expect(hours).toBeLessThanOrEqual(12);
      expect(await getSession(db, created.sessionToken)).toEqual(created.session);

      const { rows } = await owner.query<{ token_hash: string }>("select token_hash from sessions order by id desc limit 1");
      expect(rows[0]?.token_hash).toBe(hashToken(created.sessionToken));
    });

    it("refuses a link the second time", async () => {
      const token = await oneToken("bea@acme.io");
      await consumeSignInLink(db, token);
      await expect(consumeSignInLink(db, token)).rejects.toMatchObject({ code: "sign_in_link_invalid" });
    });

    it("lets exactly one of two concurrent consumers through", async () => {
      const token = await oneToken("bea@acme.io");
      const results = await Promise.allSettled([consumeSignInLink(db, token), consumeSignInLink(db, token)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected?.reason).toMatchObject({ code: "sign_in_link_invalid" });
    });

    it("refuses an expired link and opens no session", async () => {
      const token = await oneToken("bea@acme.io");
      await owner.query("update sign_in_links set expires_at = now() - interval '1 second' where token_hash = $1", [
        hashToken(token),
      ]);
      const before = await owner.query<{ n: number }>("select count(*)::int as n from sessions");
      await expect(consumeSignInLink(db, token)).rejects.toMatchObject({ code: "sign_in_link_invalid" });
      const after = await owner.query<{ n: number }>("select count(*)::int as n from sessions");
      expect(after.rows).toEqual(before.rows);
    });

    it("refuses a valid tenant with an unknown secret", async () => {
      await expect(consumeSignInLink(db, mintToken(tenantA))).rejects.toMatchObject({ code: "sign_in_link_invalid" });
    });

    it("refuses tenant A's id with tenant B's secret, and leaves B's link usable", async () => {
      const tokenB = await oneToken("bo@bolt.io");
      const crossed = `${tenantA}${tokenB.slice(36)}`;
      await expect(consumeSignInLink(db, crossed)).rejects.toMatchObject({ code: "sign_in_link_invalid" });
      expect((await consumeSignInLink(db, tokenB)).session.tenantId).toBe(tenantB);
    });
  });

  describe("sessions", () => {
    it("refuses an expired session", async () => {
      const created = await consumeSignInLink(db, await oneToken("bea@acme.io"));
      await owner.query("update sessions set expires_at = now() - interval '1 second' where token_hash = $1", [
        hashToken(created.sessionToken),
      ]);
      await expect(getSession(db, created.sessionToken)).rejects.toMatchObject({ code: "session_invalid" });
    });

    it("refuses tenant A's id with tenant B's session secret, and an unknown secret", async () => {
      const created = await consumeSignInLink(db, await oneToken("bo@bolt.io"));
      await expect(getSession(db, `${tenantA}${created.sessionToken.slice(36)}`)).rejects.toMatchObject({
        code: "session_invalid",
      });
      await expect(getSession(db, mintToken(tenantB))).rejects.toMatchObject({ code: "session_invalid" });
      expect((await getSession(db, created.sessionToken)).tenantId).toBe(tenantB);
    });
  });

  describe("runtime role", () => {
    const member = `dh_test_lookup_member_${randomBytes(4).toString("hex")}`;

    beforeAll(async () => {
      await admin.query(`create role ${member} nologin nosuperuser nobypassrls in role ${APP_ROLE}, ${LOOKUP_ROLE}`);
    });

    afterAll(async () => {
      await admin.query(`drop role if exists ${member}`);
    });

    it("refuses a role that is a member of dh_sign_in_lookup", async () => {
      const pool = new pg.Pool({ connectionString: withDatabase(adminUrl ?? "", database, member), max: 1 });
      try {
        await expect(assertRuntimeRoleSafe(createRegistryDb(pool))).rejects.toMatchObject({
          code: "unsafe_database_role",
          message: expect.stringContaining("dh_sign_in_lookup") as string,
        });
      } finally {
        await pool.end();
      }
    });

    it("still accepts dh_registry_app", async () => {
      await expect(assertRuntimeRoleSafe(db)).resolves.toBeUndefined();
    });
  });

  describe("serve command", () => {
    async function serve(env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
      try {
        const { stdout, stderr } = await run(
          process.execPath,
          ["--conditions=@domain-harness/source", "src/http/serve-cli.ts"],
          {
            cwd: REGISTRY_ROOT,
            timeout: 20_000,
            env: {
              ...process.env,
              REGISTRY_PANEL_URL: "http://panel.test",
              REGISTRY_MAIL_OUTBOX_DIR: join(tmpdir(), "dh-serve-outbox"),
              REGISTRY_HTTP_PORT: "0",
              ...env,
            },
          },
        );
        return { code: 0, stdout, stderr };
      } catch (error) {
        const failed = error as { code: number; stdout: string; stderr: string };
        return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
      }
    }

    it("refuses to start as a superuser / table-owner role: exit 1, unsafe_database_role", async () => {
      const result = await serve({ REGISTRY_DATABASE_URL: withDatabase(adminUrl ?? "", database) });
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ code: "unsafe_database_role" });
    });

    it("refuses a non-http(s) REGISTRY_PANEL_URL: exit 1, invalid_configuration", async () => {
      const result = await serve({
        REGISTRY_DATABASE_URL: withDatabase(adminUrl ?? "", database, APP_ROLE),
        REGISTRY_PANEL_URL: "ftp://x",
      });
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ code: "invalid_configuration", subject: "REGISTRY_PANEL_URL" });
    });
  });

  describe("over HTTP", () => {
    it("answers a known and an unknown address identically, mails only the known one, and signs in", async () => {
      const mail = new MemoryTransport();
      const server = createRegistryServer(
        {
          signIn: createSignInService(db, mail, config),
          modules: createModuleService(db),
          standards: createStandardService(db),
          projects: createProjectService(db),
        },
        () => undefined,
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      try {
        const ask = (email: string) =>
          fetch(`${base}/v1/sign-in-links`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email }) });
        const known = await ask("bea@acme.io");
        const unknown = await ask("nobody@else.io");
        expect([known.status, await known.text()]).toEqual([202, "{}"]);
        expect([unknown.status, await unknown.text()]).toEqual([202, "{}"]);
        await expect.poll(() => mail.messages.length).toBe(1);
        expect(mail.messages[0]?.to).toBe("bea@acme.io");

        const token = tokenFrom(mail.messages[0]?.text ?? "");
        const consume = () => fetch(`${base}/v1/sessions`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token }) });
        const first = await consume();
        expect(first.status).toBe(201);
        const created: unknown = await first.json();
        if (!isSessionCreated(created)) throw new Error("not a SessionCreated");

        const second = await consume();
        expect(second.status).toBe(401);
        expect(await second.json()).toMatchObject({ code: "sign_in_link_invalid" });

        const me = await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${created.sessionToken}` } });
        expect(me.status).toBe(200);
        expect(await me.json()).toEqual(created.session);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
