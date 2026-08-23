// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorldWorkbench } from "../world-workbench";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorldWorkbench", () => {
  it("shows an honest importable empty state when no world is installed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/api/worlds") ? { worlds: [] } : { sessions: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    render(<WorldWorkbench />);

    expect(await screen.findByRole("heading", { name: "暂无可玩世界" })).toBeInTheDocument();
    expect(
      screen.getByText("导入符合 schema v4 的世界 ZIP，开始一段游戏。"),
    ).toBeInTheDocument();
    expect(screen.getByText("导入世界 ZIP")).toBeInTheDocument();
  });

  it("keeps the free-action submit discoverable and reports an empty input at the field", async () => {
    const session = {
      id: "session-1",
      worldId: "world-1",
      worldHash: `sha256:${"1".repeat(64)}`,
      worldVersion: "1",
      revision: 0,
      step: 0,
      elapsedSeconds: 0,
      player: { localEntities: {}, claims: {}, evidence: {}, observationIds: [] },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/api/worlds")
        ? { worlds: [{
            id: "world-1",
            name: "世界",
            version: "1",
            contentHash: `sha256:${"1".repeat(64)}`,
            description: "测试世界",
          }] }
        : { sessions: [session] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    render(<WorldWorkbench />);
    const input = await screen.findByLabelText("你的行动");
    const submit = screen.getByRole("button", { name: "提交自由行动" });

    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(screen.getByText("请先描述你想做的事情。")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
  });
});
