import { expect, test } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

test("a player installs a world and continues a persistent conversation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /世界在等待.*你的下一句话/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /开始新游戏/ })).toBeVisible();
  await page.getByRole("link", { name: /开始新游戏/ }).click();
  await expect(page).toHaveURL(/\/worlds$/);

  await page.locator('input[type="file"]').setInputFiles({
    name: "open-world-fixture.zip",
    mimeType: "application/zip",
    buffer: fixtureArchive(),
  });
  await expect(page.getByRole("heading", { name: "开放世界测试夹具" })).toBeVisible();
  await page.getByRole("button", { name: /开始旅程/ }).click();
  await expect(page).toHaveURL(/\/play\/[^/]+$/);
  const activeSessionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!activeSessionId) throw new Error("new session URL does not contain an id");
  await expect(page.getByRole("heading", { name: "你想做什么？" })).toBeVisible();

  let streamRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/sessions\/[^/]+\/runs\/[^/]+\/events(?:\?|$)/.test(request.url())) {
      streamRequests += 1;
    }
  });
  const composer = page.getByLabel("你的行动");
  await composer.fill("我尝试一个剧本没有预配置的自由行动");
  await composer.press("Enter");
  await expect(page.getByText("世界回应了你的自由行动。")).toBeVisible();
  await expect(page.getByText("模拟 Truth Engine 已联合裁决行动。")).toHaveCount(0);
  await expect(page.getByText("目标已经完成")).toBeVisible();
  await expect(page.getByRole("button", { name: /第 1 步/ })).toBeVisible();
  const streamsAtCompletion = streamRequests;
  expect(streamsAtCompletion).toBeGreaterThan(0);
  await page.waitForTimeout(3_500);
  expect(streamRequests).toBe(streamsAtCompletion);
  await expect(page.getByText(/进度连接暂时中断|最新存档状态暂时无法同步/)).toHaveCount(0);

  const sessionsResponse = await page.request.get("/api/sessions");
  const sessions = await sessionsResponse.json() as { sessions: Array<{ id: string; revision: number }> };
  const summary = sessions.sessions.find((session) => session.id === activeSessionId);
  expect(summary).toBeDefined();
  expect(summary?.revision).toBe(1);
  expect(JSON.stringify(sessions)).not.toContain("canonicalEntityIds");
  expect(JSON.stringify(sessions)).not.toContain("key-authenticity");

  await page.reload();
  await expect(page.getByText("世界回应了你的自由行动。")).toBeVisible();
  await expect(page.getByText("模拟 Truth Engine 已联合裁决行动。")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /继续当前世界/ })).toBeVisible();

  await page.goto("/saves");
  await page.getByRole("article").filter({
    has: page.locator(`a[href="/play/${activeSessionId}"]`),
  })
    .getByRole("button", { name: /重命名/ }).click();
  await page.getByLabel("存档名称").fill("石门之外");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByRole("heading", { name: "石门之外" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the control orb exposes desktop and mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };

  await page.goto(`/play/${detail.summary.id}`);
  const orb = page.getByRole("button", { name: /打开游戏控制/ });
  const initialBox = await orb.boundingBox();
  expect(initialBox).not.toBeNull();

  await page.keyboard.down("Alt");
  await orb.press("ArrowLeft");
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await orb.boundingBox())?.x).toBeCloseTo(16, 0);
  await page.reload();
  await expect.poll(async () => (await orb.boundingBox())?.x).toBeCloseTo(16, 0);

  const draggedFrom = await orb.boundingBox();
  if (!draggedFrom) throw new Error("control orb has no layout box");
  await page.mouse.move(draggedFrom.x + 28, draggedFrom.y + 28);
  await page.mouse.down();
  await page.mouse.move(900, 300, { steps: 4 });
  const midDrag = await orb.boundingBox();
  expect(midDrag?.x).toBeGreaterThan(400);
  await page.mouse.up();
  await expect.poll(async () => (await orb.boundingBox())?.x).toBeCloseTo(1_368, 0);

  await orb.click();
  await expect(page.getByRole("button", { name: "存档" })).toBeVisible();
  for (const action of await page.locator(".cg-orb__action").all()) {
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1_440);
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  }
  await page.getByRole("button", { name: /关闭游戏控制/ }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const playURL = page.url();
  await page.getByRole("button", { name: /打开游戏控制/ }).click();
  await expect(page).toHaveURL(playURL);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /存档/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /打开游戏控制/ })).toBeFocused();
});

test("the official thread axis keeps the composer anchored after every message", async ({ page }) => {
  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };
  await page.goto(`/play/${detail.summary.id}`);

  const composer = page.getByLabel("你的行动");
  const shell = page.locator(".aui-composer-shell");
  const emptyBox = await shell.boundingBox();
  expect(emptyBox).not.toBeNull();
  expect(Math.abs((emptyBox!.y + emptyBox!.height / 2) - 450)).toBeLessThan(80);

  await composer.fill("正在使用输入法");
  await composer.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    code: "Enter",
    isComposing: true,
    key: "Enter",
  })));
  await expect(composer).toHaveValue("正在使用输入法");
  await expect(page.getByRole("heading", { name: "你想做什么？" })).toBeVisible();

  await composer.fill("先观察石门");
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("先观察石门\n");
  await composer.fill("先观察石门");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: /第 1 步/ })).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  const assistantMessage = page.locator('[data-role="assistant"]').last();
  await assistantMessage.hover();
  await assistantMessage.getByRole("button", { name: "复制世界回复" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    "世界回应了你的自由行动。\n\n目标已经完成",
  );
  const firstBottom = (await shell.boundingBox())!.y + (await shell.boundingBox())!.height;
  expect(Math.abs(firstBottom - 876)).toBeLessThanOrEqual(2);

  await composer.fill("再查看门后的空间");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: /第 2 步/ })).toBeVisible();
  const secondBox = await shell.boundingBox();
  expect(Math.abs((secondBox!.y + secondBox!.height) - firstBottom)).toBeLessThanOrEqual(2);

  for (const width of [2_560, 5_120]) {
    await page.setViewportSize({ width, height: 900 });
    const currentShell = await shell.boundingBox();
    expect(currentShell!.width).toBeLessThanOrEqual(704);
    expect(Math.abs((currentShell!.x + currentShell!.width / 2) - width / 2)).toBeLessThanOrEqual(2);
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator("html").evaluate((element) => { element.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a streamed terminal failure does not reconnect and can be abandoned", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };
  let streamRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/sessions\/[^/]+\/runs\/[^/]+\/events(?:\?|$)/.test(request.url())) {
      streamRequests += 1;
    }
  });

  await page.goto(`/play/${detail.summary.id}`);
  const composer = page.getByLabel("你的行动");
  await composer.fill("触发 E2E 流式失败");
  await composer.press("Enter");

  await expect.poll(() => streamRequests).toBeGreaterThan(0);
  await expect(page.getByText("这一步未能完成")).toBeVisible();
  await expect(page.getByText("这一步没有提交，世界仍停留在上一个已保存状态。")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试这一步" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "放弃目标" })).toBeVisible();
  await expect(page.getByText("世界正在推演…")).toHaveCount(0);

  const streamsAtFailure = streamRequests;
  await page.waitForTimeout(3_500);
  expect(streamRequests).toBe(streamsAtFailure);

  await page.getByRole("button", { name: "放弃目标" }).click();
  await expect(page.getByText("目标已经结束")).toBeVisible();
  await composer.fill("观察石门");
  await composer.press("Enter");
  await expect(page.getByText("世界回应了你的自由行动。")).toBeVisible();
  await expect(page.getByText("目标已经完成")).toBeVisible();
});

test("a terminal snapshot never opens an EventSource", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };
  const started = await page.request.post(`/api/sessions/${detail.summary.id}/runs`, {
    data: { text: "触发 E2E 快速失败" },
  });
  const { runId } = await started.json() as { runId: string };
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${detail.summary.id}/runs/${runId}`);
    const snapshot = await response.json() as { run: { status: string } };
    return snapshot.run.status;
  }).toBe("failed");
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${detail.summary.id}`);
    const session = await response.json() as { runs: Array<{ id: string; status: string }> };
    return session.runs.find((run) => run.id === runId)?.status;
  }).toBe("failed");
  let streamRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/sessions\/[^/]+\/runs\/[^/]+\/events(?:\?|$)/.test(request.url())) {
      streamRequests += 1;
    }
  });

  await page.goto(`/play/${detail.summary.id}`);
  await expect(page.getByText("这一步未能完成")).toBeVisible();
  expect(streamRequests).toBe(0);
  await page.waitForTimeout(3_500);
  expect(streamRequests).toBe(0);
  await expect(page.getByText(/进度连接暂时中断|最新存档状态暂时无法同步/)).toHaveCount(0);
});

test("the global theme preference persists across product routes", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.getByRole("button", { name: "深色" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.goto("/worlds");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "选择世界" })).toBeVisible();
});
