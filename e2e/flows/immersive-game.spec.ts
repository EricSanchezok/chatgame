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

async function createObserver(page: Page): Promise<{ id: string; revision: number }> {
  const response = await page.request.post("/api/instances", {
    data: { worldId: "open-world-fixture", seed: 20260827, start: { kind: "observer" } },
  });
  expect(response.status()).toBe(201);
  const detail = await response.json() as { summary: { id: string; revision: number } };
  return detail.summary;
}

async function startOrigin(page: Page): Promise<void> {
  await page.goto("/worlds/open-world-fixture");
  await page.getByRole("button", { name: /开始新游戏/ }).click();
  const dialog = page.getByRole("dialog", { name: "选择你的身份" });
  await expect(page).toHaveURL(/\/worlds\/open-world-fixture$/);
  await expect(dialog).toBeVisible();
  await dialog.locator(".cg-start-card").filter({ hasText: "庭院旅人" }).click();
  await dialog.getByRole("button", { name: "继续塑造角色" }).click();
  const customization = page.getByRole("dialog", { name: "成为庭院旅人" });
  await customization.getByLabel("你的名字").fill("小明");
  await customization.getByLabel("外观描述").fill("背着旧旅行包");
  await customization.getByLabel("一个自由动机").fill("找到石门后的道路");
  await customization.getByRole("button", { name: "进入世界" }).click();
  await expect(page).toHaveURL(/\/play\/[^/]+$/);
  await expect(page.getByText("此刻，你是小明")).toBeVisible();
}

async function openOrb(page: Page): Promise<void> {
  await page.getByRole("button", { name: /打开游戏控制/ }).click();
}

test("a world starts in observer mode without replacing the conversation core", async ({ page }) => {
  await installFixture(page);
  await page.goto("/worlds/open-world-fixture");
  await page.getByRole("button", { name: /开始新游戏/ }).click();
  const dialog = page.getByRole("dialog", { name: "选择你的身份" });
  await dialog.locator(".cg-start-card").filter({ hasText: "观察世界" }).click();
  await dialog.getByRole("button", { name: "开始观察" }).click();
  await expect(page).toHaveURL(/\/play\/[^/]+$/);
  await expect(page.getByRole("button", { name: "单步" })).toBeVisible();
  await expect(page.getByText("世界正在发生什么")).toHaveCount(0);

  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByText("世界继续变化。").first()).toBeVisible();

  await page.getByRole("button", { name: "实时" }).click();
  await expect(page.getByRole("button", { name: "暂停" })).toBeVisible();
  await page.getByRole("button", { name: "暂停" }).click();

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a Participant starts from an Origin, receives Arrival, acts, detaches and takes over", async ({ page }) => {
  await installFixture(page);
  await startOrigin(page);

  const composer = page.getByLabel("你的行动");
  await page.getByRole("button", { name: "确认当前位置" }).click();
  await expect(composer).toHaveValue("确认当前位置");
  await composer.fill("我现在在哪里？");
  await page.getByRole("button", { name: "发送行动" }).click();
  await expect(page.getByText("世界继续变化。").last()).toBeVisible();

  await openOrb(page);
  await page.getByRole("button", { name: /视角.*随身存在/ }).click();
  const perspective = page.getByRole("dialog", { name: "视角" });
  await expect(perspective.getByRole("region", { name: "角色关系星图" })).toBeVisible();
  await expect(perspective.getByText("精确关系", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(perspective.getByRole("heading", { name: "关系列表" })).toBeVisible();
  await expect(perspective.getByRole("region", { name: "角色关系星图" })).toBeHidden();
  expect(await perspective.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1_280, height: 720 });

  await openOrb(page);
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("switch", { name: "高级角色控制" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "切换或离开角色" }).click();
  const control = page.getByRole("dialog", { name: "切换或离开角色" });
  await control.getByRole("button", { name: /进入观察模式/ }).click();
  await expect(page.getByRole("button", { name: "接管" })).toBeVisible();

  await page.getByLabel("观察角色").selectOption("keeper");
  await page.getByRole("button", { name: "接管" }).click();
  await expect(page.getByText(/此刻，你是守门人/)).toBeVisible();
  await expect(page.getByLabel("你的行动")).toBeVisible();
});

test("failed execution stays atomic and long diagnostics never widen the inspector", async ({ page }) => {
  await installFixture(page);
  await startOrigin(page);
  await page.getByLabel("你的行动").fill("触发 E2E 快速失败");
  await page.getByRole("button", { name: "发送行动" }).click();
  await expect(page.getByText("这次行动没有改变世界。")).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem("livingworld:preferences:v2", JSON.stringify({
      fontScale: "standard",
      reduceMotion: false,
      showWorldInspector: true,
      advancedRoleControl: false,
    }));
    window.dispatchEvent(new CustomEvent("livingworld:preferences-changed"));
  });
  await openOrb(page);
  await page.getByRole("button", { name: "世界演化" }).click();
  const inspector = page.getByRole("dialog", { name: "世界演化" });
  await expect(inspector.getByText("世界状态没有提交")).toBeVisible();
  expect(await inspector.locator(".cg-inspector-detail").evaluate((element) => (
    element.scrollWidth <= element.clientWidth
  ))).toBe(true);

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("instance APIs expose only Agent-scoped views", async ({ page }) => {
  await installFixture(page);
  const instance = await createObserver(page);
  const response = await page.request.get(`/api/instances/${instance.id}/observer`);
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
