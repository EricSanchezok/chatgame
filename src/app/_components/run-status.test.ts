import { describe, expect, it } from "vitest";
import type { PublicWorldRun } from "../../shared/world-api";
import { formatRunElapsed, runBoundaryLabel, runStatusPresentation } from "./run-status";

function run(overrides: Partial<PublicWorldRun> = {}): PublicWorldRun {
  return {
    id: "run-1",
    generation: 1,
    status: "running",
    committedRevisions: [],
    stopReason: null,
    lease: {
      commitCount: 0,
      maxCommits: 100,
      maxWallTimeMs: 900_000,
      startedAt: "2026-08-29T08:00:00.000Z",
    },
    activity: null,
    debug: {
      mode: "off",
      boundaryIndex: 0,
      stageIndex: 0,
      stageCount: 10,
      stageKey: null,
      stageLabel: null,
      checkpointId: null,
      canAdvance: false,
    },
    ...overrides,
  };
}

describe("run status presentation", () => {
  it("explains an in-flight action even before a canonical activity exists", () => {
    const presentation = runStatusPresentation(run(), true);
    expect(presentation.title).toBe("正在处理你的行动");
    expect(presentation.detail).toBe("生成 → 校验 → 提交");
  });

  it("uses real activity stage and progress without inventing a percentage", () => {
    const presentation = runStatusPresentation(run({
      activity: {
        id: "activity-1",
        status: "active",
        description: "搜寻失踪信使",
        stage: "侦查",
        progress: { current: 2, target: 10, unit: "米" },
        nextBoundaryAtSeconds: 12,
        completionAtSeconds: null,
        queuePosition: null,
        resourceNames: [],
      },
    }), true);
    expect(presentation.detail).toBe("侦查 · 2.00 / 10 米");
  });

  it("makes the lease budget legible", () => {
    expect(runBoundaryLabel(run())).toBe("本轮推进 0 / 100 个世界边界");
  });

  it("formats elapsed wall time for the waiting state", () => {
    expect(formatRunElapsed("2026-08-29T08:00:00.000Z", Date.parse("2026-08-29T08:01:12.000Z"))).toBe("1 分 12 秒");
  });
});
