// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicInstanceSummary } from "../../shared/world-api";
import { WorldApiError, worldApi } from "../lib/world-api-client";
import { loadWorldLibrary, useWorldLibrary } from "./use-world-library";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("world library startup", () => {
  it("recovers from a transient server failure", async () => {
    const api = {
      worlds: vi.fn()
        .mockRejectedValueOnce(new WorldApiError(500, "temporary compile failure"))
        .mockResolvedValue({ worlds: [] }),
      instances: vi.fn().mockResolvedValue({ instances: [] }),
    };
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(loadWorldLibrary({ api, retryDelaysMs: [250], wait })).resolves.toEqual({
      worlds: [],
      instances: [],
    });
    expect(api.worlds).toHaveBeenCalledTimes(2);
    expect(api.instances).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250, undefined);
  });

  it("surfaces a non-retryable request failure immediately", async () => {
    const failure = new WorldApiError(400, "invalid request");
    const api = {
      worlds: vi.fn().mockRejectedValue(failure),
      instances: vi.fn().mockResolvedValue({ instances: [] }),
    };
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(loadWorldLibrary({ api, retryDelaysMs: [250], wait })).rejects.toBe(failure);
    expect(api.worlds).toHaveBeenCalledTimes(1);
    expect(api.instances).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});

describe("world library success notices", () => {
  it("dismisses a completed instance deletion notice automatically", async () => {
    vi.useFakeTimers();
    vi.spyOn(worldApi, "worlds").mockResolvedValue({ worlds: [] });
    vi.spyOn(worldApi, "instances").mockResolvedValue({ instances: [] });
    vi.spyOn(worldApi, "deleteInstance").mockResolvedValue(undefined);
    const instance: PublicInstanceSummary = {
      id: "instance-1",
      worldId: "world-1",
      title: "测试存档",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
      revision: 0,
      step: 0,
      elapsedSeconds: 0,
      participantCount: 1,
      schedulerMode: "paused",
    };
    const { result } = renderHook(() => useWorldLibrary());

    await act(async () => {
      await result.current.deleteInstance(instance);
    });
    expect(result.current.notice).toBe("实例已删除。");

    act(() => vi.advanceTimersByTime(3_499));
    expect(result.current.notice).toBe("实例已删除。");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.notice).toBe("");
  });
});
