import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installMockGameRoutes, openLauncher, startFixtureGame } from "../support/mock-routes";

async function expectNoWcagViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("launcher has no automated WCAG A/AA violations", async ({ page }) => {
  await installMockGameRoutes(page);
  await openLauncher(page);
  await expectNoWcagViolations(page);
});

test("empty conversation shell has no automated WCAG A/AA violations", async ({ page }) => {
  await installMockGameRoutes(page, { conversation: "empty" });
  await openLauncher(page);
  await startFixtureGame(page);
  await expectNoWcagViolations(page);
});
