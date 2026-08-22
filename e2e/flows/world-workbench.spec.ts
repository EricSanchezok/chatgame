import { expect, test } from "@playwright/test";

test("a fresh installation exposes the truthful empty world workbench", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "开放世界引擎" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "暂无可玩世界" })).toBeVisible();
  await expect(page.getByText("仓库不再捆绑旧演示剧本")).toBeVisible();
  await expect(page.getByText("导入世界 ZIP")).toBeVisible();
});
