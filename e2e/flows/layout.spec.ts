import { expect, test, type Page } from "@playwright/test";
import { installMockGameRoutes, openLauncher, startFixtureGame } from "../support/mock-routes";
import { ALT_SCRIPT_ID } from "../../test/workbench/core-test-script";

async function expectNoUnstyledNativeControls(page: Page): Promise<void> {
  const count = await page.locator('select,input[type="checkbox"],input[type="range"]').evaluateAll((nodes) => nodes.filter((node) => {
    const style = getComputedStyle(node);
    return node.getAttribute("aria-hidden") !== "true" && style.clipPath === "none" && style.display !== "none" && style.visibility !== "hidden";
  }).length);
  expect(count).toBe(0);
}

async function startConversation(page: Parameters<typeof startFixtureGame>[0], viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await installMockGameRoutes(page, { conversation: "long", hostShell: true });
  await openLauncher(page);
  await startFixtureGame(page);
}

test("desktop chat shell keeps one axis for messages, media and composer", async ({ page }) => {
  await startConversation(page, { width: 1440, height: 900 });
  await page.mouse.move(720, 24);
  await expect(page.locator(".cg-conversation-scroll")).toHaveAttribute("data-scroll-active", "false", { timeout: 1_500 });

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, width: box.width, height: box.height };
    };
    const boxes = (selector: string) => [...document.querySelectorAll(selector)].map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, width: box.width, height: box.height };
    });
    const world = boxes('.cg-message[data-role="world"]');
    const worldBodies = [...document.querySelectorAll('.cg-message[data-role="world"] .cg-message__body')].map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    });
    const playerBodies = [...document.querySelectorAll('.cg-message[data-role="player"] .cg-message__body')].map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    });
    const media = boxes('.cg-entry-media');
    const mediaItems = boxes('.cg-entry-media__item');
    const scroll = document.querySelector('.cg-conversation-scroll');
    const scrolling = document.scrollingElement;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      body: { width: document.body.clientWidth, scrollWidth: document.body.scrollWidth, height: document.body.clientHeight, scrollHeight: document.body.scrollHeight },
      transcript: rect('.cg-conversation-scroll'),
      inner: rect('.cg-conversation-lane'),
      composer: rect('.cg-composer'),
      composerForm: rect('.cg-composer__form'),
      composerSurfaceCount: document.querySelectorAll('.cg-composer__surface').length,
      visibleComposerHints: [...document.querySelectorAll('.cg-composer__hint')].filter((node) => getComputedStyle(node).display !== 'none').length,
      world,
      worldBodies,
      playerBodies,
      media,
      mediaItems,
      suggestionIcons: document.querySelectorAll('.cg-suggestions button svg').length,
      worldGroups: document.querySelectorAll('.cg-message-group[data-role="world"]').length,
      worldIdentities: document.querySelectorAll('.cg-world-identity, .cg-speaker').length,
      transcriptScroll: scroll ? { scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, overflowY: getComputedStyle(scroll).overflowY, scrollbarWidth: getComputedStyle(scroll).scrollbarWidth } : null,
      documentScroll: scrolling ? { scrollHeight: scrolling.scrollHeight, clientHeight: scrolling.clientHeight } : null,
    };
  });

  expect(geometry.body.scrollWidth).toBe(geometry.body.width);
  expect(geometry.body.scrollHeight).toBe(geometry.body.height);
  expect(geometry.transcriptScroll?.overflowY).toBe("auto");
  expect(geometry.transcriptScroll?.scrollbarWidth).toBe("none");
  expect(geometry.transcriptScroll?.scrollHeight).toBeGreaterThan(geometry.transcriptScroll?.clientHeight ?? 0);
  expect(geometry.documentScroll?.scrollHeight).toBe(geometry.documentScroll?.clientHeight);
  expect(geometry.world.length).toBeGreaterThan(1);

  const worldLefts = geometry.worldBodies.map((box) => box.left);
  expect(Math.max(...worldLefts) - Math.min(...worldLefts)).toBeLessThan(1);
  const mediaLefts = geometry.media.map((box) => box.left);
  expect(mediaLefts.length).toBeGreaterThan(0);
  expect(Math.max(...geometry.media.map((box) => box.width))).toBeLessThanOrEqual(640);
  expect(Math.max(...mediaLefts) - Math.min(...mediaLefts)).toBeLessThan(1);
  expect(Math.abs(mediaLefts[0] - worldLefts[0])).toBeLessThan(1);
  expect(geometry.mediaItems.length).toBeGreaterThan(1);
  expect(geometry.mediaItems[1].width).toBeLessThan(geometry.mediaItems[0].width);
  expect(geometry.playerBodies.length).toBeGreaterThan(0);
  const playerRights = geometry.playerBodies.map((box) => box.right);
  expect(Math.max(...playerRights) - Math.min(...playerRights)).toBeLessThan(1);
  const playerWidths = geometry.playerBodies.map((box) => box.width);
  expect(Math.min(...playerWidths)).toBeLessThan(Math.max(...playerWidths));
  expect(Math.abs((geometry.composer?.left ?? 0) + (geometry.composer?.width ?? 0) / 2 - ((geometry.inner?.left ?? 0) + (geometry.inner?.width ?? 0) / 2))).toBeLessThan(1);
  expect(Math.abs((geometry.composerForm?.left ?? 0) + (geometry.composerForm?.width ?? 0) / 2 - ((geometry.inner?.left ?? 0) + (geometry.inner?.width ?? 0) / 2))).toBeLessThan(1);
  expect(geometry.composer?.height).toBeLessThanOrEqual(64);
  expect(geometry.composerSurfaceCount).toBe(0);
  expect(geometry.visibleComposerHints).toBe(0);
  expect(geometry.suggestionIcons).toBe(0);
  expect(geometry.worldIdentities).toBeLessThan(geometry.world.length);
  expect(geometry.worldGroups).toBeLessThan(geometry.world.length);

  const transcript = page.locator(".cg-conversation-scroll");
  await transcript.evaluate((node) => node.dispatchEvent(new Event("scroll")));
  await expect(transcript).toHaveAttribute("data-scroll-active", "true");
  await expect(transcript).toHaveAttribute("data-scroll-active", "false", { timeout: 1_500 });
});

test("mobile chat shell keeps controls reachable without page overflow", async ({ page }) => {
  await startConversation(page, { width: 390, height: 844 });
  await page.mouse.move(195, 24);
  await expect(page.locator(".cg-conversation-scroll")).toHaveAttribute("data-scroll-active", "false", { timeout: 1_500 });

  const geometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height };
    };
    const buttons = [...document.querySelectorAll(".cg-game-workspace button")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 };
    }).filter((item) => item.visible);
    const transcript = document.querySelector(".cg-conversation-scroll");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      body: { width: document.body.clientWidth, scrollWidth: document.body.scrollWidth, height: document.body.clientHeight, scrollHeight: document.body.scrollHeight },
      trigger: box(".cg-mobile-tools-button"),
      shell: box(".cg-game-workspace"),
      transcript: box(".cg-conversation-scroll"),
      composer: box(".cg-composer"),
      transcriptScroll: transcript ? { scrollHeight: transcript.scrollHeight, clientHeight: transcript.clientHeight, scrollbarWidth: getComputedStyle(transcript).scrollbarWidth } : null,
      buttons,
    };
  });

  expect(geometry.body.scrollWidth).toBe(geometry.body.width);
  expect(geometry.body.scrollHeight).toBe(geometry.body.height);
  expect(geometry.trigger?.width).toBeGreaterThanOrEqual(44);
  expect(geometry.trigger?.height).toBeGreaterThanOrEqual(44);
  expect(geometry.transcriptScroll?.scrollbarWidth).toBe("none");
  expect(geometry.transcriptScroll?.scrollHeight).toBeGreaterThan(geometry.transcriptScroll?.clientHeight ?? 0);
  expect(geometry.composer?.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.buttons.filter((button) => button.width < 44 || button.height < 44)).toEqual([]);
});

test("launcher actions stay inside one card and the origin step is an inline carousel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { hostShell: true });
  await openLauncher(page);

  const card = page.locator(".cg-launcher-card--programme");
  const incomingCard = page.locator(".cg-launcher-card--origin");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "开始新游戏" })).toBeVisible();
  await expect(card.getByRole("button", { name: "继续游戏" })).toBeVisible();
  await expect(card.getByRole("button", { name: "选择存档" })).toBeVisible();
  await expect(page.locator(".cg-resume-strip")).toHaveCount(0);
  const incomingTopBefore = (await incomingCard.boundingBox())?.y;

  await card.getByRole("button", { name: "开始新游戏" }).click();
  await expect(page.getByRole("heading", { name: "你从哪里来" })).toBeVisible();
  const incomingTopAfter = (await incomingCard.boundingBox())?.y;
  expect(incomingTopBefore).toBeDefined();
  expect(incomingTopAfter).toBeDefined();
  expect(Math.abs((incomingTopAfter ?? 0) - (incomingTopBefore ?? 0))).toBeLessThan(1);
  const carousel = page.getByRole("listbox", { name: "可选出身" });
  await expect(carousel).toBeVisible();
  await expect(carousel).toHaveCSS("scrollbar-width", "none");
  await expect(page.locator(".cg-launcher-card--origin").getByRole("button", { name: "确认这个出身" })).toBeVisible();
  await expectNoUnstyledNativeControls(page);
});

test("launcher resumes the newest save owned by the current script", async ({ page }) => {
  await page.addInitScript((scriptId) => {
    localStorage.setItem("chatgame:settings:v3", JSON.stringify({
      version: 3,
      activeScriptId: scriptId,
      fullscreenOnStart: false,
    }));
  }, ALT_SCRIPT_ID);
  const port = await installMockGameRoutes(page, {
    hostShell: true,
    saves: {
      [ALT_SCRIPT_ID]: [
        { runId: "older.json", updatedAt: "2026-08-20T08:00:00.000Z" },
        { runId: "latest.json", updatedAt: "2026-08-22T08:00:00.000Z" },
      ],
    },
  });
  await page.goto("/");
  const card = page.locator(".cg-launcher-card--programme");
  await expect(card.getByRole("heading", { name: "备用测试剧本" })).toBeVisible();
  await card.getByRole("button", { name: "继续游戏" }).click();
  await expect(page.getByRole("textbox", { name: "输入你的话或行动" })).toBeVisible();
  expect(port.createdSessions[0]).toMatchObject({
    scriptId: ALT_SCRIPT_ID,
    loadRunId: "latest.json",
  });
});

test("settings share one row axis and only expose Base UI form controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { hostShell: true });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const sliders = [...document.querySelectorAll<HTMLElement>('[data-slot="slider"]')].map((node) => node.getBoundingClientRect().width);
    const rows = [...document.querySelectorAll<HTMLElement>('[data-slot="setting-row"]')].map((node) => {
      const control = node.querySelector<HTMLElement>(".cg-setting-row__control")?.getBoundingClientRect();
      return control?.left ?? 0;
    });
    const settings = document.querySelector<HTMLElement>(".cg-settings");
    return {
      sliders,
      rows,
      overflowY: settings ? getComputedStyle(settings).overflowY : null,
      scrollbarGutter: settings ? getComputedStyle(settings).scrollbarGutter : null,
      trackToken: getComputedStyle(document.documentElement).getPropertyValue("--cg-scroll-track").trim(),
      thumbToken: getComputedStyle(document.documentElement).getPropertyValue("--cg-scroll-thumb").trim(),
    };
  });
  expect(geometry.sliders).toHaveLength(4);
  expect(Math.max(...geometry.sliders) - Math.min(...geometry.sliders)).toBeLessThan(1);
  expect(Math.max(...geometry.rows) - Math.min(...geometry.rows)).toBeLessThan(1);
  expect(geometry.overflowY).toBe("auto");
  expect(geometry.scrollbarGutter).toContain("stable");
  expect(geometry.trackToken).not.toBe("");
  expect(geometry.thumbToken).not.toBe("");
  await expectNoUnstyledNativeControls(page);
});

test("script detail separates current state, management note and actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockGameRoutes(page, { hostShell: true });
  await page.goto("/scripts");
  await expect(page.getByRole("heading", { name: "剧本库" })).toBeVisible();

  const detail = page.locator(".cg-dossier-detail");
  await expect(detail.getByRole("heading", { name: "工作台剧本" })).toBeVisible();
  const activateCurrent = detail.getByRole("button", { name: "设为当前剧本" });
  if (await activateCurrent.count()) await activateCurrent.click();
  await expect(detail.locator(".cg-dossier-detail__title")).toContainText("当前剧本");
  await expect(detail.getByRole("button", { name: "当前剧本" })).toHaveCount(0);
  await expect(detail.locator(".cg-dossier-detail__notice")).toContainText("不能删除");
  await expect(detail.locator(".cg-dossier-detail__actions")).toBeVisible();

  await page.getByRole("button", { name: /备用测试剧本/ }).click();
  await expect(detail.getByRole("button", { name: "设为当前剧本" })).toBeVisible();
  await expectNoUnstyledNativeControls(page);
});
