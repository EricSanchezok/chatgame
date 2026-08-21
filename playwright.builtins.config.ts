import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CHATGAME_BUILTINS_E2E_PORT ?? 32128);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e/builtins",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  globalSetup: "./e2e/support/builtins-global-setup.ts",
  outputDir: "e2e/artifacts/builtins-test-results",
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CHATGAME_SCRIPTS_ROOT: path.resolve("scripts"),
      CHATGAME_DATA_ROOT: path.resolve("e2e/artifacts/builtins-runtime-data"),
      CHATGAME_LLM_PROVIDER: "mock",
      CHATGAME_MEDIA_PROVIDER: "off",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
