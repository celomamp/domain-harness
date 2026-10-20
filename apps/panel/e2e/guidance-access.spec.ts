import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures.ts";

async function openGuidanceAccess(page: Page) {
  await page.getByRole("navigation", { name: "Management panel" }).getByRole("link", { name: "Guidance access" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Guidance access" })).toBeVisible();
}

test("the Buyer grants Guidance reading, sets retention, and a granted role mints a read token", async ({
  page,
  browser,
  company,
}) => {
  await signIn(page, company.buyer);
  await openGuidanceAccess(page);
  await expect(page.getByRole("heading", { name: "No Guidance access grant is configured." })).toBeVisible();

  // Changes show a save bar; Discard puts the saved state back.
  const builder = page.getByRole("checkbox", { name: "Builder" });
  await builder.check();
  const saveBar = page.getByRole("group", { name: "Unsaved Guidance access changes" });
  await expect(saveBar).toBeVisible();
  await saveBar.getByRole("button", { name: "Discard" }).click();
  await expect(saveBar).toBeHidden();
  await expect(builder).not.toBeChecked();

  await page.getByRole("checkbox", { name: "Standard owner" }).check();
  await page.getByLabel("Keep Guidance events for (days)").fill("30");
  await saveBar.getByRole("button", { name: "Save Guidance access" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved the Guidance access." })).toBeVisible();
  await expect(saveBar).toBeHidden();
  await expect(page.getByText("Currently keeping Guidance events for 30 days.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Standard owner" })).toBeChecked();

  // The saved grant survives a reload.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Standard owner" })).toBeChecked();

  // The Buyer always reads; the token is shown once with its expiry.
  await page.getByRole("button", { name: "Mint a read token for my role" }).click();
  await expect(page.getByRole("group", { name: "One-time read token" })).not.toBeEmpty();
  await expect(page.getByText(/^Expires /)).toBeVisible();

  // The Standard owner now holds the grant; the Builder does not.
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, company.owner);
  await openGuidanceAccess(owner);
  await owner.getByRole("button", { name: "Mint a read token for my role" }).click();
  await expect(owner.getByRole("group", { name: "One-time read token" })).not.toBeEmpty();

  const other = await (await browser.newContext()).newPage();
  await signIn(other, company.builder);
  await openGuidanceAccess(other);
  await other.getByRole("button", { name: "Mint a read token for my role" }).click();
  await expect(other.getByText("Your role holds no grant to read Guidance events, so no token was minted.")).toBeVisible();
});
