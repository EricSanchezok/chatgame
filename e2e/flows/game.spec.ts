import { expect, test } from "@playwright/test";
import {
  activeSessionIds,
  destroyActiveSessions,
  openRealLauncher,
  startRealFixtureGame,
} from "../support/real-app";
import {
  installMockGameRoutes,
  openLauncher,
  startFixtureGame,
} from "../support/mock-routes";

test.afterEach(async ({ request }) => {
  await destroyActiveSessions(request);
});

test("production host runs a complete script lifecycle through real routes", async ({ page, request }) => {
  await openRealLauncher(page);
  await expect(page.locator('[data-slot="launcher"]')).toContainText("UI API v6");

  await startRealFixtureGame(page);
  await expect(page.locator('[data-slot="game-shell"]')).toBeVisible();
  await expect(page.locator(".cg-game-topbar")).toContainText("恢复信号");
  await expect(page.locator('[data-slot="scene"]')).toBeVisible();
  await expect(page.locator(".cg-game-tools")).toBeVisible();
  await expect(page.locator(".cg-composer")).toBeVisible();
  await expect(page.locator('[data-slot="bubble-world"]')).toBeVisible();
  await expect(activeSessionIds(request)).resolves.toHaveLength(1);

  await page.getByRole("button", { name: /检查备用线路/ }).click();
  await expect(page.getByRole("textbox", { name: "输入你的话或行动" })).toHaveValue("检查备用线路");
  await expect(page.getByRole("status").filter({ hasText: /耗时.*无需判定/ })).toBeVisible();
  await page.getByRole("textbox", { name: "输入你的话或行动" }).fill("复核一号中继线路");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator('[data-slot="bubble-player"]').filter({ hasText: "复核一号中继线路" })).toBeVisible();
  await expect(page.locator('[data-slot="bubble-world"]')).toHaveCount(2);
  await expect(page.locator('[data-slot="message-card-location_enter"]').last()).toBeVisible();
  await expect(page.locator('[data-slot="message-card-event"]').last()).toBeVisible();

  await page.getByRole("button", { name: "背包", exact: true }).click();
  await expect(page.locator('[data-slot="panel-inventory"]')).toBeVisible();
  await page.getByRole("button", { name: "关闭检查清单" }).click();

  await page.keyboard.press("Escape");
  const menu = page.getByRole("dialog", { name: "游戏菜单" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "保存并返回" }).click();
  await expect(page.locator('[data-slot="launcher"]')).toBeVisible();
  await expect(activeSessionIds(request)).resolves.toHaveLength(0);

  await page.getByRole("button", { name: "读取存档" }).click();
  await page.getByRole("dialog", { name: "选择存档" }).getByRole("button", { name: /自动存档/ }).click();
  await expect(page.locator('[data-slot="game-shell"]')).toBeVisible();
  await expect(page.locator('[data-slot="bubble-player"]').filter({ hasText: "复核一号中继线路" })).toBeVisible();
  await expect(activeSessionIds(request)).resolves.toHaveLength(1);

  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "游戏菜单" }).getByRole("button", { name: "不保存返回" }).click();
  await expect(activeSessionIds(request)).resolves.toHaveLength(0);

  await page.goto("/scripts");
  await expect(page).toHaveURL(/\/scripts$/);
  await expect(page.getByRole("heading", { name: "剧本库" })).toBeVisible();
  await expect(page.getByRole("button", { name: /核心工作台/ })).toBeVisible();

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="settings-fixture"]')).toBeVisible();
});

test("game workspace has no AppShell and opens every centered data dialog", async ({ page }) => {
  await installMockGameRoutes(page, { hostShell: true });
  await openLauncher(page);
  await startFixtureGame(page);

  await expect(page.locator(".cg-app-shell")).toHaveCount(0);
  await expect(page.locator(".cg-sheet")).toHaveCount(0);
  await expect(page.locator(".cg-game-tools")).toBeVisible();

  for (const title of ["人物", "背包", "任务", "地图", "档案"]) {
    await page.getByRole("button", { name: title, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: `关闭${title}` }).click();
    await expect(dialog).toBeHidden();
  }
});
