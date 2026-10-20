import { expect, signIn, test } from "./fixtures.ts";
import { assignOwner, createModule, signedIn } from "./flows.ts";

test("the Buyer creates Modules and the Standard owner publishes and versions Standards", async ({
  page,
  browser,
  company,
}) => {
  await signIn(page, company.buyer);
  await createModule(page, "Web stack", "code-stack");
  await createModule(page, "Brand UI", "design-system");
  await expect(page.getByRole("row")).toHaveCount(3);

  // The toolbar filters the table without a round trip.
  await page.getByLabel("Kind").selectOption("design-system");
  await expect(page.getByText("1 of 2 Modules")).toBeVisible();
  await page.getByLabel("Kind").selectOption({ label: "All kinds" });
  await page.getByLabel("Search Modules").fill("web");
  await expect(page.getByText("1 of 2 Modules")).toBeVisible();
  await page.getByLabel("Search Modules").fill("");

  await assignOwner(page, "Web stack", company.owner);
  await assignOwner(page, "Brand UI", company.owner);

  // The Standard owner publishes into the code stack.
  const owner = await signedIn(browser, company.owner);
  await owner.getByRole("navigation", { name: "Management panel" }).getByRole("link", { name: "Standards" }).click();
  await owner.getByRole("link", { name: "Web stack" }).click();
  await expect(owner.getByRole("heading", { level: 1, name: "Web stack" })).toBeVisible();
  await expect(owner.getByText("No Standard is published in this Module yet.")).toBeVisible();

  await owner.getByRole("button", { name: "Publish standard" }).click();
  let sheet = owner.getByRole("dialog", { name: "Publish a code-stack Standard" });
  await sheet.getByLabel("Category").selectOption("framework");
  await sheet.getByLabel("Name", { exact: true }).fill("React");
  await sheet.getByLabel("Version constraint (optional)").fill("^19");
  await sheet.getByLabel("Status").selectOption("approved");
  await sheet.getByRole("button", { name: "Publish" }).click();
  await expect(sheet).toBeHidden();
  await expect(owner.getByText("Published", { exact: true })).toBeVisible();
  const row = owner.getByRole("row").filter({ has: owner.getByRole("link", { name: "React" }) });
  await expect(row.getByRole("cell", { name: "approved" })).toBeVisible();
  await expect(row.getByRole("cell", { name: "1", exact: true })).toBeVisible();

  // Editing publishes version 2 of the same Standard.
  await row.getByRole("link", { name: "React" }).click();
  sheet = owner.getByRole("dialog", { name: "Edit React" });
  await expect(sheet.getByLabel("Name", { exact: true })).toHaveValue("React");
  await sheet.getByLabel("Status").selectOption("required");
  await sheet.getByRole("button", { name: "Publish" }).click();
  await expect(sheet).toBeHidden();
  await expect(row.getByRole("cell", { name: "required" })).toBeVisible();
  await expect(row.getByRole("cell", { name: "2", exact: true })).toBeVisible();

  // A design-system token in the other Module.
  await owner.getByRole("link", { name: "Standards" }).first().click();
  await owner.getByRole("link", { name: "Brand UI" }).click();
  await owner.getByRole("button", { name: "Publish standard" }).click();
  sheet = owner.getByRole("dialog");
  await sheet.getByLabel("Entry kind").selectOption("token");
  await sheet.getByLabel("Name", { exact: true }).fill("color-primary");
  await sheet.getByLabel("Status").selectOption("required");
  await sheet.getByRole("button", { name: "Publish" }).click();
  await expect(sheet).toBeHidden();
  await expect(owner.getByRole("link", { name: "color-primary" })).toBeVisible();
});

test("a Builder sees why publishing is refused", async ({ page, browser, company }) => {
  await signIn(page, company.buyer);
  await createModule(page, "Data stack", "code-stack");

  const builder = await signedIn(browser, company.builder);
  await builder.goto("/standards");
  await builder.getByRole("link", { name: "Data stack" }).click();
  await builder.getByRole("button", { name: "Publish standard" }).click();
  const sheet = builder.getByRole("dialog", { name: "Publish a code-stack Standard" });
  await sheet.getByLabel("Category").selectOption("library");
  await sheet.getByLabel("Name", { exact: true }).fill("lodash");
  await sheet.getByLabel("Status").selectOption("prohibited");
  await sheet.getByRole("button", { name: "Publish" }).click();
  await expect(builder.getByText("nothing can be published into it", { exact: false })).toBeVisible();
});
