// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldInspectorAttemptSummary, WorldInspectorStepSummary } from "../../shared/world-inspector-api";
import { WorldInspectorTimeline } from "./world-inspector-timeline";

const tokenUsage = { input: 100, output: 20, total: 120, unknown: false };

function attempt(overrides: Partial<WorldInspectorAttemptSummary> = {}): WorldInspectorAttemptSummary {
  return {
    id: "attempt-1",
    status: "committed",
    startedAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:03.000Z",
    latestEvent: "persistence.atomic_commit",
    eventCount: 12,
    modelInvocationCount: 2,
    transportAttemptCount: 2,
    retryCount: 0,
    tokenUsage,
    actorIds: ["agent-1"],
    relatedActorIds: ["agent-1"],
    stages: [{
      id: "stage:1",
      label: "行动编译",
      status: "succeeded",
      startedAt: "2026-09-02T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:01.000Z",
      eventCount: 4,
      modelInvocationCount: 1,
      rejectionCount: 1,
      repairCount: 1,
      logicalStageIndex: 1,
      derived: true,
    }],
    rejectionCount: 1,
    repairCount: 1,
    revision: 2,
    step: 1,
    ...overrides,
  };
}

const step: WorldInspectorStepSummary = {
  revision: 2,
  step: 1,
  contentHash: "hash-2",
  elapsedSeconds: 4,
  primaryAction: "观察码头",
  actorIds: ["agent-1"],
  counts: { actions: 1, reactions: 0, checks: 0, random: 0, mechanics: 0, operations: 1, events: 1, observations: 1, mindUpdates: 1, modelInvocations: 2 },
  tokenUsage,
  nodeIds: [],
};

describe("WorldInspectorTimeline", () => {
  afterEach(cleanup);

  it("explains the current paused stage before historical evidence", () => {
    render(
      <WorldInspectorTimeline
        attempts={[attempt({ status: "active", id: "active-1", latestEvent: "stage.paused", revision: undefined, rejectionCount: 0 })]}
        hasOlder={false}
        loadingOlder={false}
        onLoadOlder={vi.fn()}
        onReplay={vi.fn()}
        onSelectAttempt={vi.fn()}
        onSelectStep={vi.fn()}
        query=""
        run={{ id: "run-1", generation: 1, status: "debug-paused", boundaryIndex: 0, stageIndex: 0, stageCount: 10, stageKey: "input-roster", stageLabel: "输入绑定与 Agent roster", checkpointId: "checkpoint-1", canAdvance: true }}
        selectedActorId="world"
        steps={[]}
      />,
    );

    expect(screen.getByRole("region", { name: "当前推演状态" })).toHaveTextContent("已暂停，等待下一步");
    expect(screen.getByText("阶段 1 / 10")).toBeVisible();
    expect(screen.getByText(/尚未执行模型调用/)).toBeVisible();
    expect(screen.getByText("当前调试运行")).toBeVisible();
  });

  it("separates a committed result from intermediate rejected output", () => {
    render(
      <WorldInspectorTimeline
        attempts={[attempt()]}
        hasOlder={false}
        loadingOlder={false}
        onLoadOlder={vi.fn()}
        onReplay={vi.fn()}
        onSelectAttempt={vi.fn()}
        onSelectStep={vi.fn()}
        query=""
        selectedActorId="world"
        steps={[step]}
      />,
    );

    expect(screen.getByText("已完成并提交")).toBeVisible();
    expect(screen.getByText(/中间输出未通过语义校验/)).toBeVisible();
    expect(screen.queryByText("未完成，未提交世界状态")).not.toBeInTheDocument();
    expect(screen.getByText(/部分由已有事件推导/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /回放世界边界/ })).toHaveLength(1);
  });
});
