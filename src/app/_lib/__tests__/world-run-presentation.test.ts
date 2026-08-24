import { describe, expect, it } from "vitest";
import type { WorldRunEvent, WorldRunRecordView } from "../../../shared/world-api";
import { worldRunCopyText, worldRunNarrative } from "../world-run-presentation";

function run(events: WorldRunEvent[]): WorldRunRecordView {
  return {
    id: "run-1",
    sessionId: "session-1",
    inputs: [{
      id: "input-1",
      kind: "goal",
      text: "查看石门",
      at: "2026-08-24T00:00:00.000Z",
    }],
    status: "completed",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:02.000Z",
    cancelRequested: false,
    events,
  };
}

describe("WorldRun public presentation", () => {
  it("prefers public observations over internal outcome summaries", () => {
    const current = run([
      {
        sequence: 1,
        type: "player.outcome",
        at: "2026-08-24T00:00:01.000Z",
        payload: { status: "succeeded", summary: "内部结果摘要" },
      },
      {
        sequence: 2,
        type: "player.observation",
        at: "2026-08-24T00:00:02.000Z",
        payload: {
          id: "observation-1",
          observerId: "player",
          step: 1,
          summary: "门缝里透出微光。",
          introductions: [],
          apparentClaims: [],
          sourceEventIds: [],
        },
      },
    ]);

    expect(worldRunNarrative(current)).toEqual(["门缝里透出微光。"]);
    expect(worldRunCopyText(current)).not.toContain("内部结果摘要");
  });

  it("copies only public prose, disclosed checks, and the human-readable status", () => {
    const current = run([
      {
        sequence: 1,
        type: "player.observation",
        at: "2026-08-24T00:00:01.000Z",
        payload: {
          id: "observation-2",
          observerId: "player",
          step: 1,
          summary: "石门缓缓开启。",
          introductions: [],
          apparentClaims: [],
          sourceEventIds: [],
        },
      },
      {
        sequence: 2,
        type: "check.resolved",
        at: "2026-08-24T00:00:02.000Z",
        payload: {
          requestId: "check-1",
          visibility: "full",
          dice: [15],
          modifier: 2,
          total: 17,
          dc: 12,
          succeeded: true,
        },
      },
    ]);

    expect(worldRunCopyText(current)).toBe("石门缓缓开启。\n\n17 / DC 12 · 成功\n\n目标已经完成");
    expect(worldRunCopyText(current)).not.toContain("checkId");
    expect(worldRunCopyText(current)).not.toContain("{");
  });
});
