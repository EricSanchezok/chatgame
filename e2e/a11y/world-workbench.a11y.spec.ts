import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the empty world workbench has no detectable accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "暂无可玩世界" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
