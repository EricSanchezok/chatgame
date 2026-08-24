import { expect, test } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

const screenshotOptions = { animations: "disabled" as const, maxDiffPixelRatio: 0.01 };

test("the conversation and controls match light/dark desktop/mobile baselines", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  for (const colorScheme of ["light", "dark"] as const) {
    const created = await page.request.post("/api/sessions", {
      data: { worldId: "open-world-fixture", seed: colorScheme === "light" ? 181 : 182 },
    });
    const detail = await created.json() as { summary: { id: string } };
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.goto(`/play/${detail.summary.id}`);
    await expect(page.getByRole("heading", { name: "你想做什么？" })).toBeVisible();
    await expect(page).toHaveScreenshot(`conversation-${colorScheme}-desktop.png`, screenshotOptions);
    await page.getByLabel("你的行动").focus();
    await expect(page.locator(".aui-composer-shell")).toHaveScreenshot(
      `conversation-${colorScheme}-composer-focus.png`,
      { animations: "disabled", maxDiffPixelRatio: 0.005 },
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page).toHaveScreenshot(`conversation-${colorScheme}-mobile.png`, screenshotOptions);

    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.getByLabel("你的行动").fill("观察眼前的石门");
    await page.getByRole("button", { name: "发送行动" }).click();
    await expect(page.getByText("目标已经完成")).toBeVisible();
    await expect(page).toHaveScreenshot(`conversation-${colorScheme}-completed-desktop.png`, screenshotOptions);
    await page.getByRole("button", { name: /打开游戏控制/ }).click();
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot(`conversation-${colorScheme}-orb-open-desktop.png`, screenshotOptions);
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page).toHaveScreenshot(`conversation-${colorScheme}-completed-mobile.png`, screenshotOptions);
    await page.getByRole("button", { name: /打开游戏控制/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveScreenshot(`conversation-${colorScheme}-sheet-mobile.png`, screenshotOptions);
    await page.keyboard.press("Escape");
  }
});

test("the world evolution workspace matches light/dark desktop/mobile baselines", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  for (const colorScheme of ["light", "dark"] as const) {
    const created = await page.request.post("/api/sessions", {
      data: { worldId: "open-world-fixture", seed: colorScheme === "light" ? 281 : 282 },
    });
    const detail = await created.json() as { summary: { id: string } };
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/settings");
    await page.getByRole("checkbox", { name: /显示世界调试器/ }).check();
    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.goto(`/play/${detail.summary.id}`);
    await page.getByLabel("你的行动").fill("观察石门，并留意守门人的反应");
    await page.getByRole("button", { name: "发送行动" }).click();
    await expect(page.getByText("目标已经完成")).toBeVisible();
    await page.getByRole("button", { name: /打开游戏控制/ }).click();
    await page.getByRole("button", { name: /世界演化/ }).click();
    const inspector = page.getByRole("dialog", { name: "世界演化" });
    await inspector.locator('.cg-inspector-graph[data-layout-ready="true"]').waitFor();
    await expect(inspector.getByRole("button", { name: /世界，Revision 1/ })).toBeVisible();
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot(`world-inspector-${colorScheme}-desktop.png`, {
      ...screenshotOptions,
      maxDiffPixelRatio: 0.003,
    });
    await inspector.getByRole("complementary", { name: "主体选择" })
      .getByRole("button", { name: /守门人/ }).click();
    await inspector.getByRole("button", { name: "聚焦此 Agent" }).click();
    await inspector.locator('.cg-inspector-graph[data-layout-ready="true"]').waitFor();
    await expect(inspector.getByText("守门人本轮实际行动")).toBeVisible();
    await expect(page).toHaveScreenshot(`world-inspector-${colorScheme}-agent-desktop.png`, {
      ...screenshotOptions,
      maxDiffPixelRatio: 0.003,
    });
    await inspector.getByRole("button", { name: "显示全部主体" }).click();
    await inspector.getByRole("complementary", { name: "主体选择" })
      .getByRole("button", { name: /整个世界/ }).click();
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /打开游戏控制/ }).click();
    await page.getByRole("button", { name: /打开世界演化/ }).click();
    await expect(page.getByRole("feed", { name: "世界提交时间线" })).toBeVisible();
    await expect(page).toHaveScreenshot(`world-inspector-${colorScheme}-mobile.png`, screenshotOptions);
    await page.keyboard.press("Escape");
  }
});
