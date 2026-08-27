export const controlOrbSize = 64;
export const radialActionSize = 44;
export const radialActionRadius = 104;
export const radialClusterInset = radialActionRadius + 56;
export const defaultControlPosition: ControlPosition = { x: 0.86, y: 0.72 };

export interface ControlPosition {
  x: number;
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

export type NoticeSide = "top" | "right" | "bottom" | "left";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(minimum, value), maximum);
}

function horizontalTrack(viewport: ViewportBounds, margin: number): number {
  return Math.max(0, viewport.width - (margin * 2) - controlOrbSize);
}

function verticalTrack(viewport: ViewportBounds, margin: number, reservedBottom: number): number {
  return Math.max(0, viewport.height - (margin * 2) - controlOrbSize - reservedBottom);
}

export function parseControlPosition(serialized: string | null): ControlPosition {
  try {
    const value = JSON.parse(serialized ?? "null") as Partial<ControlPosition> | null;
    if (typeof value?.x === "number" && Number.isFinite(value.x) &&
      typeof value.y === "number" && Number.isFinite(value.y)) {
      return { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) };
    }
  } catch {
    // Invalid or superseded browser state falls back to the stable default.
  }
  return defaultControlPosition;
}

export function positionToPixels(
  position: ControlPosition,
  viewport: ViewportBounds,
  margin = 16,
  reservedBottom = 0,
): PixelPosition {
  return {
    x: margin + (horizontalTrack(viewport, margin) * clamp(position.x, 0, 1)),
    y: margin + (verticalTrack(viewport, margin, reservedBottom) * clamp(position.y, 0, 1)),
  };
}

export function positionFromPixels(
  point: PixelPosition,
  viewport: ViewportBounds,
  margin = 16,
  reservedBottom = 0,
): ControlPosition {
  const xTrack = horizontalTrack(viewport, margin);
  const yTrack = verticalTrack(viewport, margin, reservedBottom);
  return {
    x: xTrack === 0 ? 0 : clamp((point.x - margin) / xTrack, 0, 1),
    y: yTrack === 0 ? 0 : clamp((point.y - margin) / yTrack, 0, 1),
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
  margin = 16,
): ControlPosition {
  if (key === "Home") return defaultControlPosition;
  const point = positionToPixels(position, viewport, margin, reservedBottom);
  const delta = 44;
  if (key === "ArrowLeft") point.x -= delta;
  if (key === "ArrowRight") point.x += delta;
  if (key === "ArrowUp") point.y -= delta;
  if (key === "ArrowDown") point.y += delta;
  return positionFromPixels(
    clampDragPoint(point, viewport, margin, reservedBottom),
    viewport,
    margin,
    reservedBottom,
  );
}

export function radialOffsets(count: number): ReadonlyArray<readonly [number, number]> {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const angle = -90 + (360 * index / count);
    const radians = angle * Math.PI / 180;
    return [
      radialActionRadius * Math.cos(radians),
      radialActionRadius * Math.sin(radians),
    ] as const;
  });
}

export function safeOpenPoint(
  point: PixelPosition,
  viewport: ViewportBounds,
  margin = 16,
  reservedBottom = 0,
): PixelPosition {
  const minimumX = margin + radialClusterInset - (controlOrbSize / 2);
  const maximumX = viewport.width - margin - radialClusterInset - (controlOrbSize / 2);
  const minimumY = margin + radialClusterInset - (controlOrbSize / 2);
  const maximumY = viewport.height - margin - reservedBottom - radialClusterInset - (controlOrbSize / 2);
  return {
    x: maximumX < minimumX ? point.x : clamp(point.x, minimumX, maximumX),
    y: maximumY < minimumY ? point.y : clamp(point.y, minimumY, maximumY),
  };
}

export function statusSide(point: PixelPosition, viewport: ViewportBounds): "top" | "bottom" {
  return point.y + controlOrbSize > viewport.height * 0.72 ? "top" : "bottom";
}

export function noticeSide(
  point: PixelPosition,
  viewport: ViewportBounds,
  reservedBottom = 0,
): NoticeSide {
  const spaces: Record<NoticeSide, number> = {
    top: point.y,
    right: viewport.width - point.x - controlOrbSize,
    bottom: viewport.height - reservedBottom - point.y - controlOrbSize,
    left: point.x,
  };
  return (Object.entries(spaces) as Array<[NoticeSide, number]>)
    .reduce((largest, candidate) => candidate[1] > largest[1] ? candidate : largest)[0];
}
