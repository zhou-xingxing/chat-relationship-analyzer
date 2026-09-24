import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer:
    process.env.E2E_USE_EXISTING_SERVER === "1"
      ? undefined
      : {
          command: "pnpm dev",
          url: "http://127.0.0.1:3000",
          reuseExistingServer: !process.env.CI,
        },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
