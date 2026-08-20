import { expect, test, type Page } from "@playwright/test";
import {
  installMockGameRoutes,
  openLauncher,
  settleVisualPage,
  startFixtureGame,
} from "../support/mock-routes";

interface VisualMatrixEntry {
  name: string;
  viewport: { width: number; height: number };
  prepare?: (page: Page) => Promise<void>;
}

async function setPlayerPreferences(
  page: Page,
  patch: Record<string, string | number | boolean>,
): Promise<void> {
  await page.evaluate((next) => {
    const key = "chatgame:settings:v2";
    const current = JSON.parse(localStorage.getItem(key) ?? '{"version":2}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...current, ...next, version: 2 }));
  }, patch);
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
}

const matrix: VisualMatrixEntry[] = [
  { name: "phone-390x844", viewport: { width: 390, height: 844 } },
  { name: "tablet-768x1024", viewport: { width: 768, height: 1024 } },
  { name: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
  { name: "short-landscape-844x390", viewport: { width: 844, height: 390 } },
  {
    name: "text-200-percent",
    viewport: { width: 390, height: 844 },
    prepare: async (page) => {
      await setPlayerPreferences(page, { textScale: 2 });
    },
  },
  {
    name: "reduced-motion",
    viewport: { width: 1440, height: 900 },
    prepare: async (page) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setPlayerPreferences(page, { motion: "reduce" });
    },
  },
  {
    name: "high-contrast",
    viewport: { width: 1440, height: 900 },
    prepare: async (page) => {
      await setPlayerPreferences(page, { contrast: "more" });
    },
  },
];

for (const entry of matrix) {
  test(`launcher visual matrix: ${entry.name}`, async ({ page }) => {
    await page.setViewportSize(entry.viewport);
    await installMockGameRoutes(page);
    await openLauncher(page);
    await entry.prepare?.(page);
    await settleVisualPage(page);
    await expect(page).toHaveScreenshot(`launcher-${entry.name}.png`);
  });
}

test("launcher empty, loading, error and new-game states", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { library: "empty" });
  await page.goto("/");
  await page.getByRole("heading", { name: "今晚还没有剧目" }).waitFor();
  await expect(page).toHaveScreenshot("launcher-empty.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { latencyMs: { "/api/scripts": 2_000 } });
  await page.reload();
  await page.locator(".cg-empty-library p").filter({ hasText: "正在整理剧目单……" }).waitFor();
  await expect(page).toHaveScreenshot("launcher-loading.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { library: "error" });
  await page.reload();
  await page.locator(".cg-empty-library p").filter({ hasText: /剧目单读取失败/ }).waitFor();
  await expect(page).toHaveScreenshot("launcher-error.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page);
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
  await page.getByRole("button", { name: "开始新游戏" }).click();
  await page.getByRole("dialog", { name: /开始《工作台剧本》/ }).getByRole("combobox").waitFor();
  await expect(page).toHaveScreenshot("launcher-new-game-dialog.png");
});

test("conversation empty, long, error and pause states", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { conversation: "empty" });
  await openLauncher(page);
  await startFixtureGame(page);
  await expect(page).toHaveScreenshot("conversation-empty.png");

  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "暂停菜单" }).waitFor();
  await expect(page).toHaveScreenshot("pause-menu.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { conversation: "long", turn: "error" });
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
  await startFixtureGame(page);
  await expect(page.getByText(/第 27 次确认/)).toBeAttached();
  await expect(page).toHaveScreenshot("conversation-long.png");

  await page.getByRole("textbox", { name: "输入你的话或行动" }).fill("检查备用线路");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("alert").filter({ hasText: "世界响应超时" }).waitFor();
  await expect(page).toHaveScreenshot("conversation-error.png");
});

test("script library and settings routes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page);

  await page.goto("/scripts");
  await page.getByRole("heading", { name: "剧本库" }).waitFor();
  await page.getByRole("button", { name: "备用测试剧本" }).click();
  await page.getByRole("heading", { name: "备用测试剧本" }).waitFor();
  await page.getByRole("button", { name: "工作台剧本" }).click();
  await page.getByRole("heading", { name: "工作台剧本" }).waitFor();
  await expect(page).toHaveScreenshot("scripts-route.png");

  await page.goto("/settings");
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  await expect(page).toHaveScreenshot("settings-route.png");
});
