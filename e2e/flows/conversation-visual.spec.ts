import { expect, test, type Page } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

const screenshotOptions = { animations: "disabled" as const, maxDiffPixelRatio: 0.01 };

async function preparedInstance(page: Page): Promise<string> {
  const imported = await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  expect(imported.ok()).toBe(true);
  const created = await page.request.post("/api/instances", {
    data: { worldId: "open-world-fixture", seed: 20260828 },
  });
  const detail = await created.json() as { summary: { id: string } };
  return detail.summary.id;
}

async function chooseEntry(page: Page, text: string): Promise<void> {
  const card = page.locator(".cg-entry-grid label").filter({ hasText: text }).first();
  await card.click();
  await expect(card.locator("input[type=radio]")).toBeChecked();
}

test("the headless instance workspace matches light and dark responsive baselines", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const instanceId = await preparedInstance(page);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.goto(`/play/${instanceId}`);
    await expect(page.getByRole("heading", { name: "世界正在发生什么" })).toBeVisible();
    await expect(page).toHaveScreenshot(`instance-${colorScheme}-desktop.png`, screenshotOptions);

    await page.setViewportSize({ width: 320, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page).toHaveScreenshot(`instance-${colorScheme}-mobile.png`, screenshotOptions);
  }
});

test("the participating Agent and inspector remain bounded in desktop and mobile layouts", async ({ page }) => {
  const instanceId = await preparedInstance(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto(`/play/${instanceId}`);
  await page.getByRole("button", { name: "进入世界" }).click();
  await chooseEntry(page, "庭院旅人");
  await page.getByLabel("显示名称").fill("小明");
  await page.getByLabel("外观描述").fill("背着旧旅行包");
  await page.getByLabel("一个自由动机").fill("找到石门后的道路");
  await page.getByRole("button", { name: "确认角色" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "关闭入场场景" }).click();
  await expect(page).toHaveScreenshot("instance-participant-dark-desktop.png", screenshotOptions);

  await page.getByRole("button", { name: "运行记录" }).click();
  const inspector = page.getByRole("dialog", { name: "世界演化" });
  await expect(inspector).toBeVisible();
  await expect(page).toHaveScreenshot("instance-inspector-dark-desktop.png", screenshotOptions);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot("instance-participant-dark-mobile.png", screenshotOptions);
});
