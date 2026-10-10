import { describe, expect, it } from "vitest";
import type { UuidV7 } from "@domain-harness/contract";
import { mintUuidV7 } from "../ids.ts";
import { getRootProject, getTenant, listAccounts } from "../tenancy/queries.ts";
import type { RegistryDb } from "./client.ts";
import { assertTenantId, withTenant } from "./tenant-scope.ts";

/** A database handle that fails the test if anything touches it. */
function untouchableDb(): { db: RegistryDb; calls: () => number } {
  let calls = 0;
  const db = new Proxy(
    {},
    {
      get() {
        calls += 1;
        throw new Error("the database was touched");
      },
    },
  ) as RegistryDb;
  return { db, calls: () => calls };
}

const V4 = "3f2b8c1e-9d4a-4b6e-8f7a-1c2d3e4f5a6b";
const missing: [string, unknown][] = [
  ["undefined", undefined],
  ["an empty string", ""],
  ["a UUIDv4", V4],
  ["an uppercase UUIDv7", mintUuidV7().toUpperCase()],
  ["null", null],
];

const tenantRequired = { code: "tenant_required", subject: "tenantId" };

describe("assertTenantId", () => {
  it.each(missing)("throws tenant_required for %s", (_label, value) => {
    expect(() => {
      assertTenantId(value);
    }).toThrow(expect.objectContaining(tenantRequired));
  });

  it("accepts a canonical UUIDv7", () => {
    expect(() => {
      assertTenantId(mintUuidV7());
    }).not.toThrow();
  });
});

describe("tenant-scoped data access without a tenant id", () => {
  const functions: [string, (db: RegistryDb, tenantId: UuidV7) => Promise<unknown>][] = [
    ["withTenant", (db, tenantId) => withTenant(db, tenantId, () => Promise.resolve(1))],
    ["getTenant", getTenant],
    ["listAccounts", listAccounts],
    ["getRootProject", getRootProject],
  ];

  for (const [name, fn] of functions) {
    it.each(missing)(`${name} throws tenant_required for %s and issues no query`, async (_label, value) => {
      const { db, calls } = untouchableDb();
      await expect(fn(db, value as UuidV7)).rejects.toMatchObject(tenantRequired);
      expect(calls()).toBe(0);
    });
  }

  it("the thrown error carries exactly the envelope fields", async () => {
    const { db } = untouchableDb();
    const error: unknown = await listAccounts(db, undefined as unknown as UuidV7).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "tenant_required", subject: "tenantId", message: expect.any(String) as string });
  });
});
