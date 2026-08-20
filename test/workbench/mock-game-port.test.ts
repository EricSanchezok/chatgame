import { describe, expect, it } from "vitest";
import { CORE_SCRIPT_ID } from "./core-test-script";
import { MockGamePort } from "./mock-game-port";

describe("MockGamePort", () => {
  it("serves deterministic library and session responses", async () => {
    const port = new MockGamePort({ conversation: "empty" });
    const library = await port.fetch("http://workbench.local/api/scripts");
    expect(library.status).toBe(200);
    expect((await library.json()).scripts).toHaveLength(2);

    const session = await port.fetch("http://workbench.local/api/sessions", {
      method: "POST",
      body: JSON.stringify({ scriptId: CORE_SCRIPT_ID, originId: "observer" }),
    });
    const body = await session.json();
    expect(session.status).toBe(201);
    expect(body.state.scriptId).toBe(CORE_SCRIPT_ID);
    expect(body.state.transcript).toEqual([]);
  });

  it("makes failure paths explicit", async () => {
    const port = new MockGamePort({ library: "error", turn: "error" });
    expect((await port.fetch("http://workbench.local/api/scripts")).status).toBe(503);
    expect(
      (
        await port.fetch("http://workbench.local/api/sessions/preview-session/turn", {
          method: "POST",
          body: JSON.stringify({ input: "检查" }),
        })
      ).status,
    ).toBe(503);
  });
});
