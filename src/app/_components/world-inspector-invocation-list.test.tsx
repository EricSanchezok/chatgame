// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldInspectorModelInvocationSummary } from "../../shared/world-inspector-api";
import { WorldInspectorInvocationList } from "./world-inspector-invocation-list";

const invocation: WorldInspectorModelInvocationSummary = {
  id: "invocation-1",
  sourceInvocationId: "invocation-1",
  ordinal: 1,
  role: "action-compilation",
  providerId: "qwen",
  modelId: "qwen-plus",
  status: "rejected",
  slotRefs: [{ slot: 0, agentId: "sigrun", actionId: "action-1", label: "看看周围有什么吧" }],
  transportAttempts: [
    { attempt: 1, status: "retryable_error", statusCode: 504, errorName: "ModelTransportError", queueWaitMs: 20, executionMs: 1_000, retryDelayMs: 300, eventIds: [] },
    { attempt: 2, status: "succeeded", queueWaitMs: 30, executionMs: 2_000, retryDelayMs: 0, eventIds: [] },
  ],
  retryCount: 1,
  tokenUsage: { input: 148_537, output: 1_900, reasoning: 120, cacheRead: 0, cacheWrite: 0 },
  requestUtf8Bytes: 9_000,
  contextUtf8Bytes: 8_000,
  responseUtf8Bytes: 4_100,
  contextSections: [],
  timings: { invocationMs: 3_350, queueWaitMs: 50, transportMs: 3_000, parseMs: 10, retryDelayMs: 300 },
  eventIds: [],
  payloadEventIds: {},
  artifactHashes: {},
  validationIssueCodes: ["continuation_assertion"],
  errorMessage: "continuation assertion failed",
  hasPayload: true,
};

describe("WorldInspectorInvocationList", () => {
  afterEach(cleanup);

  it("shows per-invocation metrics separately from physical transport attempts", () => {
    render(<WorldInspectorInvocationList invocations={[invocation]} onSelect={() => {}} query="" />);

    expect(screen.getByText("Invocation 1 · action-compilation")).toBeVisible();
    expect(screen.getAllByText("148,537")).toHaveLength(2);
    expect(screen.getByText("1 次 retry · 2 次物理尝试")).toBeVisible();
    expect(screen.getByText("Transport 1")).toBeVisible();
    expect(screen.getByText("Transport 2")).toBeVisible();
  });

  it("searches persisted Agent and action fields and selects the logical invocation", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<WorldInspectorInvocationList invocations={[invocation]} onSelect={onSelect} query="Sigrun" />);

    fireEvent.click(screen.getByRole("button", { name: /Invocation 1/ }));
    expect(onSelect).toHaveBeenCalledWith(invocation);

    rerender(<WorldInspectorInvocationList invocations={[invocation]} onSelect={onSelect} query="missing" />);
    expect(screen.getByText("没有匹配“missing”的模型调用。")).toBeVisible();
  });

  it("keeps large slot batches compact and moves the full mapping to the detail panel", () => {
    const batched = {
      ...invocation,
      slotRefs: Array.from({ length: 5 }, (_, slot) => ({ slot, agentId: `agent-${slot}` })),
    };
    render(<WorldInspectorInvocationList invocations={[batched]} onSelect={() => {}} query="" />);

    expect(screen.getByText("5 个 slot")).toBeVisible();
    expect(screen.queryByText("查看全部")).not.toBeInTheDocument();
    expect(screen.getByText(/agent-0、agent-1、agent-2 等 2 个/)).toBeVisible();
    expect(screen.queryByText("agent-4")).not.toBeInTheDocument();
  });

  it("uses one full-card button for selection", () => {
    const onSelect = vi.fn();
    render(<WorldInspectorInvocationList invocations={[invocation]} onSelect={onSelect} query="" />);

    const card = screen.getByRole("button", { name: /Invocation 1/ });
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card.querySelectorAll("button")).toHaveLength(0);
    fireEvent.click(screen.getByText("Transport 1"));
    expect(onSelect).toHaveBeenCalledWith(invocation);
  });

  it("keeps repeated invocation ordinals distinguishable across executions", () => {
    const first = { ...invocation, id: "first-run::invocation-1", sourceInvocationId: "invocation-1", executionId: "first-run" };
    const second = { ...invocation, id: "second-run::invocation-1", sourceInvocationId: "invocation-1", executionId: "second-run" };

    render(<WorldInspectorInvocationList invocations={[first, second]} onSelect={() => {}} query="" />);

    const buttons = screen.getAllByRole("button", { name: /Invocation 1/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("执行 first-ru");
    expect(buttons[1]).toHaveTextContent("执行 second-");
    expect(buttons[0].textContent).not.toBe(buttons[1].textContent);
  });
});
