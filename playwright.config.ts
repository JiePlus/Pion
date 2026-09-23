import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:1420", reuseExistingServer: true },
});
