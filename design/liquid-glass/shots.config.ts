import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["shots.spec.ts", "components.spec.ts"],
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1440, height: 900 },
    browserName: "chromium",
    channel: "chromium",
  },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:1420", reuseExistingServer: true },
});
