// End-to-end UI tests (#38): the Vite dev build in Chromium (sql.js database, window.fetch AI), with Ollama mocked
// in e2e/mockAi.ts. The shipped Tauri shell is not covered; the dev build is the same UI.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:1420", locale: "en-US", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:1420", reuseExistingServer: !process.env.CI },
});
