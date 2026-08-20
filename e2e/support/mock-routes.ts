import type { Page, Route } from "@playwright/test";
import { MockGamePort, type MockGameScenario } from "../../test/workbench/mock-game-port";

async function fulfillFromPort(route: Route, port: MockGamePort): Promise<void> {
  const request = route.request();
  const response = await port.fetch(request.url(), {
    method: request.method(),
    headers: request.headers(),
    body: request.postData() ?? undefined,
  });
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  });
}

export async function installMockGameRoutes(
  page: Page,
  scenario: MockGameScenario = {},
): Promise<MockGamePort> {
  const port = new MockGamePort(scenario);
  await page.route("**/api/scripts/*/ui-bundle", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "export default function register() {}",
    });
  });
  await page.route("**/api/**", async (route) => fulfillFromPort(route, port));
  return port;
}

export async function openLauncher(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
}

export async function startFixtureGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "开始新游戏" }).click();
  const dialog = page.getByRole("dialog", { name: "新游戏" });
  await dialog.getByRole("combobox").waitFor();
  await dialog.getByRole("button", { name: "开始冒险" }).click();
  await page.getByRole("textbox", { name: "玩家输入" }).waitFor();
}

export async function settleVisualPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(100);
}
