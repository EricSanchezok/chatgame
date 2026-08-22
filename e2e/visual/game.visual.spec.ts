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

async function expectStableScreenshot(page: Page, name: string): Promise<void> {
  await settleVisualPage(page);
  await expect(page).toHaveScreenshot(name, { animations: "allow" });
}

async function setPlayerPreferences(
  page: Page,
  patch: Record<string, string | number | boolean>,
): Promise<void> {
  await page.evaluate((next) => {
    const key = "chatgame:settings:v3";
    const current = JSON.parse(localStorage.getItem(key) ?? '{"version":3}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...current, ...next, version: 3 }));
  }, patch);
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
}

const matrix: VisualMatrixEntry[] = [
  { name: "phone-390x844", viewport: { width: 390, height: 844 } },
  { name: "tablet-768x1024", viewport: { width: 768, height: 1024 } },
  { name: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
  { name: "desktop-2560x1440", viewport: { width: 2560, height: 1440 } },
  { name: "desktop-5120x2880", viewport: { width: 5120, height: 2880 } },
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
    await installMockGameRoutes(page, { hostShell: true });
    await openLauncher(page);
    await entry.prepare?.(page);
    await expectStableScreenshot(page, `launcher-${entry.name}.png`);
  });
}

for (const entry of matrix) {
  test(`default game shell visual matrix: ${entry.name}`, async ({ page }) => {
    await page.setViewportSize(entry.viewport);
    await installMockGameRoutes(page, { conversation: "long", hostShell: true });
    await openLauncher(page);
    await entry.prepare?.(page);
    await startFixtureGame(page);
    await expectStableScreenshot(page, `game-shell-${entry.name}.png`);
  });
}

test("launcher empty, loading, error and new-game states", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { library: "empty" });
  await page.goto("/");
  await page.getByRole("heading", { name: "今晚还没有剧目" }).waitFor();
  await expectStableScreenshot(page, "launcher-empty.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { latencyMs: { "/api/scripts": 2_000 } });
  await page.reload();
  await page.locator(".cg-empty-library p").filter({ hasText: "正在整理剧目单……" }).waitFor();
  await expectStableScreenshot(page, "launcher-loading.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { library: "error" });
  await page.reload();
  await page.locator(".cg-empty-library p").filter({ hasText: /剧目单读取失败/ }).waitFor();
  await expectStableScreenshot(page, "launcher-error.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { hostShell: true });
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
  await page.getByRole("button", { name: "开始新游戏" }).click();
  await page.getByRole("heading", { name: "你从哪里来" }).waitFor();
  await expectStableScreenshot(page, "launcher-origin-step.png");
});

test("conversation empty, long, error and pause states", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { conversation: "empty", hostShell: true });
  await openLauncher(page);
  await startFixtureGame(page);
  await expectStableScreenshot(page, "conversation-empty.png");

  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "游戏菜单" }).waitFor();
  await expectStableScreenshot(page, "pause-menu.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { conversation: "long", turn: "error", hostShell: true });
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
  await startFixtureGame(page);
  await expect(page.getByText(/第 27 次确认/)).toBeAttached();
  await expectStableScreenshot(page, "conversation-long.png");

  await page.getByRole("textbox", { name: "输入你的话或行动" }).fill("检查备用线路");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("alert").filter({ hasText: "世界响应超时" }).waitFor();
  await expectStableScreenshot(page, "conversation-error.png");
});

const hostPageMatrix = matrix.filter((entry) => ["phone-390x844", "tablet-768x1024", "desktop-1440x900", "desktop-2560x1440", "desktop-5120x2880"].includes(entry.name));

for (const entry of hostPageMatrix) {
  test(`script library visual matrix: ${entry.name}`, async ({ page }) => {
    await page.setViewportSize(entry.viewport);
    await installMockGameRoutes(page, { hostShell: true });
    await page.goto("/scripts");
    await page.getByRole("heading", { name: "剧本库" }).waitFor();
    await expectStableScreenshot(page, `scripts-${entry.name}.png`);
  });

  test(`settings visual matrix: ${entry.name}`, async ({ page }) => {
    await page.setViewportSize(entry.viewport);
    await installMockGameRoutes(page, { hostShell: true });
    await page.goto("/settings");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await expectStableScreenshot(page, `settings-${entry.name}.png`);
  });
}

test("settings open Select popup", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { hostShell: true });
  await page.goto("/settings");
  await page.getByRole("combobox", { name: "文字大小" }).click();
  await page.getByRole("listbox").waitFor();
  await expectStableScreenshot(page, "settings-select-open.png");
});
