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
  await page.route("**/api/**", async (route) => fulfillFromPort(route, port));
  await page.route("**/api/scripts/*/ui-bundle", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "export const apiVersion = 3; export default function register() {}",
    });
  });
  return port;
}

export async function openLauncher(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("heading", { name: /工作台剧本/ }).waitFor();
}

export async function startFixtureGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "开始新游戏" }).click();
  const dialog = page.getByRole("dialog", { name: /开始《工作台剧本》/ });
  await dialog.getByRole("combobox").waitFor();
  await dialog.getByRole("button", { name: "进入世界" }).click();
  await page.getByRole("textbox", { name: "输入你的话或行动" }).waitFor();
}

export async function settleVisualPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finiteAnimations = document.getAnimations().filter((animation) =>
      animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finiteAnimations.map((animation) => animation.finished.catch(() => undefined)));
  });
}
