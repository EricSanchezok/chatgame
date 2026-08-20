import { expect, test } from "@playwright/test";
import { installMockGameRoutes, openLauncher, startFixtureGame } from "../support/mock-routes";

test("launcher exposes the script library and survives rapid switching", async ({ page }) => {
  await installMockGameRoutes(page);
  await openLauncher(page);

  await page.getByRole("button", { name: "备用测试剧本" }).click();
  await expect(page.getByRole("heading", { name: /备用测试剧本/ })).toBeVisible();
  await page.getByRole("button", { name: "工作台剧本" }).click();
  await expect(page.getByRole("heading", { name: /工作台剧本/ })).toBeVisible();
});

test("launcher has deterministic empty and unavailable states", async ({ page }) => {
  await installMockGameRoutes(page, { library: "empty" });
  await page.goto("/");
  await expect(page.getByText(/还没有已安装的剧本/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始新游戏" })).toBeDisabled();

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { library: "error" });
  await page.reload();
  await expect(page.getByText(/还没有已安装的剧本/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始新游戏" })).toBeDisabled();
});

test("empty and long conversations use the real page route", async ({ page }) => {
  await installMockGameRoutes(page, { conversation: "empty" });
  await openLauncher(page);
  await startFixtureGame(page);
  await expect(page.locator('[data-region="stage"] article')).toHaveCount(0);

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { conversation: "long" });
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
  await startFixtureGame(page);
  await expect(page.getByText(/第 27 次确认/)).toBeAttached();
});

test("settings and turn errors remain operable", async ({ page }) => {
  await installMockGameRoutes(page, { turn: "error" });
  await openLauncher(page);
  await startFixtureGame(page);

  await page.keyboard.press("Escape");
  const settings = page.getByRole("dialog", { name: "暂停菜单" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "关闭", exact: true }).click();

  await page.getByRole("textbox", { name: "玩家输入" }).fill("检查备用线路");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("世界响应超时")).toBeVisible();
});
