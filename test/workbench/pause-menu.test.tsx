// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PauseMenu } from "@/app/ui/game/pause-menu";

afterEach(() => {
  cleanup();
});

describe("PauseMenu", () => {
  it("exposes settings controls through accessible roles", () => {
    const onAudio = vi.fn();
    const onClose = vi.fn();
    render(
      <PauseMenu
        themeMode="follow"
        themes={[{ id: "workbench", name: "工作台" }]}
        audioEnabled={false}
        dirty={true}
        busy={false}
        onTheme={vi.fn()}
        onAudio={onAudio}
        onSave={vi.fn(async () => undefined)}
        onExit={vi.fn(async () => undefined)}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog", { name: "暂停菜单" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关" }));
    expect(onAudio).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
