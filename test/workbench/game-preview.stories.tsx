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
  const dialog = await canvas.findByRole("dialog", { name: "新游戏" });
  await expect(within(dialog).findByRole("combobox")).resolves.toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "开始冒险" }));
  await expect(canvas.findByRole("textbox", { name: "玩家输入" })).resolves.toBeVisible();
}

export const LauncherReady: Story = {};

export const LauncherEmpty: Story = {
  args: { scenario: { library: "empty" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText(/还没有已安装的剧本/)).resolves.toBeVisible();
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
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "开始新游戏" }));
    await expect(canvas.findByRole("dialog", { name: "新游戏" })).resolves.toBeVisible();
  },
};

export const ScriptLibraryRapidSwitch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alternate = await canvas.findByRole("button", { name: "备用测试剧本" });
    const core = canvas.getByRole("button", { name: "工作台剧本" });
    await userEvent.click(alternate);
    await userEvent.click(core);
    await waitFor(() => expect(canvas.getByRole("heading", { name: /工作台剧本/ })).toBeVisible());
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
  parameters: { a11y: { test: "todo" } },
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
    await userEvent.type(canvas.getByRole("textbox", { name: "玩家输入" }), "检查备用线路");
    await userEvent.click(canvas.getByRole("button", { name: "发送" }));
    await expect(canvas.findByText("世界响应超时")).resolves.toBeVisible();
  },
};

export const Settings: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvasElement }) => {
    await startGame(canvasElement);
    await userEvent.keyboard("{Escape}");
    await expect(within(canvasElement).findByRole("dialog", { name: "暂停菜单" })).resolves.toBeVisible();
  },
};
