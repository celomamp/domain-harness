import { desc, eq, max } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import {
  canonicalJson,
  ROLE_DENIED,
  SESSION_INVALID,
  type SessionInfo,
  type SignedStandardBundle,
  type UuidV7,
} from "@domain-harness/contract";
import { validateBundleInput } from "@domain-harness/core";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { bundleRecords, bundleSettingChanges, tenantServiceCredentials } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { hashToken, parseToken } from "../sign-in/tokens.ts";
import { lockBundle } from "../standards/service.ts";
import { compileBundle, currentFrozen, currentStalenessHours } from "./compile.ts";
import { bundleHash } from "./sign.ts";
import type { Signer } from "./sign.ts";

/** Throw `role_denied` unless the session is the Buyer's. */
export function assertBundleSettingsBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "only the Buyer can change bundle settings; nothing was changed",
      subject: "role",
    });
  }
}

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was changed`, subject });

export function validateStalenessBody(body: unknown): number {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with stalenessHours");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== "stalenessHours");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const raw = fields["stalenessHours"];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 720) {
    throw invalid("stalenessHours", "stalenessHours must be an integer from 1 to 720");
  }
  return raw;
}

export function validateFreezeBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with frozen");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== "frozen");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const raw = fields["frozen"];
  if (typeof raw !== "boolean") {
    throw invalid("frozen", "frozen must be true or false");
  }
  return raw;
}

function nextSequenceForBundleRecords(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  return tx
    .select({ sequence: max(bundleRecords.sequence) })
    .from(bundleRecords)
    .where(eq(bundleRecords.tenantId, tenantId))
    .then((rows) => (rows[0]?.sequence ?? 0) + 1);
}

function nextSequenceForSettings(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  return tx
    .select({ sequence: max(bundleSettingChanges.sequence) })
    .from(bundleSettingChanges)
    .where(eq(bundleSettingChanges.tenantId, tenantId))
    .then((rows) => (rows[0]?.sequence ?? 0) + 1);
}

export interface BundleService {
  buildAndSign(tenantId: UuidV7): Promise<{ hash: string; sequence: number }>;
  setStaleness(session: SessionInfo, body: unknown): Promise<{ stalenessHours: number }>;
  setFreeze(session: SessionInfo, body: unknown): Promise<{ frozen: boolean }>;
  latestFor(tenantId: UuidV7): Promise<SignedStandardBundle | undefined>;
  authenticateCredential(bearer: string): Promise<UuidV7>;
}

const credentialInvalid = (): EnvelopeError =>
  new EnvelopeError({
    code: SESSION_INVALID,
    message: "the service credential is not valid",
    subject: "session",
  });

export function createBundleService(db: RegistryDb, signer: Signer): BundleService {
  return {
    buildAndSign: async (tenantId) => {
      return withTenant(db, tenantId, async (tx) => {
        await lockBundle(tx, tenantId);
        const sequence = await nextSequenceForBundleRecords(tx, tenantId);
        const compiled = await compileBundle(tx, tenantId, sequence, signer.keyId);
        const verdict = validateBundleInput(compiled.input);
        if (!verdict.ok) {
          throw new EnvelopeError(verdict.error);
        }
        const signature = signer.sign(Buffer.from(canonicalJson(compiled.payload), "utf8"));
        const signed: SignedStandardBundle = {
          payload: compiled.payload,
          keyId: signer.keyId,
          signature,
        };
        const hash = bundleHash(signed);
        await tx.insert(bundleRecords).values({
          id: mintUuidV7(),
          tenantId,
          sequence,
          hash,
          keyId: signer.keyId,
          payload: signed.payload,
          signature: signed.signature,
          issuedAt: new Date(signed.payload.issuedAt),
        });
        return { hash, sequence };
      });
    },
    setStaleness: async (session, body) => {
      assertBundleSettingsBuyer(session);
      const value = validateStalenessBody(body);
      const { tenantId } = session;
      await withTenant(db, tenantId, async (tx) => {
        await lockBundle(tx, tenantId);
        if ((await currentStalenessHours(tx, tenantId)) === value) return;
        await tx.insert(bundleSettingChanges).values({
          id: mintUuidV7(),
          tenantId,
          sequence: await nextSequenceForSettings(tx, tenantId),
          stalenessHours: value,
          frozen: null,
          changedBy: session.accountId,
        });
      });
      return { stalenessHours: value };
    },
    setFreeze: async (session, body) => {
      assertBundleSettingsBuyer(session);
      const value = validateFreezeBody(body);
      const { tenantId } = session;
      await withTenant(db, tenantId, async (tx) => {
        await lockBundle(tx, tenantId);
        if ((await currentFrozen(tx, tenantId)) === value) return;
        await tx.insert(bundleSettingChanges).values({
          id: mintUuidV7(),
          tenantId,
          sequence: await nextSequenceForSettings(tx, tenantId),
          stalenessHours: null,
          frozen: value,
          changedBy: session.accountId,
        });
      });
      return { frozen: value };
    },
    latestFor: async (tenantId) => {
      const rows = await withTenant(db, tenantId, async (tx) => {
        return tx
          .select()
          .from(bundleRecords)
          .where(eq(bundleRecords.tenantId, tenantId))
          .orderBy(desc(bundleRecords.sequence))
          .limit(1);
      });
      const row = rows[0];
      if (row === undefined) return undefined;
      return {
        payload: row.payload as SignedStandardBundle["payload"],
        keyId: row.keyId,
        signature: row.signature,
      };
    },
    authenticateCredential: async (bearer) => {
      const parsed = parseToken(bearer);
      if (parsed === undefined) throw credentialInvalid();
      const { tenantId } = parsed;
      const computedHex = hashToken(parsed.token);
      const rows = await withTenant(db, tenantId, async (tx) => {
        return tx
          .select({ tokenHash: tenantServiceCredentials.tokenHash })
          .from(tenantServiceCredentials)
          .where(eq(tenantServiceCredentials.tenantId, tenantId));
      });
      const computed = Buffer.from(computedHex, "hex");
      let matched = false;
      for (const row of rows) {
        const stored = Buffer.from(row.tokenHash, "hex");
        if (stored.length === computed.length && timingSafeEqual(stored, computed)) {
          matched = true;
        }
      }
      if (!matched) throw credentialInvalid();
      return tenantId;
    },
  };
}
