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

const matrix: VisualMatrixEntry[] = [
  { name: "phone-390x844", viewport: { width: 390, height: 844 } },
  { name: "tablet-768x1024", viewport: { width: 768, height: 1024 } },
  { name: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
  { name: "short-landscape-844x390", viewport: { width: 844, height: 390 } },
  {
    name: "text-200-percent",
    viewport: { width: 390, height: 844 },
    prepare: async (page) => {
      await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
    },
  },
  {
    name: "reduced-motion",
    viewport: { width: 1440, height: 900 },
    prepare: async (page) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
    },
  },
  {
    name: "high-contrast",
    viewport: { width: 1440, height: 900 },
    prepare: async (page) => {
      await page.emulateMedia({ forcedColors: "active" });
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

test("launcher empty and new-game states", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { library: "empty" });
  await page.goto("/");
  await page.getByText(/还没有已安装的剧本/).waitFor();
  await expect(page).toHaveScreenshot("launcher-empty.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page);
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
  await page.getByRole("button", { name: "开始新游戏" }).click();
  await page.getByRole("dialog", { name: "新游戏" }).getByRole("combobox").waitFor();
  await expect(page).toHaveScreenshot("launcher-new-game-dialog.png");
});

test("conversation empty, long, error and settings states", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { conversation: "empty" });
  await openLauncher(page);
  await startFixtureGame(page);
  await expect(page).toHaveScreenshot("conversation-empty.png");

  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "暂停菜单" }).waitFor();
  await expect(page).toHaveScreenshot("settings.png");

  await page.unrouteAll({ behavior: "wait" });
  await installMockGameRoutes(page, { conversation: "long", turn: "error" });
  await page.reload();
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
  await startFixtureGame(page);
  await expect(page.getByText(/第 27 次确认/)).toBeAttached();
  await expect(page).toHaveScreenshot("conversation-long.png");

  await page.getByRole("textbox", { name: "玩家输入" }).fill("检查备用线路");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByText("世界响应超时").waitFor();
  await expect(page).toHaveScreenshot("conversation-error.png");
});
