import { expect, signIn, test } from "./fixtures.ts";
import { assignOwner, createModule, placeApplication, publishCodeStack, signedIn } from "./flows.ts";

test("the Buyer records an Accepted deviation from a pasted Gate line", async ({ page, browser, company }) => {
  // A prohibited library in force at the root Project, and an Application there.
  await signIn(page, company.buyer);
  await createModule(page, "Web stack", "code-stack");
  await assignOwner(page, "Web stack", company.owner);
  const owner = await signedIn(browser, company.owner);
  const standardId = await publishCodeStack(owner, "Web stack", {
    category: "library",
    name: "lodash",
    status: "prohibited",
  });
  await placeApplication(page, "Checkout web app", `${company.name} (root Project)`);

  await page.getByRole("navigation", { name: "Management panel" }).getByRole("link", { name: "Accepted deviation" }).click();
  await expect(page.getByRole("heading", { name: "No Accepted deviation is recorded yet." })).toBeVisible();

  // Pasting the Gate's line fills the match key.
  await page.getByLabel("CI Gate deviation log line").fill(`${standardId} code-stack/library/lodash lodash: Remove lodash.`);
  await page.getByRole("button", { name: "Use this line" }).click();
  await expect(page.getByLabel("Standard id")).toHaveValue(standardId);
  await expect(page.getByLabel("Conflict slot")).toHaveValue("code-stack/library/lodash");
  await expect(page.getByLabel("Subject")).toHaveValue("lodash");

  await page.getByLabel("Application").selectOption({ label: `Checkout web app (${company.name})` });
  await expect(page.getByText("Resolved Standard version 1", { exact: false })).toBeVisible();
  await page.getByLabel("Justification").fill("Legacy date helpers; removal is planned for Q1.");
  await page.getByLabel("Start").fill("2026-10-01");
  await page.getByLabel("End").fill("2027-01-31");
  await page.getByLabel("Alert interval").fill("24");
  await page.getByRole("button", { name: "Record Accepted deviation" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Recorded the Accepted deviation for lodash." })).toBeVisible();
  const stored = page.getByRole("article", { name: "lodash" });
  await expect(stored.getByRole("link", { name: "Checkout web app" })).toBeVisible();
  await expect(stored.getByText("24 hours")).toBeVisible();
  // The form starts empty for the next acceptance.
  await expect(page.getByLabel("Justification")).toHaveValue("");
});
