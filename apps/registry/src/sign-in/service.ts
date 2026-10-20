import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  isEmailAddress,
  isUuidV7,
  normalizeEmail,
  SESSION_INVALID,
  SESSION_TTL_HOURS,
  SIGN_IN_LINK_INVALID,
  SIGN_IN_LINK_TTL_MINUTES,
} from "@domain-harness/contract";
import type { SessionCreated, SessionInfo, UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb } from "../db/client.ts";
import { accounts, sessions, signInLinks, tenants } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { composeSignInMessage } from "../mail/transport.ts";
import type { MailMessage, MailTransport } from "../mail/transport.ts";
import { hashToken, mintToken, parseToken } from "./tokens.ts";

/** What sign-in needs beyond the database and the mail transport. */
export interface SignInConfig {
  /** Public base URL of the management panel; links point at `${panelUrl}/sign-in/verify`. */
  readonly panelUrl: string;
}

/** Counts only: never addresses, tokens or links. */
export interface SignInLinkReport {
  /** Links minted (one per account holding the address). */
  readonly links: number;
  readonly sent: number;
  readonly failed: number;
}

interface LookupRow extends Record<string, unknown> {
  tenant_id: string;
  account_id: string;
}

/**
 * Mint and send one single-use link per account that holds `email`, in each
 * account's own tenant. An unknown address mints nothing and sends nothing; the
 * caller (the HTTP API) has already answered identically either way.
 *
 * The cross-tenant lookup is the one query outside `withTenant`: it calls the
 * SECURITY DEFINER function `sign_in_account_lookup`, which returns only
 * `(tenant_id, account_id)`.
 */
export async function requestSignInLinks(
  db: RegistryDb,
  mailer: MailTransport,
  config: SignInConfig,
  email: string,
): Promise<SignInLinkReport> {
  if (!isEmailAddress(email)) {
    throw new EnvelopeError({ code: "invalid_input", message: "email must be an email address", subject: "email" });
  }
  const address = normalizeEmail(email);
  const holders = await lookupAccounts(db, address);

  const messages: MailMessage[] = [];
  for (const { tenantId, accountId } of holders) {
    const { token, companyName } = await mintSignInLink(db, tenantId, accountId);
    messages.push(composeSignInMessage({ to: address, companyName, panelUrl: config.panelUrl, token }));
  }

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      await mailer.send(message);
      sent += 1;
    } catch {
      // The transport's error can echo the address; only the count is kept.
      failed += 1;
    }
  }
  return { links: messages.length, sent, failed };
}

/** Store one single-use link for the account; returns its token and the Company name. */
async function mintSignInLink(
  db: RegistryDb,
  tenantId: UuidV7,
  accountId: UuidV7,
): Promise<{ token: string; companyName: string }> {
  const token = mintToken(tenantId);
  const companyName = await withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    await tx.insert(signInLinks).values({
      id: mintUuidV7(),
      tenantId,
      accountId,
      tokenHash: hashToken(token),
      expiresAt: sql`now() + make_interval(mins => ${SIGN_IN_LINK_TTL_MINUTES})`,
    });
    return tenant?.name ?? "";
  });
  return { token, companyName };
}

/** The `(tenant, account)` pairs holding `address`, through the SECURITY DEFINER lookup. */
export async function lookupAccounts(
  db: RegistryDb,
  address: string,
): Promise<{ tenantId: UuidV7; accountId: UuidV7 }[]> {
  const { rows } = await db.execute<LookupRow>(
    sql`select tenant_id::text as tenant_id, account_id::text as account_id from sign_in_account_lookup(${address})`,
  );
  const holders: { tenantId: UuidV7; accountId: UuidV7 }[] = [];
  for (const row of rows) {
    if (isUuidV7(row.tenant_id) && isUuidV7(row.account_id)) holders.push({ tenantId: row.tenant_id, accountId: row.account_id });
  }
  return holders;
}

/**
 * Demo sign-in only: open a session for one of the demo accounts (normalized
 * `demoEmails`) without emailing
 * a link. The link is minted and consumed at once through the same single-use
 * path as an emailed one. Any other address, or a demo address with no
 * account, is `sign_in_link_invalid`. The HTTP API serves this only when demo
 * sign-in is enabled.
 */
export async function openDemoSession(
  db: RegistryDb,
  demoEmails: readonly string[],
  email: string,
): Promise<SessionCreated> {
  const address = normalizeEmail(email);
  if (!demoEmails.includes(address)) throw linkInvalid();
  const [holder] = await lookupAccounts(db, address);
  if (holder === undefined) throw linkInvalid();
  const { token } = await mintSignInLink(db, holder.tenantId, holder.accountId);
  return consumeSignInLink(db, token);
}

const linkInvalid = (): EnvelopeError =>
  new EnvelopeError({
    code: SIGN_IN_LINK_INVALID,
    message: "the sign-in link is not valid: it may be used, expired or mistyped",
    subject: "token",
  });

const sessionInvalid = (): EnvelopeError =>
  new EnvelopeError({ code: SESSION_INVALID, message: "the session is not valid or has expired", subject: "session" });

/**
 * Consume a sign-in link and open a session, in one transaction in the link's
 * tenant. Single use is enforced in SQL: the `UPDATE ... WHERE consumed_at IS
 * NULL AND expires_at > now() RETURNING` lets exactly one of two concurrent
 * consumers through. Any failure throws `sign_in_link_invalid`; a malformed
 * token throws before any query.
 */
export async function consumeSignInLink(db: RegistryDb, token: unknown): Promise<SessionCreated> {
  const parsed = parseToken(token);
  if (parsed === undefined) throw linkInvalid();
  const { tenantId } = parsed;
  const sessionToken = mintToken(tenantId);

  const created = await withTenant(db, tenantId, async (tx) => {
    const [link] = await tx
      .update(signInLinks)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(signInLinks.tenantId, tenantId),
          eq(signInLinks.tokenHash, hashToken(parsed.token)),
          isNull(signInLinks.consumedAt),
          gt(signInLinks.expiresAt, sql`now()`),
        ),
      )
      .returning({ accountId: signInLinks.accountId });
    if (link === undefined) return undefined;

    const [account] = await tx
      .select({ id: accounts.id, role: accounts.role })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, link.accountId)));
    if (account === undefined || !isUuidV7(account.id)) return undefined;

    const [session] = await tx
      .insert(sessions)
      .values({
        id: mintUuidV7(),
        tenantId,
        accountId: account.id,
        tokenHash: hashToken(sessionToken),
        expiresAt: sql`now() + make_interval(hours => ${SESSION_TTL_HOURS})`,
      })
      .returning({ expiresAt: sessions.expiresAt });
    if (session === undefined) return undefined;
    return { accountId: account.id, role: account.role, expiresAt: session.expiresAt };
  });

  if (created === undefined) throw linkInvalid();
  return {
    sessionToken,
    expiresAt: created.expiresAt.toISOString(),
    session: { accountId: created.accountId, tenantId, role: created.role },
  };
}

/** The live session for `token`, or `session_invalid`. A malformed token throws before any query. */
export async function getSession(db: RegistryDb, token: unknown): Promise<SessionInfo> {
  const parsed = parseToken(token);
  if (parsed === undefined) throw sessionInvalid();
  const { tenantId } = parsed;
  const row = await withTenant(db, tenantId, async (tx) => {
    const [found] = await tx
      .select({ accountId: sessions.accountId, role: accounts.role })
      .from(sessions)
      .innerJoin(accounts, and(eq(accounts.tenantId, sessions.tenantId), eq(accounts.id, sessions.accountId)))
      .where(
        and(
          eq(sessions.tenantId, tenantId),
          eq(sessions.tokenHash, hashToken(parsed.token)),
          gt(sessions.expiresAt, sql`now()`),
        ),
      );
    return found;
  });
  if (row === undefined || !isUuidV7(row.accountId)) throw sessionInvalid();
  return { accountId: row.accountId, tenantId, role: row.role };
}

/** The three operations the HTTP API needs, bound to one database, transport and config. */
export interface SignInService {
  requestSignInLinks(email: string): Promise<SignInLinkReport>;
  createSession(token: string): Promise<SessionCreated>;
  getSession(token: string): Promise<SessionInfo>;
  /** Present only when demo sign-in is enabled (staging): a session for a demo account, no email. */
  openDemoSession?(email: string): Promise<SessionCreated>;
}

export function createSignInService(
  db: RegistryDb,
  mailer: MailTransport,
  config: SignInConfig & { readonly demoEmails?: readonly string[] },
): SignInService {
  const { demoEmails } = config;
  return {
    requestSignInLinks: (email) => requestSignInLinks(db, mailer, config, email),
    createSession: (token) => consumeSignInLink(db, token),
    getSession: (token) => getSession(db, token),
    ...(demoEmails === undefined ? {} : { openDemoSession: (email: string) => openDemoSession(db, demoEmails, email) }),
  };
}
