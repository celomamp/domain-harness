import { expect, signIn, signInLink, test } from "./fixtures.ts";

test.describe("sign-in", () => {
  test("a signed-out visitor lands on sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeFocused();
  });

  test("an invalid address keeps its value and explains the format", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill("not-an-email");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("Enter an email address, for example name@company.com.")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue("not-an-email");
  });

  test("the emailed link signs in, every destination opens, and sign-out ends the session", async ({
    page,
    company,
  }) => {
    await signIn(page, company.buyer);
    const nav = page.getByRole("navigation", { name: "Management panel" });
    for (const [link, heading] of [
      ["Compilations", "Compilations"],
      ["Standards", "Standards"],
      ["Project tree", company.name],
      ["Guidance access", "Guidance access"],
      ["New-application flow", "New-application flow"],
      ["Accepted deviation", "Accepted deviation"],
      ["Inventory", "Inventory"],
    ] as const) {
      await nav.getByRole("link", { name: link }).click();
      await expect(nav.getByRole("link", { name: link })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("a used link is refused with a way to get a new one", async ({ page, company }) => {
    await signIn(page, company.owner);
    const used = await signInLink(company.owner.email);
    await page.context().clearCookies();
    await page.goto(used);
    await expect(page).toHaveURL(/\/sign-in\?status=link-invalid$/);
    await expect(page.getByText("This sign-in link was already used or has expired.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeFocused();
  });

  test("on a phone the menu opens the navigation drawer and closes on choosing a page", async ({ page, company }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, company.buyer);
    const nav = page.getByRole("navigation", { name: "Management panel" });
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "Standards" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
    await expect(nav).toBeHidden();
  });

  test("'Use a different address' returns to the form", async ({ page, company }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(company.builder.email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText(company.builder.email)).toBeVisible();
    await page.getByRole("button", { name: "Use a different address" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
  });

  test("with the demo toggle on, a demo address signs in as soon as it is entered", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByText(/demo accounts sign in as soon as you enter their address/)).toBeVisible();
    await page.getByLabel("Email address").fill("builder@demo.domainharness.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole("complementary", { name: "Panel sidebar" }).getByText("Builder", { exact: true })).toBeVisible();
  });
});
