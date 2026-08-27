import { describe, expect, it } from "vitest";
import { radialActionSize, radialOffsets } from "../control-orb-position";

describe("control orb radial actions", () => {
  it.each([
    ["left", "top"],
    ["right", "middle"],
    ["right", "bottom"],
  ] as const)("places four separated actions at the %s %s edge", (edge, zone) => {
    const offsets = radialOffsets(edge, zone);

    expect(offsets).toHaveLength(4);
    for (let index = 1; index < offsets.length; index += 1) {
      const [previousX, previousY] = offsets[index - 1];
      const [currentX, currentY] = offsets[index];
      expect(Math.hypot(currentX - previousX, currentY - previousY)).toBeGreaterThan(radialActionSize);
    }
  });
});
