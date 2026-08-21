import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { destroyActiveSessions } from "../support/real-app";

async function selectScript(page: Page, scriptId: "emberfall" | "starlight"): Promise<void> {
  await page.addInitScript((activeScriptId) => {
    localStorage.setItem("chatgame:settings:v3", JSON.stringify({
      version: 3,
      masterVolume: 0.8,
      ambienceVolume: 0.7,
      voiceVolume: 0.85,
      effectsVolume: 0.8,
      fullscreenPreference: false,
      themeMode: "script",
      textScale: 1,
      contrast: "system",
      motion: "system",
      activeScriptId,
      lastRun: null,
      trackedTasks: {},
    }));
  }, scriptId);
}

async function expectConversationFrame(page: Page): Promise<void> {
  await expect(page.getByRole("log", { name: "游戏对话记录" })).toBeVisible();
  await expect(page.locator(".cg-location-card img")).toBeVisible();
  await expect(page.locator('[data-region="composer"]')).toBeVisible();
  await expect(page.locator('[data-region="toolbar"]')).toBeVisible();
  await expect(page.locator('[data-region="transcript"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.body.scrollHeight - document.body.clientHeight)).toBe(0);
}

async function closePanel(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `关闭${name}` }).click();
}

async function expectNoSeriousWcagViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
}

test.afterEach(async ({ request }) => {
  await destroyActiveSessions(request);
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("Emberfall uses one conversation stream for media, NPCs, actions, panels and saves", async ({ page }) => {
  await selectScript(page, "emberfall");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "灰烬镇", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "开始新游戏" }).click();
  await page.getByRole("dialog", { name: /开始《灰烬镇》/ }).getByRole("button", { name: "进入世界" }).click();
  await expectConversationFrame(page);
  await expectNoSeriousWcagViolations(page);

  await page.getByRole("button", { name: "核问何桂 职责与支护欠账", exact: true }).click();
  await expect(page.locator(".cg-action-preview")).toContainText("无需判定");
  await page.getByRole("button", { name: "发送" }).click();
  const npc = page.getByRole("button", { name: "何桂 井下领班", exact: true });
  await expect(npc).toBeVisible();
  await npc.click();
  await expect(page.locator(".cg-speaker__popover")).toContainText("井下领班");

  const input = page.getByRole("textbox", { name: "输入你的话或行动" });
  await input.fill("我把炉煤申请按紧急程度重新排好。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("我把炉煤申请按紧急程度重新排好。", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /本班要务/ }).click();
  await expect(page.getByRole("dialog", { name: "任务" })).toBeVisible();
  await expectNoSeriousWcagViolations(page);
  await closePanel(page, "任务");
  await page.getByRole("button", { name: "地图", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "地图" })).toBeVisible();
  await closePanel(page, "地图");
  await page.getByRole("button", { name: "背包", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "背包" })).toBeVisible();
  await closePanel(page, "背包");

  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const pause = page.getByRole("dialog", { name: "暂停菜单" });
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "保存并返回" }).click();
  await page.getByRole("button", { name: "继续上次游戏" }).click();
  await expect(page.getByText("我把炉煤申请按紧急程度重新排好。", { exact: true })).toBeVisible();
});

test("Starlight uses one conversation stream for media, NPCs, previews, panels and saves", async ({ page }) => {
  await selectScript(page, "starlight");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "星港", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "接下夜班" }).click();
  await page.getByRole("dialog", { name: /开始《星港》/ }).getByRole("button", { name: "进入世界" }).click();
  await expectConversationFrame(page);

  await page.getByRole("button", { name: "询问老周 核对库存与交班责任", exact: true }).click();
  await expect(page.locator(".cg-action-preview")).toContainText("可执行");
  await page.getByRole("button", { name: "发送" }).click();
  const npc = page.getByRole("button", { name: "老周 维修一班机务长", exact: true });
  await expect(npc).toBeVisible();
  await npc.click();
  await expect(page.locator(".cg-speaker__popover")).toContainText("维修一班机务长");

  await page.getByRole("button", { name: "检查 P-07 读取压差、阀体与住户影响", exact: true }).click();
  await expect(page.locator(".cg-action-preview")).toContainText("成本已锁定");
  await page.getByRole("button", { name: "发送" }).click();
  const input = page.getByRole("textbox", { name: "输入你的话或行动" });
  await input.fill("我在交班纸上标出未登记住户的数量差。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("我在交班纸上标出未登记住户的数量差。", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "查看 P-07 当前工单" }).click();
  await expect(page.getByRole("dialog", { name: "任务" })).toBeVisible();
  await expectNoSeriousWcagViolations(page);
  await closePanel(page, "任务");
  await page.getByRole("button", { name: "站区", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "地图" })).toBeVisible();
  await closePanel(page, "地图");
  await page.getByRole("button", { name: "工装", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "背包" })).toBeVisible();
  await closePanel(page, "背包");

  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const pause = page.getByRole("dialog", { name: "暂停菜单" });
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "保存交班记录" }).click();
  await pause.getByRole("button", { name: "交班并返回启动器" }).click();
  await page.getByRole("button", { name: "读取交班存档" }).click();
  const saves = page.getByRole("dialog", { name: "选择存档" });
  await expect(saves).toBeVisible();
  await saves.locator(".cg-save-row").first().click();
  await expect(page.getByText("我在交班纸上标出未登记住户的数量差。", { exact: true })).toBeVisible();
});
