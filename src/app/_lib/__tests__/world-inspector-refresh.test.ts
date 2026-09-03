import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldInspectorStreamEvent } from "../../../shared/world-inspector-api";
import {
  WorldInspectorRefreshScheduler,
  classifyWorldInspectorRuntimeEvent,
} from "../world-inspector-refresh";

function runtimeEvent(name: string): WorldInspectorStreamEvent {
  return {
    type: "runtime",
    epoch: "epoch-1",
    event: {
      id: `event-${name}`,
      event: name,
      schemaVersion: 3,
      sequence: 1,
      timestamp: "2026-09-03T00:00:00.000Z",
      level: "info",
      correlation: {},
      summary: name,
      hasPayload: false,
    },
  } as WorldInspectorStreamEvent;
}

describe("WorldInspectorRefreshScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("classifies model and world events without refreshing on heartbeats", () => {
    expect(classifyWorldInspectorRuntimeEvent(runtimeEvent("model.invocation.started"))).toEqual({
      window: false,
      invocations: true,
      detail: true,
    });
    expect(classifyWorldInspectorRuntimeEvent(runtimeEvent("stage.started"))).toEqual({
      window: true,
      invocations: false,
      detail: false,
    });
    expect(classifyWorldInspectorRuntimeEvent({ type: "heartbeat", epoch: "epoch-1", at: "now" })).toBeUndefined();
  });

  it("coalesces a sustained burst to the trailing and maximum wait windows", () => {
    vi.useFakeTimers();
    const flushes: Array<{ window: boolean; invocations: boolean; detail: boolean }> = [];
    const scheduler = new WorldInspectorRefreshScheduler((dirty) => flushes.push(dirty));

    for (let index = 0; index < 100; index += 1) {
      scheduler.mark({ window: index % 2 === 0, invocations: index % 3 === 0, detail: false });
      vi.advanceTimersByTime(10);
    }
    expect(flushes).toHaveLength(1);
    vi.advanceTimersByTime(750);
    expect(flushes.length).toBeLessThanOrEqual(2);
    expect(flushes[0]).toEqual({ window: true, invocations: true, detail: false });
    scheduler.dispose();
  });

  it("flushes synchronously for resync and never invokes callbacks concurrently", () => {
    const flushes: Array<{ window: boolean; invocations: boolean; detail: boolean }> = [];
    const scheduler = new WorldInspectorRefreshScheduler((dirty) => flushes.push(dirty));
    scheduler.mark({ window: true, invocations: false, detail: false });
    scheduler.flushNow();
    scheduler.flushNow();
    expect(flushes).toHaveLength(1);
    scheduler.dispose();
  });
});
