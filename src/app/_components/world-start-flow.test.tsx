// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CreateInstanceInput } from "../../shared/world-api";
import { useAwakeningLeaveGuard, worldWeaveSignature } from "./world-awakening";
import {
  beginAwakening,
  canDismissStart,
  restoreAfterAwakeningFailure,
} from "./world-start-flow";

function LeaveGuardHarness() {
  useAwakeningLeaveGuard();
  return null;
}

describe("world start flow", () => {
  afterEach(cleanup);

  it("freezes the submitted identity and restores the editable stage after failure", () => {
    const input: CreateInstanceInput = {
      worldId: "world-one",
      start: {
        kind: "origin",
        originId: "wayfarer",
        displayName: "小明",
        appearance: "背着旧旅行包",
        motivation: "寻找离开的路",
      },
    };
    const awakening = beginAwakening(input, "customize");
    input.worldId = "changed";
    if (input.start.kind === "origin") input.start.displayName = "后来修改的名字";

    expect(awakening.submission).toMatchObject({
      worldId: "world-one",
      start: { kind: "origin", displayName: "小明" },
    });
    expect(canDismissStart(awakening)).toBe(false);
    expect(restoreAfterAwakeningFailure(awakening)).toEqual({ kind: "customize" });
  });

  it("returns an observer launch to the choice stage", () => {
    const awakening = beginAwakening(
      { worldId: "world-one", start: { kind: "observer" } },
      "choice",
    );
    expect(restoreAfterAwakeningFailure(awakening)).toEqual({ kind: "choice" });
  });

  it("derives a stable but world-specific weave signature", () => {
    const first = worldWeaveSignature(`sha256:${"12ab".repeat(16)}`);
    const same = worldWeaveSignature(`sha256:${"12ab".repeat(16)}`);
    const different = worldWeaveSignature(`sha256:${"98cd".repeat(16)}`);

    expect(same).toEqual(first);
    expect(different).not.toEqual(first);
    expect(first.nodes).toHaveLength(8);
    expect(first.nodes.every((node) => node.x >= 20 && node.x <= 300 && node.y >= 20 && node.y <= 300)).toBe(true);
    expect(first.orbitDirections.every((direction) => direction === 1 || direction === -1)).toBe(true);
    expect(first.orbitDurations.every((duration) => duration >= 9 && duration <= 22)).toBe(true);
  });

  it("warns only while the awakening guard is mounted", () => {
    const view = render(<LeaveGuardHarness />);
    const guarded = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(guarded)).toBe(false);
    expect(guarded.defaultPrevented).toBe(true);

    view.unmount();
    const released = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(released)).toBe(true);
    expect(released.defaultPrevented).toBe(false);
  });
});
