import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { GamePreviewHarness } from "./game-preview-harness";

const meta = {
  title: "Workbench/Game preview",
  component: GamePreviewHarness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GamePreviewHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

async function startGame(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.findByRole("heading", { name: /工作台剧本/ })).resolves.toBeVisible();
  await userEvent.click(await canvas.findByRole("button", { name: "开始新游戏" }));
  await expect(canvas.findByRole("heading", { name: "你从哪里来" })).resolves.toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "确认这个出身" }));
  await userEvent.click(canvas.getByRole("button", { name: "进入世界" }));
  await expect(canvas.findByRole("textbox", { name: "输入你的话或行动" })).resolves.toBeVisible();
}

export const LauncherReady: Story = {
  args: { scenario: { hostShell: true } },
};

export const LauncherLoading: Story = {
  args: { scenario: { latencyMs: { "/api/scripts": 10_000 } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText("正在整理剧目单……")).resolves.toBeVisible();
  },
};

export const LauncherEmpty: Story = {
  args: { scenario: { library: "empty" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole("heading", { name: "今晚还没有剧目" })).resolves.toBeVisible();
  },
};

export const LauncherError: Story = {
  args: { scenario: { session: "error", hostShell: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "继续游戏" }));
    await expect(canvas.findByText("会话恢复失败")).resolves.toBeVisible();
  },
};

export const NewGameOrigin: Story = {
  args: { scenario: { hostShell: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "开始新游戏" }));
    await expect(canvas.findByRole("heading", { name: "你从哪里来" })).resolves.toBeVisible();
  },
};

export const NewGameIdentity: Story = {
  args: { scenario: { hostShell: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "开始新游戏" }));
    await userEvent.click(await canvas.findByRole("button", { name: "确认这个出身" }));
    await expect(canvas.findByRole("heading", { name: "确认你的身份" })).resolves.toBeVisible();
  },
};

export const NewGameLockedOrigin: Story = {
  args: { scenario: { hostShell: true, lockedOrigin: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "开始新游戏" }));
    await expect(canvas.findByText("未解锁")).resolves.toBeVisible();
  },
};

export const NewGameOriginError: Story = {
  args: { scenario: { hostShell: true, meta: "error" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "开始新游戏" }));
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent("出身清单暂时不可用");
    await expect(canvas.findByRole("button", { name: "重新加载" })).resolves.toBeVisible();
  },
};

export const ConversationEmpty: Story = {
  args: { scenario: { conversation: "empty", hostShell: true } },
  play: async ({ canvasElement }) => {
    await startGame(canvasElement);
  },
};

export const ConversationLong: Story = {
  args: { scenario: { conversation: "long", hostShell: true } },
  play: async ({ canvasElement }) => {
    await startGame(canvasElement);
    await expect(within(canvasElement).findByText(/第 27 次确认/)).resolves.toBeVisible();
  },
};

export const ConversationRolesAndMedia: Story = {
  args: { scenario: { hostShell: true } },
  play: async ({ canvasElement }) => {
    await startGame(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByRole("log", { name: "游戏对话记录" })).resolves.toBeVisible();
    await expect(canvas.findByText("交班记录已载入。")).resolves.toBeVisible();
    await expect(canvas.findByText("我先核对交班记录，再检查中继柜。")).resolves.toBeVisible();
    await expect(canvas.findAllByText("中继室")).resolves.toHaveLength(2);
    await expect(canvas.findByText("信号中断")).resolves.toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: /值班员/ }));
    await expect(canvas.findByText("负责维护中继室的公开值班人员。")).resolves.toBeVisible();
  },
};

export const ConversationError: Story = {
  args: { scenario: { turn: "error" } },
  play: async ({ canvasElement }) => {
    await startGame(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "输入你的话或行动" }), "检查备用线路");
    await userEvent.click(canvas.getByRole("button", { name: "发送" }));
    await expect(canvas.findByText("世界响应超时")).resolves.toBeVisible();
  },
};

export const PauseMenu: Story = {
  play: async ({ canvasElement }) => {
    await startGame(canvasElement);
    await userEvent.keyboard("{Escape}");
    const dialog = await within(document.body).findByRole("dialog", { name: "暂停菜单" });
    await waitFor(() => expect(dialog).toBeVisible());
  },
};
