import type { WorldInspectorStreamEvent } from "../../shared/world-inspector-api";

export interface WorldInspectorRefreshDirty {
  window: boolean;
  invocations: boolean;
  detail: boolean;
}

export const emptyWorldInspectorRefreshDirty = (): WorldInspectorRefreshDirty => ({
  window: false,
  invocations: false,
  detail: false,
});

export function classifyWorldInspectorRuntimeEvent(event: WorldInspectorStreamEvent): WorldInspectorRefreshDirty | undefined {
  if (event.type !== "runtime") return undefined;
  const name = event.event.event;
  if (name.startsWith("model.")) return { window: false, invocations: true, detail: true };
  if (name.startsWith("step.") || name.startsWith("run.") || name.startsWith("execution.") ||
    name.startsWith("stage.") || name.startsWith("instance.bootstrap.") || name === "arrival.generated") {
    return { window: true, invocations: false, detail: false };
  }
  return undefined;
}

function mergeDirty(left: WorldInspectorRefreshDirty, right: WorldInspectorRefreshDirty): WorldInspectorRefreshDirty {
  return {
    window: left.window || right.window,
    invocations: left.invocations || right.invocations,
    detail: left.detail || right.detail,
  };
}

type Timer = ReturnType<typeof setTimeout>;

/** Coalesces a burst of SSE events into bounded trailing refreshes. */
export class WorldInspectorRefreshScheduler {
  private dirty = emptyWorldInspectorRefreshDirty();
  private trailingTimer: Timer | undefined;
  private maxTimer: Timer | undefined;
  private firstMarkedAt: number | undefined;

  constructor(
    private readonly onFlush: (dirty: WorldInspectorRefreshDirty) => void,
    private readonly trailingMs = 250,
    private readonly maxWaitMs = 750,
  ) {}

  mark(next: WorldInspectorRefreshDirty): void {
    this.dirty = mergeDirty(this.dirty, next);
    const now = Date.now();
    if (this.firstMarkedAt === undefined) {
      this.firstMarkedAt = now;
      this.maxTimer = setTimeout(() => this.flush(), this.maxWaitMs);
    }
    if (this.trailingTimer !== undefined) clearTimeout(this.trailingTimer);
    this.trailingTimer = setTimeout(() => this.flush(), this.trailingMs);
  }

  flushNow(): void {
    this.flush();
  }

  dispose(): void {
    if (this.trailingTimer !== undefined) clearTimeout(this.trailingTimer);
    if (this.maxTimer !== undefined) clearTimeout(this.maxTimer);
    this.trailingTimer = undefined;
    this.maxTimer = undefined;
    this.firstMarkedAt = undefined;
    this.dirty = emptyWorldInspectorRefreshDirty();
  }

  private flush(): void {
    if (!this.dirty.window && !this.dirty.invocations && !this.dirty.detail) return;
    const dirty = this.dirty;
    this.dirty = emptyWorldInspectorRefreshDirty();
    if (this.trailingTimer !== undefined) clearTimeout(this.trailingTimer);
    if (this.maxTimer !== undefined) clearTimeout(this.maxTimer);
    this.trailingTimer = undefined;
    this.maxTimer = undefined;
    this.firstMarkedAt = undefined;
    this.onFlush(dirty);
  }
}
