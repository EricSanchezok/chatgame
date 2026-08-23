import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

async function expectNoViolations(page: import("@playwright/test").Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test("the local menu and world library have no detectable accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /世界在等待.*你的下一句话/ })).toBeVisible();
  await expectNoViolations(page);

  await page.goto("/worlds");
  await expect(page.getByRole("heading", { name: "选择世界" })).toBeVisible();
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
  await expectNoViolations(page);
});
