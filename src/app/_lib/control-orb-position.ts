export const controlOrbSize = 56;
export const radialActionInset = 6;
export const radialActionSize = 44;
export const radialCardGap = 32;
export const defaultControlPosition: ControlPosition = { edge: "right", y: 0.78 };

export type ControlEdge = "left" | "right";

export interface ControlPosition {
  edge: ControlEdge;
  y: number;
}

export interface ViewportBounds {
  height: number;
  width: number;
}

export interface PixelPosition {
  x: number;
  y: number;
}

export type VerticalZone = "top" | "middle" | "bottom";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function verticalTrack(viewport: ViewportBounds, margin: number, reservedBottom: number): number {
  return Math.max(0, viewport.height - (margin * 2) - controlOrbSize - reservedBottom);
}

export function parseControlPosition(serialized: string | null): ControlPosition {
  try {
    const value = JSON.parse(serialized ?? "null") as Partial<ControlPosition> | null;
    if ((value?.edge === "left" || value?.edge === "right") &&
      typeof value.y === "number" && Number.isFinite(value.y)) {
      return { edge: value.edge, y: clamp(value.y, 0, 1) };
    }
  } catch {
    // Invalid browser state falls back to the stable default.
  }
  return defaultControlPosition;
}

export function positionToPixels(
  position: ControlPosition,
  viewport: ViewportBounds,
  margin = 16,
  reservedBottom = 0,
): PixelPosition {
  const track = verticalTrack(viewport, margin, reservedBottom);
  return {
    x: position.edge === "left" ? margin : Math.max(margin, viewport.width - margin - controlOrbSize),
    y: margin + (track * clamp(position.y, 0, 1)),
  };
}

export function positionFromPixels(
  point: PixelPosition,
  viewport: ViewportBounds,
  margin = 16,
  reservedBottom = 0,
): ControlPosition {
  const track = verticalTrack(viewport, margin, reservedBottom);
  return {
    edge: point.x + (controlOrbSize / 2) < viewport.width / 2 ? "left" : "right",
    y: track === 0 ? 0 : clamp((point.y - margin) / track, 0, 1),
  };
}

export function clampDragPoint(
  point: PixelPosition,
  viewport: ViewportBounds,
  margin = 16,
  reservedBottom = 0,
): PixelPosition {
  return {
    x: clamp(point.x, margin, Math.max(margin, viewport.width - margin - controlOrbSize)),
    y: clamp(
      point.y,
      margin,
      Math.max(margin, viewport.height - margin - controlOrbSize - reservedBottom),
    ),
  };
}

export function moveControlPosition(
  position: ControlPosition,
  key: string,
  viewport: ViewportBounds,
  reservedBottom = 0,
): ControlPosition {
  if (key === "Home") return defaultControlPosition;
  if (key === "ArrowLeft") return { ...position, edge: "left" };
  if (key === "ArrowRight") return { ...position, edge: "right" };
  const track = verticalTrack(viewport, 16, reservedBottom);
  const step = track === 0 ? 0 : 44 / track;
  if (key === "ArrowUp") return { ...position, y: clamp(position.y - step, 0, 1) };
  if (key === "ArrowDown") return { ...position, y: clamp(position.y + step, 0, 1) };
  return position;
}

export function verticalZone(y: number): VerticalZone {
  if (y < 0.28) return "top";
  if (y > 0.72) return "bottom";
  return "middle";
}

export function radialOffsets(
  edge: ControlEdge,
  zone: VerticalZone,
): ReadonlyArray<readonly [number, number]> {
  const horizontal = edge === "left" ? 1 : -1;
  const vertical = zone === "bottom" ? -1 : 1;
  if (zone === "middle") {
    return [
      [horizontal * 78, -64],
      [horizontal * 96, -22],
      [horizontal * 96, 22],
      [horizontal * 78, 64],
    ];
  }
  return [
    [horizontal * 76, 0],
    [horizontal * 70, vertical * 48],
    [horizontal * 50, vertical * 82],
    [0, vertical * 96],
  ];
}

export function radialCardOffset(
  edge: ControlEdge,
  offsets: ReadonlyArray<readonly [number, number]>,
): number {
  if (edge === "left") {
    const actionRight = Math.max(...offsets.map(([x]) => radialActionInset + x + radialActionSize));
    return actionRight + radialCardGap;
  }
  const actionLeft = Math.min(...offsets.map(([x]) => radialActionInset + x));
  return Math.abs(actionLeft) + radialCardGap;
}
