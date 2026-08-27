import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function installFixture(page: Page): Promise<void> {
  const imported = await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  expect(imported.ok()).toBe(true);
}

async function createInstance(page: Page, kind: "observer" | "origin" = "observer"): Promise<string> {
  await installFixture(page);
  const created = await page.request.post("/api/instances", {
    data: kind === "observer"
      ? { worldId: "open-world-fixture", start: { kind: "observer" } }
      : {
          worldId: "open-world-fixture",
          start: {
            kind: "origin",
            originId: "courtyard-wanderer",
            displayName: "小明",
            appearance: "背着旧旅行包",
            motivation: "找到石门后的道路",
          },
        },
  });
  expect(created.status()).toBe(201);
  const detail = await created.json() as { summary: { id: string } };
  return detail.summary.id;
}

test("menu, world library, Origin dialog and observer conversation are accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从哪里开始？" })).toBeVisible();
  await expectNoViolations(page);
  const settingsTrigger = page.getByRole("button", { name: /设置.*外观/ });
  await settingsTrigger.click();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(settingsTrigger).toBeFocused();

  await installFixture(page);
  await page.goto("/worlds/open-world-fixture");
  const startTrigger = page.getByRole("button", { name: /开始新游戏/ });
  await startTrigger.click();
  await expectNoViolations(page);
  const chooser = page.getByRole("dialog", { name: "选择你的身份" });
  await chooser.locator(".cg-start-card").filter({ hasText: "庭院旅人" }).click();
  await chooser.getByRole("button", { name: "继续塑造角色" }).click();
  await expect(page.getByRole("dialog", { name: "成为庭院旅人" })).toBeVisible();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(startTrigger).toBeFocused();

  const instanceId = await createInstance(page);
  await page.goto(`/play/${instanceId}`);
  await expect(page.getByRole("button", { name: "单步" })).toBeVisible();
  await expectNoViolations(page);
});

test("Arrival, player composer, role and control overlays remain accessible", async ({ page }) => {
  const instanceId = await createInstance(page, "origin");
  await page.goto(`/play/${instanceId}`);
  await expect(page.getByText("此刻，你是小明")).toBeVisible();
  await expect(page.getByLabel("你的行动")).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole("button", { name: /打开游戏控制/ }).click();
  await page.getByRole("button", { name: "角色" }).click();
  await expect(page.getByRole("dialog", { name: "角色" })).toBeVisible();
  await expect(page.locator(".cg-orb__card")).toBeHidden();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /打开游戏控制/ })).toBeFocused();
});

test("the inspector is accessible in forced colors and at 200 percent zoom", async ({ page }) => {
  const instanceId = await createInstance(page);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(`/play/${instanceId}`);
  await page.evaluate(() => {
    localStorage.setItem("livingworld:preferences:v2", JSON.stringify({
      fontScale: "standard",
      reduceMotion: true,
      showWorldInspector: true,
      advancedRoleControl: false,
    }));
    window.dispatchEvent(new CustomEvent("livingworld:preferences-changed"));
  });
  await page.getByRole("button", { name: /打开游戏控制/ }).click();
  await page.getByRole("button", { name: "世界演化" }).click();
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
});
