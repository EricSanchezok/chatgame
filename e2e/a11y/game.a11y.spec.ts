import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  destroyActiveSessions,
  openRealLauncher,
  startRealFixtureGame,
} from "../support/real-app";

async function expectNoSeriousWcagViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);
}

test.afterEach(async ({ request }) => {
  await destroyActiveSessions(request);
});

test("real launcher, dialog, script library and settings have no serious axe failures", async ({ page }) => {
  await openRealLauncher(page);
  await expectNoSeriousWcagViolations(page);

  await page.getByRole("button", { name: "建立值班" }).click();
  await expect(page.getByRole("dialog", { name: /开始《核心工作台》/ })).toBeVisible();
  await expectNoSeriousWcagViolations(page);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "剧本", exact: true }).click();
  await expect(page.getByRole("heading", { name: "剧本库" })).toBeVisible();
  await expectNoSeriousWcagViolations(page);

  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page.locator('[data-slot="settings-fixture"]')).toBeVisible();
  await expectNoSeriousWcagViolations(page);
});

test("real custom game shell and pause dialog have no serious axe failures", async ({ page }) => {
  await openRealLauncher(page);
  await startRealFixtureGame(page);
  await expectNoSeriousWcagViolations(page);

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="pause-menu"]')).toBeVisible();
  await expectNoSeriousWcagViolations(page);
});
