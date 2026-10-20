import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures.ts";
import { assignOwner, createModule, publishCodeStack, signedIn } from "./flows.ts";

async function createProject(page: Page, name: string, levelName: string, parent: string) {
  await page.getByRole("button", { name: "Create project" }).click();
  const sheet = page.getByRole("dialog", { name: "Create project" });
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByLabel("Level name").fill(levelName);
  await sheet.getByLabel("Parent", { exact: true }).selectOption({ label: parent });
  await sheet.getByRole("button", { name: "Create Project" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("treeitem", { name: `${name}, level ${levelName}` })).toBeVisible();
}

test("the Buyer builds the Project tree and grants access on a Project", async ({ page, company }) => {
  await signIn(page, company.buyer);
  await page.getByRole("link", { name: "Project tree" }).click();
  await expect(page.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
  await expect(page.getByText("No Project yet beyond the root Project.")).toBeVisible();

  await createProject(page, "Payments", "Domain", `${company.name} (root Project)`);
  await expect(page.getByText("No Project yet beyond the root Project.")).toBeHidden();
  await createProject(page, "Checkout", "Team", "Payments (level Domain)");

  // Selecting a node opens its context and keeps it in the address.
  await page.getByRole("treeitem", { name: "Checkout, level Team" }).click();
  await expect(page).toHaveURL(/\?project=/);
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await expect(page.getByText("Parent: Payments")).toBeVisible();

  // A build grant lets the Builder place Applications here.
  await page.getByRole("tab", { name: "Build grants" }).click();
  const builds = page.getByRole("tabpanel", { name: "Build grants" });
  const builderRow = builds.getByRole("listitem").filter({ hasText: `${company.builder.name} (Builder)` });
  await expect(builderRow.getByText("Not granted")).toBeVisible();
  await builderRow.getByRole("button", { name: "Grant build" }).click();
  await expect(builderRow.getByText("Granted", { exact: true })).toBeVisible();
  await expect(builderRow.getByText(`granted by ${company.buyer.name}`, { exact: false })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Build grants" })).toHaveAttribute("aria-selected", "true");

  // The child-Project permission on the same Project.
  await page.getByRole("tab", { name: "Access" }).click();
  const access = page.getByRole("tabpanel", { name: "Access" });
  const ownerRow = access.getByRole("listitem").filter({ hasText: `${company.owner.name} (Standard owner)` });
  await ownerRow.getByRole("button", { name: "Grant permission" }).click();
  await expect(ownerRow.getByText("Granted", { exact: true })).toBeVisible();
  await ownerRow.getByRole("button", { name: `Revoke ${company.owner.name}` }).click();
  await expect(ownerRow.getByText("Not granted")).toBeVisible();

  // Moving a Project under another parent.
  await page.getByRole("button", { name: "Change parent" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Parent", { exact: true }).selectOption({ label: `${company.name} (root Project)` });
  await sheet.getByRole("button", { name: "Save parent" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(`Parent: ${company.name}`)).toBeVisible();
});

test("a published Standard is in force on the Project tree and the Buyer locks it", async ({ page, browser, company }) => {
  await signIn(page, company.buyer);
  await createModule(page, "Web stack", "code-stack");
  await assignOwner(page, "Web stack", company.owner);
  const owner = await signedIn(browser, company.owner);
  await publishCodeStack(owner, "Web stack", { category: "framework", name: "React", status: "required" });

  await page.goto("/projects");
  const effective = page.getByRole("tabpanel", { name: "Effective standards" });
  const row = effective.getByRole("row").filter({ hasText: "React" });
  await expect(row.getByText("required")).toBeVisible();
  await row.getByRole("button", { name: "Mark as Locked rule" }).click();
  await expect(row.getByRole("button", { name: "Remove Locked rule" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: `${company.name}, root Project, no level name, 1 Locked rule` })).toBeVisible();
});
