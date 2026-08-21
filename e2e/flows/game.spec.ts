import { expect, test } from "@playwright/test";
import {
  activeSessionIds,
  destroyActiveSessions,
  openRealLauncher,
  startRealFixtureGame,
} from "../support/real-app";

test.afterEach(async ({ request }) => {
  await destroyActiveSessions(request);
});

test("production host runs a complete script lifecycle through real routes", async ({ page, request }) => {
  await openRealLauncher(page);
  await expect(page.locator('[data-slot="launcher"]')).toContainText("UI API v4");

  await startRealFixtureGame(page);
  await expect(page.locator('[data-slot="hud"]')).toContainText("Engine API v2 已启动");
  await expect(page.locator('[data-slot="scene"]')).toBeVisible();
  await expect(page.locator('[data-slot="toolbar"]')).toBeVisible();
  await expect(page.locator('[data-slot="composer"]')).toBeVisible();
  await expect(page.locator('[data-slot="bubble-world"]')).toBeVisible();
  await expect(activeSessionIds(request)).resolves.toHaveLength(1);

  await page.getByRole("button", { name: "预检线路" }).click();
  await expect(page.getByRole("status").filter({ hasText: /校验线路.*可执行/ })).toBeVisible();
  await page.getByRole("textbox", { name: "输入验证指令" }).fill("复核一号中继线路");
  await page.getByRole("button", { name: "提交验证" }).click();
  await expect(page.locator('[data-slot="bubble-player"]').filter({ hasText: "复核一号中继线路" })).toBeVisible();
  await expect(page.locator('[data-slot="bubble-world"]')).toHaveCount(2);
  await expect(page.locator('[data-slot="message-card-location_enter"]').last()).toBeVisible();
  await expect(page.locator('[data-slot="message-card-event"]').last()).toBeVisible();

  await page.getByRole("button", { name: "触发系统记录" }).click();
  await expect(page.locator('[data-slot="bubble-system"]')).toContainText("世界记得你来过");

  await page.getByRole("button", { name: "检查清单" }).click();
  await expect(page.locator('[data-slot="panel-inventory"]')).toBeVisible();
  await page.getByRole("button", { name: "关闭检查清单" }).click();

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="pause-menu"]')).toBeVisible();
  await page.getByRole("button", { name: "保存校准点" }).click();
  await expect(page.locator('[data-slot="pause-menu"]')).toContainText("当前记录已保存");
  await page.getByRole("button", { name: "返回剧目单" }).click();
  await expect(page.locator('[data-slot="launcher"]')).toBeVisible();
  await expect(activeSessionIds(request)).resolves.toHaveLength(0);

  await page.getByRole("button", { name: "继续上次游戏" }).click();
  await expect(page.locator('[data-slot="game-shell"]')).toBeVisible();
  await expect(page.locator('[data-slot="bubble-player"]').filter({ hasText: "复核一号中继线路" })).toBeVisible();
  await expect(activeSessionIds(request)).resolves.toHaveLength(1);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回剧目单" }).click();
  await expect(activeSessionIds(request)).resolves.toHaveLength(0);

  await page.getByRole("link", { name: "剧本", exact: true }).click();
  await expect(page).toHaveURL(/\/scripts$/);
  await expect(page.getByRole("heading", { name: "剧本库" })).toBeVisible();
  await expect(page.getByRole("button", { name: /核心工作台/ })).toBeVisible();

  await page.getByRole("link", { name: "设置" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="settings-fixture"]')).toBeVisible();
});
