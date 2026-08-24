import { describe, expect, it } from "vitest";
import {
  clampDragPoint,
  defaultControlPosition,
  moveControlPosition,
  parseControlPosition,
  positionFromPixels,
  positionToPixels,
  radialActionInset,
  radialActionSize,
  radialCardGap,
  radialCardOffset,
  radialOffsets,
  verticalZone,
} from "../control-orb-position";

const desktop = { width: 1_440, height: 900 };

describe("control orb position", () => {
  it("rejects the retired corner format and normalizes v2 coordinates", () => {
    expect(parseControlPosition(JSON.stringify({ horizontal: "right", vertical: "bottom" })))
      .toEqual(defaultControlPosition);
    expect(parseControlPosition(JSON.stringify({ edge: "left", y: 1.4 })))
      .toEqual({ edge: "left", y: 1 });
    expect(parseControlPosition(JSON.stringify({ edge: "right", y: -0.2 })))
      .toEqual({ edge: "right", y: 0 });
  });

  it("selects the nearest edge and round-trips the normalized vertical position", () => {
    const pixels = positionToPixels({ edge: "left", y: 0.42 }, desktop, 16, 96);
    expect(pixels.x).toBe(16);
    expect(positionFromPixels(pixels, desktop, 16, 96)).toEqual({ edge: "left", y: 0.42 });
    expect(positionFromPixels({ x: 1_000, y: 400 }, desktop, 16, 96).edge).toBe("right");
  });

  it("keeps pointer movement inside the safe area and above the composer exclusion zone", () => {
    expect(clampDragPoint({ x: -50, y: 1_000 }, desktop, 16, 96)).toEqual({
      x: 16,
      y: 732,
    });
  });

  it("supports keyboard edge movement, vertical steps, and reset", () => {
    const start = { edge: "right" as const, y: 0.5 };
    expect(moveControlPosition(start, "ArrowLeft", desktop, 96)).toEqual({ edge: "left", y: 0.5 });
    expect(moveControlPosition(start, "ArrowUp", desktop, 96).y).toBeLessThan(0.5);
    expect(moveControlPosition(start, "ArrowDown", desktop, 96).y).toBeGreaterThan(0.5);
    expect(moveControlPosition(start, "Home", desktop, 96)).toEqual(defaultControlPosition);
  });

  it("orients radial actions toward the page and available vertical space", () => {
    expect(verticalZone(0.1)).toBe("top");
    expect(verticalZone(0.5)).toBe("middle");
    expect(verticalZone(0.9)).toBe("bottom");
    expect(radialOffsets("right", "bottom").every(([x, y]) => x <= 0 && y <= 0)).toBe(true);
    expect(radialOffsets("left", "top").every(([x, y]) => x >= 0 && y >= 0)).toBe(true);
    expect(radialOffsets("left", "middle")).toHaveLength(3);
  });

  it("places the status card beyond the complete radial action envelope", () => {
    for (const edge of ["left", "right"] as const) {
      for (const zone of ["top", "middle", "bottom"] as const) {
        const offsets = radialOffsets(edge, zone);
        const cardOffset = radialCardOffset(edge, offsets);
        if (edge === "left") {
          const actionRight = Math.max(...offsets.map(([x]) => radialActionInset + x + radialActionSize));
          expect(cardOffset - actionRight).toBe(radialCardGap);
        } else {
          const actionLeft = Math.min(...offsets.map(([x]) => radialActionInset + x));
          expect(actionLeft - (-cardOffset)).toBe(radialCardGap);
        }
      }
    }
  });
});
