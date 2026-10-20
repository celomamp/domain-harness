import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts: the React Router plugin is for dev and build,
// not for tests. Component tests opt into jsdom per file.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15000,
  },
});
