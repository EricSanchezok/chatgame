import { expect, test } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

test("a fresh installation exposes the truthful empty world workbench", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "开放世界引擎" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "暂无可玩世界" })).toBeVisible();
  await expect(page.getByText("导入符合 schema v5 的世界 ZIP，开始一段游戏。")).toBeVisible();
  await expect(page.getByText("导入世界 ZIP")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "open-world-fixture.zip",
    mimeType: "application/zip",
    buffer: fixtureArchive(),
  });
  await expect(page.getByRole("heading", { name: "开放世界测试夹具" })).toBeVisible();
  await page.getByRole("button", { name: "启动世界" }).click();
  await expect(page.getByLabel("你的行动")).toBeVisible();

  await page.getByLabel("你的行动").fill("我尝试一个剧本没有预配置的自由行动");
  await page.getByLabel("你的行动").press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await expect(page.getByText("模拟 Truth Engine 已联合裁决行动。")).toBeVisible();
  await expect(page.getByText("目标已经完成。")).toBeVisible();
  await expect(page.getByText("Revision").locator("..").getByText("1", { exact: true })).toBeVisible();

  const runResponse = await page.request.get("/api/sessions");
  const sessions = await runResponse.json() as { sessions: Array<{ id: string; revision: number }> };
  expect(sessions.sessions[0].revision).toBe(1);
  const publicJson = JSON.stringify(sessions);
  expect(publicJson).not.toContain("canonicalEntityIds");
  expect(publicJson).not.toContain("key-authenticity");

  await page.reload();
  await expect(page.getByText("Revision").locator("..").getByText("1", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
