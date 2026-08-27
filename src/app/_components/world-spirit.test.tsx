// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldSpirit, worldSpiritPose } from "./world-spirit";

describe("world spirit", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        matches: query.includes("hover: hover"),
        media: query,
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(cleanup);

  it("maps only real interface states to non-tinting expressions", () => {
    expect(worldSpiritPose("saved")).toBe("idle");
    expect(worldSpiritPose("confirming")).toBe("thinking");
    expect(worldSpiritPose("running")).toBe("thinking");
    expect(worldSpiritPose("saved", undefined, true)).toBe("happy");
    expect(worldSpiritPose("running", "warning", true)).toBe("unsure");
    expect(worldSpiritPose("saved", "error", true)).toBe("sad");
  });

  it("keeps Blobatar inline and isolates the gaze seam under reduced motion", async () => {
    const view = render(
      <WorldSpirit
        appReducedMotion
        gaze={[1, -1]}
        phase="saved"
        worldContentHash="sha256:world-one"
      />,
    );
    const spirit = view.container.querySelector<HTMLElement>(".cg-world-spirit");
    expect(spirit?.dataset.reducedMotion).toBe("true");
    expect(spirit?.querySelector("svg")).not.toBeNull();
    expect(spirit?.querySelector(".mo-eyes")).not.toBeNull();
    await waitFor(() => {
      expect(spirit?.style.getPropertyValue("--cg-spirit-gaze-x")).toBe("0");
      expect(spirit?.style.getPropertyValue("--cg-spirit-gaze-y")).toBe("0");
    });
  });

  it("writes gaze offsets without React frame state and removes its pointer listener", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(
      <WorldSpirit
        appReducedMotion={false}
        gaze={[1, -1]}
        phase="running"
        worldContentHash="sha256:world-one"
      />,
    );
    const spirit = view.container.querySelector<HTMLElement>(".cg-world-spirit");
    await waitFor(() => {
      expect(spirit?.style.getPropertyValue("--cg-spirit-gaze-x")).toBe("1.8");
      expect(spirit?.style.getPropertyValue("--cg-spirit-gaze-y")).toBe("-1.35");
    });
    view.rerender(
      <WorldSpirit
        appReducedMotion={false}
        gaze={null}
        phase="running"
        worldContentHash="sha256:world-one"
      />,
    );
    view.unmount();
    expect(add).toHaveBeenCalledWith("pointermove", expect.any(Function), { passive: true });
    expect(remove).toHaveBeenCalledWith("pointermove", expect.any(Function));
    add.mockRestore();
    remove.mockRestore();
  });
});
