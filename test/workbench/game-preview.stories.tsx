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
  const dialog = await within(document.body).findByRole("dialog", { name: /开始《工作台剧本》/ });
  await waitFor(() => expect(dialog).toBeVisible());
  await expect(within(dialog).findByRole("combobox")).resolves.toBeEnabled();
  await userEvent.click(within(dialog).getByRole("button", { name: "进入世界" }));
  await expect(canvas.findByRole("textbox", { name: "输入你的话或行动" })).resolves.toBeVisible();
}

export const LauncherReady: Story = {};

export const LauncherLoading: Story = {
  args: { scenario: { latencyMs: { "/api/scripts": 10_000 } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findAllByText("正在整理剧目单……")).resolves.toHaveLength(2);
  },
};

export const LauncherEmpty: Story = {
  args: { scenario: { library: "empty" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole("heading", { name: "今晚还没有剧目" })).resolves.toBeVisible();
  },
};

export const LauncherError: Story = {
  args: { scenario: { session: "error" }, lastRun: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "继续上次游戏" }));
    await expect(canvas.findByText("会话恢复失败")).resolves.toBeVisible();
  },
};

export const NewGameDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "开始新游戏" }));
    const dialog = await within(document.body).findByRole("dialog", { name: /开始《工作台剧本》/ });
    await waitFor(() => expect(dialog).toBeVisible());
  },
};

export const ConversationEmpty: Story = {
  args: { scenario: { conversation: "empty" } },
  play: async ({ canvasElement }) => {
    await startGame(canvasElement);
  },
};

export const ConversationLong: Story = {
  args: { scenario: { conversation: "long" } },
  play: async ({ canvasElement }) => {
    await startGame(canvasElement);
    await expect(within(canvasElement).findByText(/第 27 次确认/)).resolves.toBeVisible();
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
