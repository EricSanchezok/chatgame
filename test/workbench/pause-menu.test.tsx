// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PauseMenu } from "@/app/ui/game/pause-menu";

afterEach(() => {
  cleanup();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});

describe("PauseMenu", () => {
  it("exposes settings controls through accessible roles", async () => {
    const onAudio = vi.fn();
    const onClose = vi.fn();
    render(
      <PauseMenu
        themeMode="follow"
        themes={[{
          id: "workbench",
          name: "工作台",
          palette: {
            background: "#111111",
            surface: "#222222",
            surface_alt: "#333333",
            on_primary: "#111111",
            text: "#f5f5f5",
            text_dim: "#aaaaaa",
            primary: "#dddddd",
            accent: "#ffffff",
            border: "#444444",
            focus: "#ffffff",
            danger: "#cc3333",
            success: "#33aa66",
            warning: "#ddaa33",
            selected: "#333333",
          },
          typography: { font: "sans", scale: 1, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
          effects: {
            bubble_radius: 8,
            chrome_radius: 6,
            glass: 0,
            blur_px: 0,
            shadow: "none",
            border_width_px: 1,
            density: "cozy",
            motion: "subtle",
            scene_tint: "#111111",
            overlay_strength: 0.7,
          },
        }]}
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

    expect(screen.getByRole("dialog", { name: "游戏菜单" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "退出全屏" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "声音" }));
    expect(onAudio).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭游戏菜单" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("offers exit only while the document is fullscreen", async () => {
    const exit = vi.fn(async () => undefined);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    render(
      <PauseMenu
        themeMode="follow" themes={[]} audioEnabled={false} dirty={false} busy={false}
        onTheme={vi.fn()} onAudio={vi.fn()} onSave={vi.fn(async () => undefined)}
        onExit={vi.fn(async () => undefined)} onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    fireEvent(document, new Event("fullscreenchange"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "退出全屏" })).toBeNull());
  });
});
