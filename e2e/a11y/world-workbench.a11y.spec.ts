import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

test("the empty world workbench has no detectable accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "暂无可玩世界" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.locator('input[type="file"]').setInputFiles({
    name: "open-world-fixture.zip",
    mimeType: "application/zip",
    buffer: fixtureArchive(),
  });
  await page.getByRole("button", { name: "启动世界" }).click();
  await expect(page.getByLabel("你的行动")).toBeVisible();
  const runningWorkbench = await new AxeBuilder({ page }).analyze();
  expect(runningWorkbench.violations).toEqual([]);

  await page.getByLabel("你的行动").fill("执行一个自由行动");
  await page.getByRole("button", { name: "提交自由行动" }).click();
  await expect(page.getByText("目标已经完成。")).toBeVisible();
  const completedWorkbench = await new AxeBuilder({ page }).analyze();
  expect(completedWorkbench.violations).toEqual([]);
});
