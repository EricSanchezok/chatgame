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
  await page.goto(`/play/${detail.summary.id}`);
  await page.getByLabel("你的行动").fill("触发 E2E 快速失败");
  await page.getByRole("button", { name: "发送行动" }).click();
  await expect(page.getByText("这一步未能完成")).toBeVisible();
  await expect(page.getByRole("button", { name: "放弃目标" })).toBeVisible();
  await expectNoViolations(page);
});
