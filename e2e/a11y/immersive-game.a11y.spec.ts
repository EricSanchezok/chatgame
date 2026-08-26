import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

async function expectNoViolations(page: import("@playwright/test").Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test("the local menu and world library have no detectable accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从哪里开始？" })).toBeVisible();
  await expectNoViolations(page);
  const settingsTrigger = page.getByRole("button", { name: /设置.*外观/ });
  await settingsTrigger.click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(300);
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(settingsTrigger).toBeFocused();

  await page.goto("/worlds");
  await expect(page.getByRole("heading", { name: "世界包", exact: true, level: 2 })).toBeVisible();
  await expectNoViolations(page);
});

test("the empty and completed conversation have no detectable accessibility violations", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "false",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };
  await page.goto(`/play/${detail.summary.id}`);
  await expect(page.getByLabel("你的行动")).toBeVisible();
  await expectNoViolations(page);

  await page.getByLabel("你的行动").fill("执行一个自由行动");
  await page.getByRole("button", { name: "发送行动" }).click();
  await expect(page.getByText("目标已经完成")).toBeVisible();
  await page.waitForTimeout(200);
  await expectNoViolations(page);

  const orb = page.getByRole("button", { name: /打开游戏控制/ });
  await orb.click();
  await expect(page.getByRole("button", { name: "存档" })).toBeVisible();
  await page.waitForTimeout(300);
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(orb).toBeFocused();

  await orb.click();
  await page.getByRole("button", { name: "存档" }).click();
  await expect(page.getByRole("dialog", { name: "游戏管理" })).toBeVisible();
  await page.waitForTimeout(300);
  await expectNoViolations(page);
  await page.getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("switch", { name: "减少动态效果" })).toBeVisible();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(orb).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await orb.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(orb).toBeFocused();
});

test("the failed conversation and forced-color controls remain accessible", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const playURL = `/play/${detail.summary.id}`;
  await page.goto(`${playURL}/manage/settings`);
  await page.getByRole("switch", { name: /显示世界调试器/ }).click();
  await page.getByRole("button", { name: "关闭游戏管理" }).click();
  await expect(page).toHaveURL(playURL);
  const composer = page.getByLabel("你的行动");
  await composer.focus();
  const forcedFocus = await composer.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(forcedFocus.outlineStyle).not.toBe("none");
  expect(forcedFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  await composer.fill("触发 E2E 快速失败");
  await page.getByRole("button", { name: "发送行动" }).click();
  await expect(page.getByText("这一步未能完成")).toBeVisible();
  await expect(page.getByRole("button", { name: "放弃目标" })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole("button", { name: /打开游戏控制/ }).click();
  await page.getByRole("button", { name: /世界演化/ }).click();
  const inspector = page.getByRole("dialog", { name: "世界演化" });
  await expect(inspector.getByText("世界状态没有提交")).toBeVisible();
  const actorSeparator = inspector.getByRole("separator", { name: "调整主体列表宽度" });
  await inspector.getByRole("complementary", { name: "主体选择" }).getByRole("button").last().focus();
  await page.keyboard.press("Tab");
  await expect(actorSeparator).toBeFocused();
  const actorSeparatorFocus = await actorSeparator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(actorSeparatorFocus.outlineStyle).not.toBe("none");
  expect(actorSeparatorFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  await actorSeparator.press("ArrowRight");
  const detailSeparator = inspector.getByRole("separator", { name: "调整推演详情宽度" });
  await inspector.locator(".cg-inspector-log--attempt > button").focus();
  await page.keyboard.press("Tab");
  await expect(detailSeparator).toBeFocused();
  const detailSeparatorFocus = await detailSeparator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(detailSeparatorFocus.outlineStyle).not.toBe("none");
  expect(detailSeparatorFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  await inspector.getByRole("tab", { name: "原始" }).click();
  await inspector.locator(".cg-runtime-event").first().locator("summary").first().click();
  await expectNoViolations(page);
});

test("the world evolution workspace has no detectable accessibility violations", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };
  const playURL = `/play/${detail.summary.id}`;
  await page.goto(`${playURL}/manage/settings`);
  await page.getByRole("switch", { name: /显示世界调试器/ }).click();
  await page.getByRole("button", { name: "关闭游戏管理" }).click();
  await expect(page).toHaveURL(playURL);
  await page.getByLabel("你的行动").fill("观察石门");
  await page.getByRole("button", { name: "发送行动" }).click();
  await expect(page.getByText("目标已经完成")).toBeVisible();
  await page.getByRole("button", { name: /打开游戏控制/ }).click();
  await page.getByRole("button", { name: /世界演化/ }).click();
  await expect(page.getByRole("dialog", { name: "世界演化" })).toBeVisible();
  await expect(page.getByRole("button", { name: /世界，Revision 1/ })).toBeVisible();
  await expectNoViolations(page);
});
