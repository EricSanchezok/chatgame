import { describe, expect, it } from "vitest";
import type { WorldRunRecordView } from "../../../shared/world-api";
import { runsToMessages } from "../run-messages";

function run(status: WorldRunRecordView["status"]): WorldRunRecordView {
  return {
    id: "run-1",
    sessionId: "session-1",
    text: "推开石门",
    status,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:01.000Z",
    cancelRequested: false,
    events: [],
  };
}

describe("runsToMessages", () => {
  it("projects each persisted run into one player/world turn", () => {
    const messages = runsToMessages([run("completed")]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "run:run-1:user", role: "user" });
    expect(messages[1]).toMatchObject({
      id: "run:run-1:assistant",
      role: "assistant",
      status: { type: "complete", reason: "stop" },
      content: [{ type: "data", name: "world-run" }],
    });
  });

  it("keeps active and failed runs truthful to assistant-ui", () => {
    expect(runsToMessages([run("running")])[1].status).toEqual({ type: "running" });
    expect(runsToMessages([run("failed")])[1].status).toEqual({ type: "incomplete", reason: "error" });
  });
});
