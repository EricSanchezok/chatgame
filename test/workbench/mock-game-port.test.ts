import { describe, expect, it } from "vitest";
import type { GamePort } from "@/app/lib/api";
import { CORE_SCRIPT_ID } from "./core-test-script";
import { MockGamePort } from "./mock-game-port";

describe("MockGamePort", () => {
  it("implements deterministic library and session responses through GamePort", async () => {
    const port = new MockGamePort({ conversation: "empty" });
    const contract: GamePort = port;
    const library = await contract.listScripts();
    expect(library.scripts).toHaveLength(2);

    const session = await contract.createSession({
      scriptId: CORE_SCRIPT_ID,
      originId: "observer",
    });
    expect(session.state.scriptId).toBe(CORE_SCRIPT_ID);
    expect(session.state.transcript).toEqual([]);
    expect(session.presentation.defaultThemeId).toBe("workbench-core");

    const advanced = await contract.advance(session.id, 24);
    expect(advanced.state.player.locationId).toBe("service-corridor");
    expect(advanced.presentation.currentTheme.id).toBe("workbench-corridor");
  });

  it("makes failure paths explicit", async () => {
    const port = new MockGamePort({ library: "error", turn: "error" });
    await expect(port.listScripts()).rejects.toThrow("剧本库暂时不可用");
    await expect(port.submitTurn("preview-session", { text: "检查" })).rejects.toThrow("世界响应超时");
  });

  it("keeps a thin HTTP adapter for Playwright route fulfillment", async () => {
    const port = new MockGamePort();
    const response = await port.fetch("http://workbench.local/api/scripts");
    expect(response.status).toBe(200);
    expect((await response.json()).scripts).toHaveLength(2);
  });
});
