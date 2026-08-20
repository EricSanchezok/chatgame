"use client";

import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ScriptsLibrary } from "@/app/scripts/scripts-library";
import { SettingsScreen } from "@/app/settings/settings-screen";
import { Dialog } from "@/app/ui/dialog";
import { clearSlots } from "@/app/lib/script-registry";
import { MockGamePort } from "./mock-game-port";

type Surface = "scripts" | "settings" | "dialog";

function HostSurfacePreview({ surface }: { surface: Surface }) {
  const [ready, setReady] = useState(surface === "dialog");
  const [dialogOpen, setDialogOpen] = useState(true);
  const [port] = useState(() => new MockGamePort());

  useEffect(() => {
    if (surface === "dialog") return;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = port.fetch;
    clearSlots();
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => {
      window.clearTimeout(timer);
      globalThis.fetch = originalFetch;
      clearSlots();
    };
  }, [port, surface]);

  if (!ready) return <p role="status">正在安装工作台端口……</p>;
  if (surface === "scripts") return <ScriptsLibrary />;
  if (surface === "settings") return <SettingsScreen />;
  return dialogOpen ? (
    <Dialog title="工作台确认" description="验证焦点约束、关闭动作与长说明。" onClose={() => setDialogOpen(false)}>
      <p>这段内容用于确认宿主对话框在各尺寸下保持可读。</p>
      <button data-autofocus type="button" className="cg-button cg-button--primary" onClick={() => setDialogOpen(false)}>
        确认
      </button>
    </Dialog>
  ) : <button type="button" onClick={() => setDialogOpen(true)}>重新打开</button>;
}

const meta = {
  title: "Workbench/Host surfaces",
  component: HostSurfacePreview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HostSurfacePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ScriptsRoute: Story = {
  args: { surface: "scripts" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByRole("heading", { name: "剧本库" })).resolves.toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: /备用测试剧本/ }));
    await expect(canvas.findByRole("heading", { name: "备用测试剧本" })).resolves.toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /工作台剧本/ }));
    await expect(canvas.findByRole("heading", { name: "工作台剧本" })).resolves.toBeVisible();
  },
};

export const SettingsRoute: Story = {
  args: { surface: "settings" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole("heading", { name: "设置" })).resolves.toBeVisible();
  },
};

export const HostDialog: Story = {
  args: { surface: "dialog" },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "工作台确认" });
    await waitFor(() => expect(dialog).toBeVisible());
  },
};
