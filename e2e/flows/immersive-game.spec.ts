import { expect, test } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

test("a player installs a world and continues a persistent conversation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /世界在等待.*你的下一句话/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /开始新游戏/ })).toBeVisible();
  await page.getByRole("link", { name: /开始新游戏/ }).click();
  await expect(page).toHaveURL(/\/worlds$/);
  await expect(page.getByText("尚未安装任何世界。先导入一个世界包。")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "open-world-fixture.zip",
    mimeType: "application/zip",
    buffer: fixtureArchive(),
  });
  await expect(page.getByRole("heading", { name: "开放世界测试夹具" })).toBeVisible();
  await page.getByRole("button", { name: /开始旅程/ }).click();
  await expect(page).toHaveURL(/\/play\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "你想做什么？" })).toBeVisible();

  const composer = page.getByLabel("你的行动");
  await composer.fill("我尝试一个剧本没有预配置的自由行动");
  await composer.press("Enter");
  await expect(page.getByText("世界回应了你的自由行动。")).toBeVisible();
  await expect(page.getByText("模拟 Truth Engine 已联合裁决行动。")).toHaveCount(0);
  await expect(page.getByText("目标已经完成")).toBeVisible();
  await expect(page.getByLabel("当前世界状态").getByText("1", { exact: true })).toBeVisible();

  const sessionsResponse = await page.request.get("/api/sessions");
  const sessions = await sessionsResponse.json() as { sessions: Array<{ id: string; revision: number }> };
  expect(sessions.sessions).toHaveLength(1);
  const [summary] = sessions.sessions;
  expect(summary.revision).toBe(1);
  expect(JSON.stringify(sessions)).not.toContain("canonicalEntityIds");
  expect(JSON.stringify(sessions)).not.toContain("key-authenticity");

  await page.reload();
  await expect(page.getByText("世界回应了你的自由行动。")).toBeVisible();
  await expect(page.getByText("模拟 Truth Engine 已联合裁决行动。")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /继续当前世界/ })).toBeVisible();

  await page.goto("/saves");
  await page.getByRole("button", { name: /重命名/ }).click();
  await page.getByLabel("存档名称").fill("石门之外");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByRole("heading", { name: "石门之外" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the control orb exposes desktop and mobile navigation", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };

  await page.goto(`/play/${detail.summary.id}`);
  await page.getByRole("button", { name: /打开游戏控制/ }).click();
  await expect(page.getByRole("button", { name: "存档" })).toBeVisible();
  await page.getByRole("button", { name: /关闭游戏控制/ }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /打开游戏控制/ }).click();
  await expect(page).toHaveURL(/\/control$/);
  await expect(page.getByRole("heading", { name: "游戏控制" })).toBeVisible();
});
