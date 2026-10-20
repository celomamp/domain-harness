// Screenshots for the user guide (docs/guia-do-usuario): a fictional Company,
// "Aurora Pagamentos", walked through every surface. Not part of `test:e2e`;
// run `pnpm --filter @domain-harness/panel guide:screens`, then
// `node docs/guia-do-usuario/build.mjs` to rebuild GUIA-DO-USUARIO.html.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, signIn, signInLink, streamed, test } from "./fixtures.ts";
import type { Account, Company } from "./fixtures.ts";
import { REGISTRY_DIR, REPO_ROOT, databaseUrl } from "./stack.ts";

const OUT = join(REPO_ROOT, "docs/guia-do-usuario/img");
const VIEWPORT = { viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1.25 };

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 82 });

/** The demo Company with readable names; emails stay unique per run. */
function provision(): Company {
  const s = Math.random().toString(36).slice(2, 6);
  const people = [
    { name: "Beatriz Lima", email: `beatriz.${s}@aurora.example`, role: "Buyer" as const },
    { name: "Samuel Rocha", email: `samuel.${s}@aurora.example`, role: "Standard owner" as const },
    { name: "Bruna Costa", email: `bruna.${s}@aurora.example`, role: "Builder" as const },
  ];
  const dir = mkdtempSync(join(tmpdir(), "dh-guide-"));
  try {
    writeFileSync(join(dir, "company.json"), JSON.stringify({ company: "Aurora Pagamentos", plan: "Team", accounts: people }));
    const run = spawnSync(
      process.execPath,
      ["--conditions=@domain-harness/source", join(REGISTRY_DIR, "src/operator/provision-cli.ts"), join(dir, "company.json")],
      { cwd: REGISTRY_DIR, env: { ...process.env, REGISTRY_DATABASE_URL: databaseUrl("dh_registry_app") }, encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`provision failed: ${run.stderr}`);
    const out = JSON.parse(run.stdout) as { tenantId: string; rootProjectId: string; accounts: { id: string }[] };
    const [buyer, owner, builder] = people.map((person, index): Account => ({ ...person, id: out.accounts[index]?.id ?? "" }));
    if (buyer === undefined || owner === undefined || builder === undefined) throw new Error("missing accounts");
    return { name: "Aurora Pagamentos", tenantId: out.tenantId, rootProjectId: out.rootProjectId, buyer, owner, builder };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function settle(page: Page) {
  await streamed(page);
  await page.waitForTimeout(450);
}
async function go(page: Page, path: string) {
  await page.goto(path);
  await settle(page);
}

test("guide screenshots", async ({ browser }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const c = provision();
  const ctx = await browser.newContext(VIEWPORT);
  const page = await ctx.newPage();

  // Sign-in
  await go(page, "/sign-in");
  await page.getByLabel("Email address").fill(c.buyer.email);
  await shot(page, "01-sign-in");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await shot(page, "02-check-email");
  await page.goto(await signInLink(c.buyer.email));
  await settle(page);
  await shot(page, "03-inventory-empty");

  // Project tree
  await go(page, "/projects");
  const mk = async (name: string, level: string, parent: string) => {
    await page.getByRole("button", { name: "Create project" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Name", { exact: true }).fill(name);
    await sheet.getByLabel("Level name").fill(level);
    await sheet.getByLabel("Parent", { exact: true }).selectOption({ label: parent });
    if (name === "Cartões") await shot(page, "05-create-project");
    await sheet.getByRole("button", { name: "Create Project" }).click();
    await expect(sheet).toBeHidden();
  };
  await mk("Cartões", "Unidade de negócio", "Aurora Pagamentos (root Project)");
  await mk("Pix", "Unidade de negócio", "Aurora Pagamentos (root Project)");
  await mk("Portal do Cliente", "Aplicação", "Cartões (level Unidade de negócio)");

  // Modules
  await go(page, "/standards");
  const mod = async (name: string, kind: string) => {
    await page.getByRole("button", { name: "Create Module" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Module name").fill(name);
    await sheet.getByLabel("Kind").selectOption(kind);
    if (name === "Stack Web") await shot(page, "06-create-module");
    await sheet.getByRole("button", { name: "Create" }).click();
    await expect(sheet).toBeHidden();
  };
  await mod("Stack Web", "code-stack");
  await mod("Design System Aurora", "design-system");
  for (const m of ["Stack Web", "Design System Aurora"]) {
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: m }) });
    await row.getByRole("button", { name: "Assign owner" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("combobox").selectOption({ label: c.owner.name });
    if (m === "Stack Web") await shot(page, "07-assign-owner");
    await sheet.getByRole("button", { name: "Assign Standard owner" }).click();
    await expect(sheet).toBeHidden();
  }
  await settle(page);
  await shot(page, "08-modules");

  // Standard owner publishes
  const owner = await (await browser.newContext(VIEWPORT)).newPage();
  await signIn(owner, c.owner);
  await go(owner, "/standards");
  await owner.getByRole("link", { name: "Stack Web" }).click();
  await settle(owner);
  const pub = async (cat: string, name: string, status: string, ver = "", fix = "", project?: string) => {
    await owner.getByRole("button", { name: "Publish standard" }).click();
    const sheet = owner.getByRole("dialog");
    if (project !== undefined) await sheet.getByLabel("Project scope").selectOption({ label: project });
    await sheet.getByLabel("Category").selectOption(cat);
    await sheet.getByLabel("Name", { exact: true }).fill(name);
    if (ver) await sheet.getByLabel("Version constraint (optional)").fill(ver);
    await sheet.getByLabel("Status").selectOption(status);
    if (fix) await sheet.getByLabel("Correction instruction (optional)").fill(fix);
    if (name === "React") await shot(owner, "09-publish-standard");
    await sheet.getByRole("button", { name: "Publish" }).click();
    await expect(sheet).toBeHidden();
  };
  await pub("language", "TypeScript", "required", ">=5", "Escreva todo código novo em TypeScript com strict ligado.");
  await pub("framework", "React", "approved", "^19");
  await pub("library", "moment", "prohibited", "", "Use date-fns no lugar de moment.");
  await pub("library", "lodash", "prohibited", "", "Use funções nativas do JavaScript.");
  await pub("library", "Recharts", "approved", "^3", "", "Cartões (level Unidade de negócio)");
  await settle(owner);
  await shot(owner, "10-standards-published");

  await go(owner, "/standards");
  await owner.getByRole("link", { name: "Design System Aurora" }).click();
  await settle(owner);
  const ds = async (kind: string, fill: (sheet: Locator) => Promise<void>) => {
    await owner.getByRole("button", { name: "Publish standard" }).click();
    const sheet = owner.getByRole("dialog");
    await sheet.getByLabel("Entry kind").selectOption(kind);
    await fill(sheet);
    if (kind === "component") await shot(owner, "11-publish-component");
    await sheet.getByRole("button", { name: "Publish" }).click();
    await expect(sheet).toBeHidden();
  };
  await ds("token", async (s) => { await s.getByLabel("Name", { exact: true }).fill("color-brand-primary"); await s.getByLabel("Status").selectOption("required"); });
  await ds("import", async (s) => { await s.getByLabel("Module specifier").fill("@aurora/ui"); await s.getByLabel("Status").selectOption("required"); });
  await ds("component", async (s) => {
    await s.getByLabel("Name", { exact: true }).fill("Button");
    await s.getByLabel("Usage rule").fill("Use o Button do @aurora/ui para toda ação; nunca um <button> estilizado à mão.");
    await s.getByLabel("Tokens it depends on (optional, separated by commas)").fill("color-brand-primary");
  });
  await settle(owner);
  await shot(owner, "12-design-system");

  // Effective standards + lock + grants
  await go(page, "/projects");
  await page.locator(".project-node__name").getByText("Portal do Cliente", { exact: true }).click();
  await settle(page);
  await shot(page, "13-effective-standards");
  await go(page, "/projects");
  const row = page.getByRole("tabpanel", { name: "Effective standards" }).getByRole("row").filter({ hasText: "TypeScript" });
  await row.getByRole("button", { name: "Mark as Locked rule" }).click();
  await expect(row.getByRole("button", { name: "Remove Locked rule" })).toBeVisible();
  await page.locator(".project-node__name").getByText("Cartões", { exact: true }).click();
  await settle(page);
  await page.getByRole("tab", { name: "Build grants" }).click();
  const b = page.getByRole("tabpanel", { name: "Build grants" }).getByRole("listitem").filter({ hasText: c.builder.name });
  await b.getByRole("button", { name: "Grant build" }).click();
  await expect(b.getByText("Granted", { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, "14-build-grant");

  // Guidance endpoint + place application
  await go(page, "/new-application");
  const ep = page.getByRole("form", { name: "Company Guidance endpoint" });
  await ep.getByLabel("Guidance endpoint URL").fill("https://harness.aurora.example/mcp");
  await ep.getByRole("button", { name: "Set the Guidance endpoint" }).click();
  await expect(ep.getByText("Current endpoint")).toBeVisible();
  await page.evaluate(() => { window.scrollTo(0, 0); });
  const place = page.getByRole("tabpanel", { name: "Place an application" });
  await place.getByLabel("Description").fill("Portal de faturas do cliente");
  await place.getByLabel("Project").selectOption({ label: "Portal do Cliente (level Aplicação)" });
  await shot(page, "15-place-application");
  await place.getByRole("button", { name: "Place the Application" }).click();
  await expect(page.getByRole("tab", { name: "Generate Boilerplate" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Generate the Boilerplate" }).click();
  await expect(page.getByText("Boilerplate for Claude Code")).toBeVisible();
  await page.waitForTimeout(900);
  await shot(page, "16-boilerplate");

  // Builder places another app
  const builder = await (await browser.newContext(VIEWPORT)).newPage();
  await signIn(builder, c.builder);
  await go(builder, "/new-application");
  const bp = builder.getByRole("tabpanel", { name: "Place an application" });
  await bp.getByLabel("Description").fill("Simulador de limite do cartão");
  await bp.getByLabel("Project").selectOption({ label: "Cartões (level Unidade de negócio)" });
  await bp.getByRole("button", { name: "Place the Application" }).click();
  await builder.getByLabel("Agent tool").selectOption({ label: "Cursor" });
  await builder.getByRole("button", { name: "Generate the Boilerplate" }).click();
  await expect(builder.getByText("Boilerplate for Cursor")).toBeVisible();

  // Register existing
  await go(page, "/new-application");
  await page.getByRole("tab", { name: "Register existing" }).click();
  const reg = page.getByRole("tabpanel", { name: "Register existing" });
  await reg.getByLabel("Description").fill("Conciliação Pix (legado)");
  await reg.getByLabel("Project").selectOption({ label: "Pix (level Unidade de negócio)" });
  await reg.getByRole("button", { name: "Register the Application" }).click();
  await expect(reg.locator("pre")).toBeVisible();
  await page.waitForTimeout(700);
  await shot(page, "17-register-existing");

  // Inventory + application
  await go(page, "/inventory");
  await shot(page, "18-inventory");
  await page.getByRole("link", { name: "Portal de faturas do cliente" }).click();
  await settle(page);
  await shot(page, "19-application");

  // Guidance access
  await go(page, "/guidance-access");
  await page.getByRole("checkbox", { name: "Standard owner" }).check();
  await page.getByLabel("Keep Guidance events for (days)").fill("180");
  await shot(page, "20-guidance-access");
  await page.getByRole("button", { name: "Save Guidance access" }).click();
  await expect(page.getByText("Saved the Guidance access.")).toBeVisible();
  await page.getByRole("button", { name: "Mint a read token for my role" }).click();
  await expect(page.getByRole("group", { name: "One-time read token" })).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "21-read-token");

  // Accepted deviation
  await go(owner, "/standards");
  await owner.getByRole("link", { name: "Stack Web" }).click();
  await settle(owner);
  const lr = owner.getByRole("row").filter({ has: owner.getByRole("link", { name: "lodash" }) });
  await lr.getByRole("button", { name: "Show details" }).click();
  const lodashId = ((await owner.locator(".standard-detail__id").first().textContent()) ?? "").trim();
  await go(page, "/accepted-deviation");
  await page.getByLabel("CI Gate deviation log line").fill(`${lodashId} code-stack/library/lodash lodash: Use funções nativas do JavaScript.`);
  await page.getByRole("button", { name: "Use this line" }).click();
  await page.getByLabel("Application").selectOption({ label: "Portal de faturas do cliente (Portal do Cliente)" });
  await page.getByLabel("Justification").fill("Dependência herdada do SDK de boletos; remoção planejada para o 1º trimestre.");
  await page.getByLabel("Start").fill("2026-10-20");
  await page.getByLabel("End").fill("2027-03-31");
  await page.getByLabel("Alert interval").fill("168");
  await page.getByRole("button", { name: "Record Accepted deviation" }).click();
  await expect(page.getByText("Recorded the Accepted deviation for lodash.")).toBeVisible();
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(700);
  await shot(page, "22-accepted-deviation");

  await go(page, "/compilations");
  await shot(page, "23-compilations");

  // Mobile
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await signIn(m, c.buyer);
  await settle(m);
  await shot(m, "24-mobile-inventory");
  await m.getByRole("button", { name: "Menu" }).click();
  await m.waitForTimeout(300);
  await shot(m, "25-mobile-menu");
});
