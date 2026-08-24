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
    const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
    const detail = await created.json() as { summary: { id: string } };
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.goto(`/play/${detail.summary.id}`);
    await expect(page.getByRole("heading", { name: "你想做什么？" })).toBeVisible();
    await expect(page).toHaveScreenshot(`conversation-${colorScheme}-desktop.png`, screenshotOptions);

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
