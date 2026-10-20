// Test helpers: provision a fresh Company per test through the operator CLI,
// and sign an account in through the emailed link the registry writes to the
// file outbox, exactly as a person would follow it.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";
import { OUTBOX_DIR, REGISTRY_DIR, databaseUrl } from "./stack.ts";

export type Role = "Buyer" | "Standard owner" | "Builder";

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

export interface Company {
  readonly name: string;
  readonly tenantId: string;
  readonly rootProjectId: string;
  readonly buyer: Account;
  readonly owner: Account;
  readonly builder: Account;
}

interface ProvisionOutput {
  readonly tenantId: string;
  readonly rootProjectId: string;
  readonly accounts: readonly { readonly id: string; readonly role: Role }[];
}

/** A new Company (plan Team) with one account per role and unique emails. */
export function provisionCompany(plan = "Team"): Company {
  const suffix = randomUUID().slice(0, 8);
  const name = `Acme ${suffix}`;
  const people = [
    { name: "Bea Buyer", email: `bea-${suffix}@acme.example`, role: "Buyer" as const },
    { name: "Sam Owner", email: `sam-${suffix}@acme.example`, role: "Standard owner" as const },
    { name: "Bo Builder", email: `bo-${suffix}@acme.example`, role: "Builder" as const },
  ];
  const dir = mkdtempSync(join(tmpdir(), "dh-e2e-company-"));
  const file = join(dir, "company.json");
  writeFileSync(file, JSON.stringify({ company: name, plan, accounts: people }));
  try {
    const run = spawnSync(
      process.execPath,
      ["--conditions=@domain-harness/source", join(REGISTRY_DIR, "src/operator/provision-cli.ts"), file],
      { cwd: REGISTRY_DIR, env: { ...process.env, REGISTRY_DATABASE_URL: databaseUrl("dh_registry_app") }, encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`provision failed: ${run.stderr}`);
    const output = JSON.parse(run.stdout) as ProvisionOutput;
    const [buyer, owner, builder] = people.map((person, index) => {
      const account = output.accounts[index];
      if (account?.role !== person.role) throw new Error("provision output does not match the input order");
      return { ...person, id: account.id };
    });
    if (buyer === undefined || owner === undefined || builder === undefined) throw new Error("missing accounts");
    return { name, tenantId: output.tenantId, rootProjectId: output.rootProjectId, buyer, owner, builder };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface OutboxMessage {
  readonly to: string;
  readonly text: string;
}

/** The newest sign-in link mailed to `email`, waiting for it to arrive. */
export async function signInLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        let files: string[];
        try {
          files = readdirSync(OUTBOX_DIR).sort();
        } catch {
          return undefined;
        }
        for (const file of files.reverse()) {
          let message: OutboxMessage;
          try {
            message = JSON.parse(readFileSync(join(OUTBOX_DIR, file), "utf8")) as OutboxMessage;
          } catch {
            continue; // still being written: the next poll reads it whole
          }
          if (message.to === email) {
            link = /https?:\/\/\S+/.exec(message.text)?.[0];
            return link;
          }
        }
        return undefined;
      },
      { message: `a sign-in mail to ${email}` },
    )
    .toBeDefined();
  return link ?? "";
}

/** Request a link on the sign-in page, follow it, and land on Inventory. */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await signInLink(account.email));
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();
  await streamed(page);
}

/**
 * Wait until a streamed server render has swapped every deferred section in:
 * until then React keeps each resolved section in a hidden container too, so
 * a text query could match it twice.
 */
export async function streamed(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('div[hidden][id^="S:"]').length === 0);
}

/** Every test gets its own Company, so tests never share state. */
export const test = base.extend<{ company: Company }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take a destructured first argument.
  company: async ({}, use) => {
    await use(provisionCompany());
  },
});

export { expect };
