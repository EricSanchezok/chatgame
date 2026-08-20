import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CHATGAME_E2E_PORT ?? 32127);
const baseURL = `http://127.0.0.1:${port}`;
const scriptsRoot = path.resolve("test/fixtures/core-test-library");
const dataRoot = path.resolve("e2e/artifacts/runtime-data");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  globalSetup: "./e2e/support/global-setup.ts",
  outputDir: "e2e/artifacts/test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "e2e/artifacts/report", open: "never" }]]
    : [["line"], ["html", { outputFolder: "e2e/artifacts/report", open: "never" }]],
  use: {
    baseURL,
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Five percent allowed the entire launcher composition to change while
      // the dark background still made the snapshot pass.
      maxDiffPixelRatio: 0.01,
    },
  },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CHATGAME_SCRIPTS_ROOT: scriptsRoot,
      CHATGAME_DATA_ROOT: dataRoot,
      CHATGAME_LLM_PROVIDER: "mock",
      CHATGAME_MEDIA_PROVIDER: "off",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  projects: [
    {
      name: "e2e",
      testMatch: "flows/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "a11y",
      testMatch: "a11y/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual",
      testMatch: "visual/**/*.spec.ts",
      use: { browserName: "chromium" },
    },
  ],
});
