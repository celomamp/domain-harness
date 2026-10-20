// UI flows shared by several specs: each drives the panel exactly as a person
// would and waits for the visible outcome before returning.
import type { Browser, Page } from "@playwright/test";
import { expect, signIn } from "./fixtures.ts";
import type { Account } from "./fixtures.ts";

/** A new browser context signed in as `account`. */
export async function signedIn(browser: Browser, account: Account): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, account);
  return page;
}

/** Create a Module from the Standards page (Buyer). */
export async function createModule(page: Page, name: string, kind: "code-stack" | "design-system"): Promise<void> {
  await page.goto("/standards");
  await page.getByRole("button", { name: "Create Module" }).click();
  const sheet = page.getByRole("dialog", { name: "Create a Module" });
  await sheet.getByLabel("Module name").fill(name);
  await sheet.getByLabel("Kind").selectOption(kind);
  await sheet.getByRole("button", { name: "Create" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `Module created: ${name}.` })).toBeVisible();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

/** Assign the Module's Standard owner from its row on the Standards page (Buyer). */
export async function assignOwner(page: Page, module: string, owner: Account): Promise<void> {
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: module }) });
  await row.getByRole("button", { name: "Assign owner" }).click();
  const sheet = page.getByRole("dialog", { name: "Standard owner" });
  await sheet.getByLabel(`Standard owner for ${module}`).selectOption({ label: owner.name });
  await sheet.getByRole("button", { name: "Assign Standard owner" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `Standard owner of ${module}: ${owner.name}.` })).toBeVisible();
  await expect(row.getByText(owner.name)).toBeVisible();
  await expect(row.getByRole("button", { name: "Change owner" })).toBeVisible();
}

export interface CodeStackEntry {
  readonly category: "language" | "framework" | "library";
  readonly name: string;
  readonly status: "approved" | "prohibited" | "required";
  readonly versionConstraint?: string;
}

/** Publish version 1 of a code-stack Standard (Standard owner); returns its id from the Published banner. */
export async function publishCodeStack(page: Page, module: string, entry: CodeStackEntry): Promise<string> {
  await page.goto("/standards");
  await page.getByRole("link", { name: module }).click();
  await expect(page.getByRole("heading", { level: 1, name: module })).toBeVisible();
  await page.getByRole("button", { name: "Publish standard" }).click();
  const sheet = page.getByRole("dialog", { name: "Publish a code-stack Standard" });
  await sheet.getByLabel("Category").selectOption(entry.category);
  await sheet.getByLabel("Name", { exact: true }).fill(entry.name);
  if (entry.versionConstraint !== undefined) {
    await sheet.getByLabel("Version constraint (optional)").fill(entry.versionConstraint);
  }
  await sheet.getByLabel("Status").selectOption(entry.status);
  await sheet.getByRole("button", { name: "Publish" }).click();
  await expect(sheet).toBeHidden();
  const id = page.locator(".published-facts__id");
  await expect(id).toBeVisible();
  const text = (await id.textContent()) ?? "";
  const standardId = /[0-9a-f-]{36}/.exec(text)?.[0];
  if (standardId === undefined) throw new Error(`no Standard id in "${text}"`);
  return standardId;
}

/** Place an Application on a Project from the New-application flow. */
export async function placeApplication(page: Page, description: string, project: string): Promise<void> {
  await page.goto("/new-application");
  const place = page.getByRole("tabpanel", { name: "Place an application" });
  await place.getByLabel("Description").fill(description);
  await place.getByLabel("Project").selectOption({ label: project });
  await place.getByRole("button", { name: "Place the Application" }).click();
  await expect(page.getByText(/^The Application is placed on /)).toBeVisible();
}
