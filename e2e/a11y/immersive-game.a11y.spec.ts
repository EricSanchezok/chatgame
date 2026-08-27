import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function createInstance(page: Page): Promise<string> {
  const imported = await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  expect(imported.ok()).toBe(true);
  const created = await page.request.post("/api/instances", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };
  return detail.summary.id;
}

async function chooseEntry(page: Page, text: string): Promise<void> {
  const card = page.locator(".cg-entry-grid label").filter({ hasText: text }).first();
  await card.click();
  await expect(card.locator("input[type=radio]")).toBeChecked();
}

test("the menu, world library, and headless instance have no detectable accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从哪里开始？" })).toBeVisible();
  await expectNoViolations(page);
  const settingsTrigger = page.getByRole("button", { name: /设置.*外观/ });
  await settingsTrigger.click();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(settingsTrigger).toBeFocused();

  const instanceId = await createInstance(page);
  await page.goto(`/play/${instanceId}`);
  await expect(page.getByRole("heading", { name: "你还没有进入世界" })).toBeVisible();
  await expectNoViolations(page);
});

test("Origin admission, Arrival, Agent control, and release remain accessible", async ({ page }) => {
  const instanceId = await createInstance(page);
  await page.goto(`/play/${instanceId}`);
  await page.getByRole("button", { name: "进入世界" }).click();
  await expectNoViolations(page);
  await chooseEntry(page, "庭院旅人");
  await page.getByLabel("显示名称").fill("小明");
  await page.getByLabel("外观描述").fill("背着旧旅行包");
  await page.getByLabel("一个自由动机").fill("找到石门后的道路");
  await page.getByRole("button", { name: "确认角色" }).click();
  const arrival = page.getByRole("dialog");
  await expect(arrival).toBeVisible();
  await expectNoViolations(page);
  await arrival.getByRole("button", { name: "关闭入场场景" }).click();
  await expectNoViolations(page);
  await page.getByRole("button", { name: "离开并交给 AgentMind" }).click();
  await expect(page.getByRole("heading", { name: "你还没有进入世界" })).toBeVisible();
});

test("the inspector is accessible in forced colors and at 200 percent zoom", async ({ page }) => {
  const instanceId = await createInstance(page);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(`/play/${instanceId}`);
  await page.getByRole("button", { name: "运行记录" }).click();
  const inspector = page.getByRole("dialog", { name: "世界演化" });
  await expect(inspector).toBeVisible();
  await expectNoViolations(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectNoViolations(page);
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "运行记录" })).toBeFocused();
});
