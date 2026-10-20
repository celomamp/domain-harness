import { defineConfig, devices } from "@playwright/test";
import { PANEL_PORT, PANEL_URL, REGISTRY_PORT, REGISTRY_URL } from "./stack.ts";

/**
 * The panel's happy paths, end to end: a real registry on a throwaway
 * database and the built panel (`pnpm build` first). Run with
 * `pnpm --filter @domain-harness/panel test:e2e`.
 */
export default defineConfig({
  testDir: ".",
  // `guide:screens` sets E2E_GUIDE to take the user-guide screenshots instead.
  testMatch: process.env["E2E_GUIDE"] === undefined ? "*.spec.ts" : "guide.screens.ts",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  retries: process.env["CI"] === undefined ? 0 : 1,
  workers: process.env["CI"] === undefined ? "50%" : 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  outputDir: "../test-results",
  use: {
    baseURL: PANEL_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env["E2E_CHROMIUM_PATH"] === undefined
      ? {}
      : { launchOptions: { executablePath: process.env["E2E_CHROMIUM_PATH"] } }),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/registry-server.ts",
      cwd: "..",
      url: `${REGISTRY_URL}/v1/projects`,
      // Any answer (401 without a session) means the registry is listening.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
      env: { E2E_REGISTRY_PORT: String(REGISTRY_PORT) },
    },
    {
      command: "node server.js",
      cwd: "..",
      url: `${PANEL_URL}/sign-in`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
      env: { PORT: String(PANEL_PORT), PANEL_REGISTRY_URL: REGISTRY_URL },
    },
  ],
});
