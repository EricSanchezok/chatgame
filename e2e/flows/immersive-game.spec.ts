import { expect, test, type Page } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

async function installFixture(page: Page): Promise<void> {
  const response = await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  expect(response.ok()).toBe(true);
}

async function createInstance(page: Page): Promise<{ id: string; revision: number }> {
  const response = await page.request.post("/api/instances", {
    data: { worldId: "open-world-fixture", seed: 20260827 },
  });
  expect(response.status()).toBe(201);
  const detail = await response.json() as { summary: { id: string; revision: number } };
  return detail.summary;
}

async function chooseEntry(page: Page, text: string | RegExp): Promise<void> {
  const card = page.locator(".cg-entry-grid label").filter({ hasText: text }).first();
  await card.click();
  await expect(card.locator("input[type=radio]")).toBeChecked();
}

async function enterFromOrigin(page: Page): Promise<void> {
  await page.getByRole("button", { name: "进入世界" }).click();
  await chooseEntry(page, "庭院旅人");
  await page.getByLabel("显示名称").fill("小明");
  await page.getByLabel("外观描述").fill("背着旧旅行包");
  await page.getByLabel("一个自由动机").fill("找到石门后的道路");
  await page.getByRole("button", { name: "确认角色" }).click();
  const arrival = page.getByRole("dialog");
  await expect(arrival.getByRole("heading", { name: "此刻，你是小明" })).toBeVisible();
  await arrival.getByRole("button", { name: "确认当前位置" }).click();
  await expect(page.getByRole("heading", { name: "小明" })).toBeVisible();
}

test("a world evolves headlessly through the same persistent instance", async ({ page }) => {
  await installFixture(page);
  await page.goto("/worlds/open-world-fixture");
  await expect(page.getByRole("heading", { name: "开放世界测试夹具", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /创建实例/ }).click();
  await expect(page).toHaveURL(/\/play\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "世界正在发生什么" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "你还没有进入世界" })).toBeVisible();

  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByText("Revision 1 · Step 1")).toBeVisible();
  await expect(page.getByText("世界在联合裁决后推进了一秒。")).toBeVisible();

  await page.getByRole("button", { name: "实时" }).click();
  await expect(page.getByText("实时演化")).toBeVisible();
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByText("已暂停")).toBeVisible();

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "进入世界" })).toBeVisible();
});

test("a Participant enters from an Origin, acts, releases, and reclaims the same Agent", async ({ page }) => {
  await installFixture(page);
  const instance = await createInstance(page);
  await page.goto(`/play/${instance.id}`);
  await enterFromOrigin(page);

  await page.getByRole("button", { name: "准备下一步" }).click();
  const action = page.getByLabel("你要做什么？");
  await expect(action).toHaveValue("确认当前位置");
  await action.fill("我现在在哪里？");
  await page.getByRole("button", { name: "提交行动" }).click();
  await expect(page.getByText("Revision 2 · Step 1")).toBeVisible();
  await expect(page.getByText("世界在联合裁决后推进了一秒。")).toBeVisible();
  await expect(page.locator(".cg-role-observations").getByText("世界继续变化。")).toBeVisible();

  await page.getByRole("button", { name: "离开并交给 AgentMind" }).click();
  await expect(page.getByRole("heading", { name: "你还没有进入世界" })).toBeVisible();
  await page.getByRole("button", { name: "进入世界" }).click();
  await chooseEntry(page, "小明");
  await page.getByRole("button", { name: "确认角色" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "关闭入场场景" }).click();
  await expect(page.getByRole("heading", { name: "小明" })).toBeVisible();

  await page.getByRole("button", { name: "离开并让角色等待" }).click();
  await expect(page.getByRole("heading", { name: "你还没有进入世界" })).toBeVisible();
  await page.getByRole("button", { name: "进入世界" }).click();
  await expect(page.locator(".cg-entry-grid label").filter({ hasText: "小明" })).toBeVisible();
});

test("failed execution remains atomic and long diagnostics never widen the inspector", async ({ page }) => {
  await installFixture(page);
  const instance = await createInstance(page);
  await page.goto(`/play/${instance.id}`);

  await page.getByRole("button", { name: "进入世界" }).click();
  await chooseEntry(page, /^旅人/);
  await page.getByRole("button", { name: "确认角色" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "关闭入场场景" }).click();
  await page.getByRole("button", { name: "准备下一步" }).click();
  await page.getByLabel("你要做什么？").fill("触发 E2E 快速失败");
  await page.getByRole("button", { name: "提交行动" }).click();
  await expect(page.getByLabel("你要做什么？")).toHaveValue("");

  await page.getByRole("button", { name: "运行记录" }).click();
  const inspector = page.getByRole("dialog", { name: "世界演化" });
  await expect(inspector.getByText("世界状态没有提交")).toBeVisible();
  await expect(inspector.getByText(/forced e2e authentication failure|ModelTransportError/).first()).toBeVisible();
  expect(await inspector.locator(".cg-inspector-detail").evaluate((element) => (
    element.scrollWidth <= element.clientWidth
  ))).toBe(true);

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("instance APIs expose Agent-scoped views without canonical identity bindings", async ({ page }) => {
  await installFixture(page);
  const instance = await createInstance(page);
  const response = await page.request.get(`/api/instances/${instance.id}`);
  expect(response.ok()).toBe(true);
  const text = await response.text();
  expect(text).not.toContain("canonicalEntityIds");
  expect(text).not.toContain("key-is-authentic");
  expect(text).not.toContain("providerId");
});

test("the global theme preference persists across product routes", async ({ page }) => {
  await page.goto("/");
  const settingsTrigger = page.getByRole("button", { name: /设置.*外观/ });
  await settingsTrigger.click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await settingsDialog.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.keyboard.press("Escape");
  await expect(settingsTrigger).toBeFocused();
  await page.goto("/worlds");
  await expect(page.locator("html")).toHaveClass(/dark/);
});
