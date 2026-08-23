import { describe, expect, it } from "vitest";
import type { WorldRunRecordView } from "../../../shared/world-api";
import { runsToMessages } from "../run-messages";

function run(status: WorldRunRecordView["status"]): WorldRunRecordView {
  return {
    id: "run-1",
    sessionId: "session-1",
    inputs: [{
      id: "input-1",
      kind: "goal",
      text: "推开石门",
      at: "2026-08-23T00:00:00.000Z",
    }],
    status,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:01.000Z",
    cancelRequested: false,
    events: [{
      sequence: 1,
      type: "player.input",
      at: "2026-08-23T00:00:00.000Z",
      payload: { id: "input-1", kind: "goal", text: "推开石门" },
    }],
  };
}

describe("runsToMessages", () => {
  it("projects each persisted run into one player/world turn", () => {
    const messages = runsToMessages([run("completed")]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "run:run-1:input:input-1:user", role: "user" });
    expect(messages[1]).toMatchObject({
      id: "run:run-1:input:input-1:assistant",
      role: "assistant",
      status: { type: "complete", reason: "stop" },
      content: [{ type: "data", name: "world-run" }],
    });
  });

  it("projects clarification inputs as additional turns from the same durable run", () => {
    const continued = run("completed");
    continued.inputs.push({
      id: "input-2",
      kind: "clarification",
      text: "使用铜钥匙",
      at: "2026-08-23T00:00:02.000Z",
    });
    continued.events.push(
      {
        sequence: 2,
        type: "run.awaiting_player",
        at: "2026-08-23T00:00:01.000Z",
        payload: { runId: continued.id, revision: 1, step: 1 },
      },
      {
        sequence: 3,
        type: "player.input",
        at: "2026-08-23T00:00:02.000Z",
        payload: { id: "input-2", kind: "clarification", text: "使用铜钥匙" },
      },
    );

    const messages = runsToMessages([continued]);

    expect(messages).toHaveLength(4);
    expect(messages[1].status).toEqual({ type: "complete", reason: "stop" });
    expect(messages[2]).toMatchObject({ role: "user", content: [{ text: "使用铜钥匙" }] });
  });

  it("keeps active and failed runs truthful to assistant-ui", () => {
    expect(runsToMessages([run("running")])[1].status).toEqual({ type: "running" });
    expect(runsToMessages([run("failed")])[1].status).toEqual({ type: "incomplete", reason: "error" });
  });
});
