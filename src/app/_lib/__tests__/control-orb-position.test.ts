import { describe, expect, it } from "vitest";
import {
  controlOrbSize,
  defaultControlPosition,
  floatingLabelOffset,
  moveControlPosition,
  noticeSide,
  parseControlPosition,
  positionFromPixels,
  positionToPixels,
  radialActionRadius,
  radialActionSize,
  radialOffsets,
  safeOpenPoint,
  statusSide,
} from "../control-orb-position";

const viewport = { width: 1_280, height: 720 };

describe("control orb free position", () => {
  it("parses normalized coordinates and rejects the superseded edge format", () => {
    expect(parseControlPosition('{"x":1.4,"y":-0.2}')).toEqual({ x: 1, y: 0 });
    expect(parseControlPosition('{"edge":"right","y":0.5}')).toEqual(defaultControlPosition);
    expect(parseControlPosition("not-json")).toEqual(defaultControlPosition);
  });

  it("round-trips a free position through viewport pixels", () => {
    const original = { x: 0.43, y: 0.61 };
    const pixels = positionToPixels(original, viewport, 16, 96);
    const restored = positionFromPixels(pixels, viewport, 16, 96);
    expect(restored.x).toBeCloseTo(original.x);
    expect(restored.y).toBeCloseTo(original.y);
  });

  it("moves in both axes and resets with Home", () => {
    const start = { x: 0.5, y: 0.5 };
    expect(moveControlPosition(start, "ArrowLeft", viewport).x).toBeLessThan(start.x);
    expect(moveControlPosition(start, "ArrowRight", viewport).x).toBeGreaterThan(start.x);
    expect(moveControlPosition(start, "ArrowUp", viewport).y).toBeLessThan(start.y);
    expect(moveControlPosition(start, "ArrowDown", viewport).y).toBeGreaterThan(start.y);
    expect(moveControlPosition(start, "Home", viewport)).toEqual(defaultControlPosition);
  });
});

describe("control orb radial actions", () => {
  it.each([4, 5])("places %s separated actions around a full circle", (count) => {
    const offsets = radialOffsets(count);
    expect(offsets).toHaveLength(count);
    for (let index = 0; index < offsets.length; index += 1) {
      const [x, y] = offsets[index];
      const [nextX, nextY] = offsets[(index + 1) % offsets.length];
      expect(Math.hypot(x, y)).toBeCloseTo(radialActionRadius);
      expect(Math.hypot(nextX - x, nextY - y)).toBeGreaterThan(radialActionSize);
    }
  });

  it("temporarily moves an open cluster fully inside desktop bounds", () => {
    const safe = safeOpenPoint({ x: 1_200, y: 640 }, viewport, 16, 96);
    const centerX = safe.x + controlOrbSize / 2;
    const centerY = safe.y + controlOrbSize / 2;
    expect(centerX).toBeLessThan(1_280 - 16);
    expect(centerY).toBeLessThan(720 - 96 - 16);
    expect(safe.x).toBeLessThan(1_200);
    expect(safe.y).toBeLessThan(640);
  });
});

describe("control orb message placement", () => {
  it("centers labels until their measured width reaches a viewport edge", () => {
    expect(floatingLabelOffset({ x: 940, y: 300 }, 122, viewport)).toBe(0);
    expect(floatingLabelOffset({ x: 1_200, y: 300 }, 122, viewport)).toBe(-29);
    expect(floatingLabelOffset({ x: 16, y: 300 }, 122, viewport)).toBe(29);
  });

  it("keeps the status label away from the lower edge", () => {
    expect(statusSide({ x: 600, y: 620 }, viewport)).toBe("top");
    expect(statusSide({ x: 600, y: 300 }, viewport)).toBe("bottom");
  });

  it("chooses the side with the most room for a notice", () => {
    expect(noticeSide({ x: 1_100, y: 300 }, viewport)).toBe("left");
    expect(noticeSide({ x: 24, y: 300 }, viewport)).toBe("right");
  });
});
