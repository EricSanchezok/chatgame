import { expect, type APIRequestContext, type Page } from "@playwright/test";

export async function openRealLauncher(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('[data-slot="launcher"]')).toBeVisible();
}

export async function startRealFixtureGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "建立值班" }).click();
  await page.getByRole("button", { name: "观察员" }).click();
  await page.getByRole("button", { name: "确认出身" }).click();
  await page.getByRole("textbox", { name: "名字（可选）" }).fill("冻结测试员");
  await page.getByRole("button", { name: "进入世界" }).click();
  await expect(page.locator('[data-slot="game-shell"]')).toBeVisible();
}

export async function activeSessionIds(request: APIRequestContext): Promise<string[]> {
  const response = await request.get("/api/sessions");
  expect(response.ok()).toBe(true);
  const body = await response.json() as { sessions: Array<{ id: string }> };
  return body.sessions.map((session) => session.id);
}

export async function destroyActiveSessions(request: APIRequestContext): Promise<void> {
  for (const id of await activeSessionIds(request)) {
    const response = await request.delete(`/api/sessions/${encodeURIComponent(id)}`);
    expect(response.ok()).toBe(true);
  }
}
