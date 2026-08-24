import { expect, test } from "@playwright/test";
import { fixtureArchive } from "../support/world-fixture";

test("a player installs a world and continues a persistent conversation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "从哪里开始？" })).toBeVisible();
  await expect(page.getByRole("link", { name: /世界包/ })).toBeVisible();
  await page.getByRole("link", { name: /世界包/ }).click();
  await expect(page).toHaveURL(/\/worlds$/);

  const catalogResponse = await page.request.get("/api/worlds");
  const catalog = await catalogResponse.json() as { worlds: Array<{ id: string }> };
  const worldAlreadyInstalled = catalog.worlds.some((world) => world.id === "open-world-fixture");
  const worldArchiveInput = worldAlreadyInstalled
    ? page.locator('.cg-world-detail__tools input[type="file"]')
    : page.locator('.cg-import-world input[type="file"]');
  await worldArchiveInput.setInputFiles({
    name: "open-world-fixture.zip",
    mimeType: "application/zip",
    buffer: fixtureArchive(),
  });
  await expect(page.getByRole("heading", { name: "开放世界测试夹具", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /开始新游戏/ }).click();
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
  await expect(page.getByRole("link", { name: /世界包.*1 个世界/ })).toBeVisible();

  await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  await page.goto(`/play/${activeSessionId}/manage/saves`);
  await expect(page.getByRole("dialog", { name: "游戏管理" })).toBeVisible();
  const currentSave = page.locator('.cg-library-save[data-current="true"]');
  const otherSave = page.locator('.cg-library-save:not([data-current="true"])').first();
  await expect(otherSave).toBeVisible();
  const [currentRowBox, otherRowBox, currentContentBox, otherContentBox] = await Promise.all([
    currentSave.boundingBox(),
    otherSave.boundingBox(),
    currentSave.locator(".cg-library-save__content").boundingBox(),
    otherSave.locator(".cg-library-save__content").boundingBox(),
  ]);
  expect(currentRowBox).not.toBeNull();
  expect(otherRowBox).not.toBeNull();
  expect(currentContentBox).not.toBeNull();
  expect(otherContentBox).not.toBeNull();
  expect(currentRowBox!.x).toBeCloseTo(otherRowBox!.x, 1);
  expect(currentRowBox!.width).toBeCloseTo(otherRowBox!.width, 1);
  expect(currentContentBox!.x).toBeCloseTo(otherContentBox!.x, 1);
  await page.getByRole("article").filter({
    has: page.locator(`a[href="/play/${activeSessionId}"]`),
  })
    .getByRole("button", { name: /重命名/ }).click();
  await page.getByLabel("存档名称").fill("石门之外");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByRole("heading", { name: "石门之外", level: 3 })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "关闭游戏管理" }).click();
  await expect(page).toHaveURL(`/play/${activeSessionId}`);
  await expect(page.getByRole("button", { name: /打开游戏控制/ })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the world detail gives its first screen to saves instead of package maintenance", async ({ page }) => {
  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });

  await page.goto("/worlds/open-world-fixture");
  const intro = page.locator(".cg-world-detail__intro");
  const saves = page.locator(".cg-world-saves");
  const savesHeading = page.locator(".cg-world-saves__heading > div");
  const firstSave = page.locator(".cg-library-save").first();
  const packageMaintenance = page.locator(".cg-world-package");
  const packageFacts = page.locator(".cg-world-facts");
  const newGame = page.getByRole("button", { name: /开始新游戏/ });
  const newGameLabel = newGame.locator("strong");
  await expect(firstSave).toBeVisible();

  const [introBox, savesBox, savesHeadingBox, firstSaveBox, packageBox, factsBox, newGameBox] = await Promise.all([
    intro.boundingBox(),
    saves.boundingBox(),
    savesHeading.boundingBox(),
    firstSave.boundingBox(),
    packageMaintenance.boundingBox(),
    packageFacts.boundingBox(),
    newGame.boundingBox(),
  ]);
  expect(introBox).not.toBeNull();
  expect(savesBox).not.toBeNull();
  expect(savesHeadingBox).not.toBeNull();
  expect(firstSaveBox).not.toBeNull();
  expect(packageBox).not.toBeNull();
  expect(factsBox).not.toBeNull();
  expect(newGameBox).not.toBeNull();
  expect(savesBox!.y).toBeLessThan(packageBox!.y);
  expect(firstSaveBox!.y + firstSaveBox!.height).toBeLessThan(900);
  expect(savesBox!.y - (introBox!.y + introBox!.height)).toBeLessThanOrEqual(40);
  expect(newGameBox!.y).toBeLessThan(savesHeadingBox!.y + savesHeadingBox!.height);
  expect(newGameBox!.y + newGameBox!.height).toBeGreaterThan(savesHeadingBox!.y);
  expect(factsBox!.height).toBeLessThanOrEqual(32);
  expect(packageBox!.height).toBeLessThan(200);
  expect(await newGameLabel.evaluate((element) => getComputedStyle(element).color))
    .toBe(await newGame.evaluate((element) => getComputedStyle(element).color));

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await packageFacts.boundingBox())!.height).toBeLessThanOrEqual(50);
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
  await expect(page.locator(".cg-orb__action")).toHaveCount(3);
  await page.waitForTimeout(300);
  const statusCard = page.locator(".cg-orb__card");
  const cardBox = await statusCard.boundingBox();
  const openOrbBox = await page.locator(".cg-orb__trigger").boundingBox();
  expect(cardBox).not.toBeNull();
  expect(openOrbBox).not.toBeNull();
  const actionBoxes: Array<{ height: number; width: number; x: number; y: number }> = [];
  for (const action of await page.locator(".cg-orb__action").all()) {
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    actionBoxes.push(box!);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1_440);
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    const overlapsCard = box!.x < cardBox!.x + cardBox!.width &&
      box!.x + box!.width > cardBox!.x &&
      box!.y < cardBox!.y + cardBox!.height &&
      box!.y + box!.height > cardBox!.y;
    expect(overlapsCard).toBe(false);
  }
  const orbCenter = {
    x: openOrbBox!.x + (openOrbBox!.width / 2),
    y: openOrbBox!.y + (openOrbBox!.height / 2),
  };
  const actionRadii = actionBoxes.map((box) => Math.hypot(
    box.x + (box.width / 2) - orbCenter.x,
    box.y + (box.height / 2) - orbCenter.y,
  ));
  expect(Math.max(...actionRadii) - Math.min(...actionRadii)).toBeLessThan(1);
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

test("in-game management preserves an active world run", async ({ page }) => {
  await page.request.post("/api/worlds/import", {
    multipart: {
      file: { name: "open-world-fixture.zip", mimeType: "application/zip", buffer: fixtureArchive() },
      replace: "true",
    },
  });
  const created = await page.request.post("/api/sessions", { data: { worldId: "open-world-fixture" } });
  const detail = await created.json() as { summary: { id: string } };
  const playURL = `/play/${detail.summary.id}`;

  await page.goto(playURL);
  await page.getByLabel("你的行动").fill("触发 E2E 流式失败");
  await page.getByLabel("你的行动").press("Enter");
  const orb = page.getByRole("button", { name: /打开游戏控制；世界正在推演/ });
  await expect(orb).toBeVisible();
  await orb.click();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page).toHaveURL(`${playURL}/manage/settings`);
  await expect(page.getByRole("dialog", { name: "游戏管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  const reduceMotion = page.getByRole("switch", { name: "减少动态效果" });
  await expect(reduceMotion).toHaveAttribute("aria-checked", "false");
  await reduceMotion.click();
  await expect(reduceMotion).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-cg-motion", "reduced");
  await reduceMotion.press("Space");
  await expect(reduceMotion).toHaveAttribute("aria-checked", "false");

  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${detail.summary.id}`);
    const session = await response.json() as { runs: Array<{ status: string }> };
    return session.runs.at(-1)?.status;
  }).toBe("failed");
  await page.getByRole("button", { name: "关闭游戏管理" }).click();
  await expect(page).toHaveURL(playURL);
  await expect(page.getByText("这一步未能完成")).toBeVisible();
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
  await composer.blur();
  const restingShadow = await shell.evaluate((element) => getComputedStyle(element).boxShadow);
  await expect.poll(() => shell.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe("0");
  const restingBorderColor = await shell.evaluate((element) => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.fillStyle = getComputedStyle(element).borderColor;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
  await composer.focus();
  await expect.poll(() => shell.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe("1");
  const focusedStyle = await shell.evaluate((element) => ({
    borderColor: (() => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.fillStyle = getComputedStyle(element).borderColor;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    })(),
    boxShadow: getComputedStyle(element).boxShadow,
    focusMarkerHeight: Number.parseFloat(getComputedStyle(element, "::after").height),
    focusMarkerWidth: Number.parseFloat(getComputedStyle(element, "::after").width),
    shellWidth: element.getBoundingClientRect().width,
    textareaBoxShadow: getComputedStyle(element.querySelector("textarea")!).boxShadow,
    textareaOutline: getComputedStyle(element.querySelector("textarea")!).outlineStyle,
  }));
  expect(focusedStyle.boxShadow).toBe(restingShadow);
  expect(focusedStyle.borderColor).toEqual(restingBorderColor);
  expect(focusedStyle.focusMarkerHeight).toBe(2);
  expect(focusedStyle.focusMarkerWidth).toBeLessThan(focusedStyle.shellWidth / 4);
  expect(focusedStyle.textareaBoxShadow).toBe("none");
  expect(focusedStyle.textareaOutline).toBe("none");
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
  await expect(page.getByRole("heading", { name: "世界包" })).toBeVisible();
});
