import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures.ts";

async function setGuidanceEndpoint(page: Page, url: string) {
  await page.goto("/new-application");
  const form = page.getByRole("form", { name: "Company Guidance endpoint" });
  await form.getByLabel("Guidance endpoint URL").fill(url);
  await form.getByRole("button", { name: "Set the Guidance endpoint" }).click();
  await expect(page.getByText(`The Company Guidance endpoint is set to ${url}.`)).toBeVisible();
  await expect(form.getByText(`Current endpoint: ${url}`)).toBeVisible();
}

test("the Buyer places an Application, generates its Boilerplate and finds it on Inventory", async ({
  page,
  company,
}) => {
  await signIn(page, company.buyer);

  // From the empty Inventory straight into the flow.
  await expect(page.getByRole("heading", { name: "No Application yet." })).toBeVisible();
  await page.getByRole("link", { name: "New application" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "New-application flow" })).toBeVisible();

  await setGuidanceEndpoint(page, "https://guidance.acme.example/mcp");

  const place = page.getByRole("tabpanel", { name: "Place an application" });
  await place.getByLabel("Description").fill("Checkout web app");
  await place.getByLabel("Project").selectOption({ label: `${company.name} (root Project)` });
  await place.getByRole("button", { name: "Place the Application" }).click();
  await expect(page.getByText(`The Application is placed on ${company.name}.`, { exact: false })).toBeVisible();

  // Placing moves the flow to step 2.
  await expect(page.getByRole("tab", { name: "Generate Boilerplate" })).toHaveAttribute("aria-selected", "true");
  const generate = page.getByRole("tabpanel", { name: "Generate Boilerplate" });
  await generate.getByLabel("Agent tool").selectOption({ label: "Cursor" });
  await generate.getByRole("button", { name: "Generate the Boilerplate" }).click();
  await expect(generate.getByText("Boilerplate for Cursor")).toBeVisible();
  await expect(generate.getByText("Project identification file")).toBeVisible();
  const download = page.waitForEvent("download");
  await generate.getByRole("link", { name: "Download the archive" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.tar\.gz$|\.tgz$|\.gz$/);

  // The Application is on Inventory and opens its evidence page.
  await page.getByRole("navigation", { name: "Management panel" }).getByRole("link", { name: "Inventory" }).click();
  const app = page.getByRole("link", { name: "Checkout web app" });
  await expect(app).toBeVisible();
  await app.click();
  await expect(page).toHaveURL(/\/applications\//);
  await expect(page.getByRole("heading", { level: 1, name: "Checkout web app" })).toBeVisible();
});

test("the Buyer registers an existing Application and gets its identification file", async ({ page, company }) => {
  await signIn(page, company.buyer);
  await page.goto("/new-application");
  await page.getByRole("tab", { name: "Register existing" }).click();
  const register = page.getByRole("tabpanel", { name: "Register existing" });
  await register.getByLabel("Description").fill("Legacy billing service");
  await register.getByLabel("Project").selectOption({ label: `${company.name} (root Project)` });
  await register.getByRole("button", { name: "Register the Application" }).click();
  await expect(page.getByText("The Application is registered.", { exact: false })).toBeVisible();
  await expect(register.getByRole("heading", { name: "Project identification file" })).toBeVisible();
  await expect(register.locator("pre")).toContainText(`"projectId": "${company.rootProjectId}"`);

  await page.goto("/inventory");
  await expect(page.getByRole("link", { name: "Legacy billing service" })).toBeVisible();
});

test("a Builder with a build grant places an Application on that Project", async ({ page, browser, company }) => {
  await signIn(page, company.buyer);
  await page.goto("/projects");
  await page.getByRole("tab", { name: "Build grants" }).click();
  const row = page
    .getByRole("tabpanel", { name: "Build grants" })
    .getByRole("listitem")
    .filter({ hasText: `${company.builder.name} (Builder)` });
  await row.getByRole("button", { name: "Grant build" }).click();
  await expect(row.getByText("Granted", { exact: true })).toBeVisible();

  const builder = await (await browser.newContext()).newPage();
  await signIn(builder, company.builder);
  await builder.goto("/new-application");
  const place = builder.getByRole("tabpanel", { name: "Place an application" });
  await place.getByLabel("Description").fill("Mobile companion");
  await place.getByLabel("Project").selectOption({ label: `${company.name} (root Project)` });
  await place.getByRole("button", { name: "Place the Application" }).click();
  await expect(builder.getByText(`The Application is placed on ${company.name}.`, { exact: false })).toBeVisible();

  await page.goto("/inventory");
  await expect(page.getByRole("link", { name: "Mobile companion" })).toBeVisible();
});
