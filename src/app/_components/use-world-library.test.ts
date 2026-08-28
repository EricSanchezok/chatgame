import { describe, expect, it, vi } from "vitest";
import { WorldApiError } from "../lib/world-api-client";
import { loadWorldLibrary } from "./use-world-library";

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
