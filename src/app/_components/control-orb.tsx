"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Check,
  LoaderCircle,
  Network,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import {
  clampDragPoint,
  defaultControlPosition,
  moveControlPosition,
  positionFromPixels,
  positionToPixels,
  radialCardOffset,
  radialOffsets,
  verticalZone,
  type ControlPosition,
  type PixelPosition,
  type ViewportBounds,
} from "../_lib/control-orb-position";
import {
  readControlPosition,
  writeControlPosition,
} from "../_lib/browser-state";
import { controlActions, type ControlAction } from "../_lib/control-actions";

export type ControlOrbPhase = "running" | "confirming" | "saved";

export interface ControlOrbStatus {
  elapsedSeconds: number;
  phase: ControlOrbPhase;
  sessionTitle: string;
  step: number;
  worldName: string;
}

type OrbStyle = CSSProperties & {
  "--cg-action-index"?: number;
  "--cg-action-x"?: string;
  "--cg-action-y"?: string;
};

type OrbCardStyle = CSSProperties & {
  "--cg-card-target-x"?: string;
};

interface DragState {
  moved: boolean;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  startX: number;
  startY: number;
}

const desktopQuery = "(min-width: 48rem)";
const minimumComposerSpace = 96;

function viewportBounds(): ViewportBounds {
  return { height: window.innerHeight, width: window.innerWidth };
}

function edgeMargin(): number {
  return window.matchMedia(desktopQuery).matches ? 16 : 12;
}

function compactTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h`;
}

function fullTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${remainder} 秒`;
  return `${remainder} 秒`;
}

function phaseLabel(phase: ControlOrbPhase): string {
  if (phase === "running") return "世界正在推演";
  if (phase === "confirming") return "正在确认行动";
  return "已自动保存";
}

function useDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(desktopQuery);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  );
}

function useComposerReservedSpace(docked: boolean): number {
  const [space, setSpace] = useState(minimumComposerSpace);

  useEffect(() => {
    let frame: number | undefined;
    const footer = document.querySelector<HTMLElement>('[data-slot="aui-thread-viewport-footer"]');
    const measure = () => {
      frame = undefined;
      const next = docked && footer
        ? Math.max(minimumComposerSpace, Math.ceil(window.innerHeight - footer.getBoundingClientRect().top + 16))
        : minimumComposerSpace;
      setSpace((current) => current === next ? current : next);
    };
    const schedule = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = footer ? new ResizeObserver(schedule) : undefined;
    if (footer) observer?.observe(footer);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [docked]);

  return space;
}

function subscribeMounted(): () => void {
  return () => undefined;
}

function StatusMetrics({ status }: { status: ControlOrbStatus }) {
  return (
    <dl className="cg-orb__metrics">
      <div><dt>步数</dt><dd>{status.step}</dd></div>
      <div><dt>时间</dt><dd>{fullTime(status.elapsedSeconds)}</dd></div>
      <div><dt>状态</dt><dd>{phaseLabel(status.phase)}</dd></div>
    </dl>
  );
}

export function ControlOrb({
  composerDocked,
  inspectorEnabled,
  onAction,
  onOpenInspector,
  status,
}: {
  composerDocked: boolean;
  inspectorEnabled: boolean;
  onAction: (kind: ControlAction["kind"]) => Promise<void> | void;
  onOpenInspector: () => void;
  status: ControlOrbStatus;
}) {
  const desktop = useDesktop();
  const reservedBottom = useComposerReservedSpace(composerDocked);
  const mounted = useSyncExternalStore(subscribeMounted, () => true, () => false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const pendingPointRef = useRef<PixelPosition | undefined>(undefined);
  const pixelRef = useRef<PixelPosition>({ x: 0, y: 0 });
  const ignoreClickRef = useRef(false);
  const [position, setPosition] = useState<ControlPosition>(() =>
    typeof window === "undefined" ? defaultControlPosition : readControlPosition());
  const [point, setPoint] = useState<PixelPosition>(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    return positionToPixels(
      readControlPosition(),
      viewportBounds(),
      edgeMargin(),
      reservedBottom,
    );
  });
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [exitConfirmation, setExitConfirmation] = useState(false);
  const actions = controlActions;
  const exitAction = actions.find((action) => action.kind === "exit")!;

  const applyPoint = useCallback((next: PixelPosition) => {
    pixelRef.current = next;
    setPoint(next);
  }, []);

  const place = useCallback((next: ControlPosition, persist: boolean) => {
    const pixels = positionToPixels(
      next,
      viewportBounds(),
      edgeMargin(),
      reservedBottom,
    );
    setPosition(next);
    applyPoint(pixels);
    if (persist) writeControlPosition(next);
  }, [applyPoint, reservedBottom]);

  useEffect(() => {
    const resize = () => place(position, false);
    const frame = requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [place, position]);

  useEffect(() => () => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setExitConfirmation(false);
      }
    };
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setExitConfirmation(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

  function schedulePoint(next: PixelPosition): void {
    pendingPointRef.current = next;
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      if (pendingPointRef.current) applyPoint(pendingPointRef.current);
    });
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    dragRef.current = {
      moved: false,
      offsetX: event.clientX - pixelRef.current.x,
      offsetY: event.clientY - pixelRef.current.y,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      setOpen(false);
    }
    schedulePoint(clampDragPoint(
      { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY },
      viewportBounds(),
      edgeMargin(),
      reservedBottom,
    ));
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    dragRef.current = undefined;
    if (!drag?.moved) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    if (pendingPointRef.current) applyPoint(pendingPointRef.current);
    const next = positionFromPixels(
      pendingPointRef.current ?? pixelRef.current,
      viewportBounds(),
      edgeMargin(),
      reservedBottom,
    );
    pendingPointRef.current = undefined;
    setDragging(false);
    ignoreClickRef.current = true;
    place(next, true);
  }

  function activate(): void {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (!desktop) {
      setExitConfirmation(false);
      setMobileOpen(true);
      return;
    }
    if (open) setExitConfirmation(false);
    setOpen((value) => !value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "Escape") {
      setOpen(false);
      setExitConfirmation(false);
      return;
    }
    if (!event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    place(moveControlPosition(position, event.key, viewportBounds(), reservedBottom), true);
    setOpen(false);
  }

  async function navigate(action: ControlAction, confirmed = false): Promise<void> {
    if (action.kind === "exit" && status.phase !== "saved" && !confirmed) {
      setExitConfirmation(true);
      return;
    }
    setOpen(false);
    setMobileOpen(false);
    setExitConfirmation(false);
    await onAction(action.kind);
  }

  function openInspector(): void {
    setOpen(false);
    setMobileOpen(false);
    setExitConfirmation(false);
    queueMicrotask(onOpenInspector);
  }

  const zone = verticalZone(position.y);
  const offsets = radialOffsets(position.edge, zone);
  const cardOffset = radialCardOffset(position.edge, offsets);
  const cardStyle: OrbCardStyle = {
    "--cg-card-target-x": position.edge === "left"
      ? `${cardOffset}px`
      : `calc(-100% - ${cardOffset}px)`,
  };
  const label = `${phaseLabel(status.phase)}；第 ${status.step} 步；世界时间 ${fullTime(status.elapsedSeconds)}`;

  return (
    <>
      <div
        className="cg-orb"
        data-dragging={dragging || undefined}
        data-open={open || undefined}
        data-phase={status.phase}
        ref={rootRef}
        style={mounted ? { transform: `translate3d(${point.x}px, ${point.y}px, 0)` } : undefined}
      >
        <button
          aria-controls={desktop ? "cg-orb-actions" : undefined}
          aria-expanded={desktop ? open : mobileOpen}
          aria-label={`${open || mobileOpen ? "关闭" : "打开"}游戏控制；${label}`}
          className="cg-orb__trigger"
          onClick={activate}
          onKeyDown={onKeyDown}
          onPointerCancel={finishDrag}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          ref={triggerRef}
          data-cg-orb-trigger
          title="拖动改变位置；Alt 加方向键移动；Alt 加 Home 复位"
          type="button"
        >
          <svg aria-hidden="true" className="cg-orb__progress" viewBox="0 0 50 50">
            <circle className="cg-orb__track" cx="25" cy="25" r="22" />
            <circle className="cg-orb__value" cx="25" cy="25" r="22" />
          </svg>
          <span className="cg-orb__time">{compactTime(status.elapsedSeconds)}</span>
          <span className="cg-orb__status-dot" />
        </button>

        <div
          aria-hidden={!open}
          aria-label="游戏控制"
          className="cg-orb__menu"
          id="cg-orb-actions"
        >
          {actions.map((action, index) => {
            const [x, y] = offsets[index];
            const Icon = action.icon;
            const style: OrbStyle = {
              "--cg-action-index": index,
              "--cg-action-x": `${x}px`,
              "--cg-action-y": `${y}px`,
            };
            return (
              <TooltipIconButton
                className="cg-orb__action"
                key={action.kind}
                onClick={() => void navigate(action)}
                style={style}
                tabIndex={open ? 0 : -1}
                tooltip={action.label}
              >
                <Icon aria-hidden="true" />
              </TooltipIconButton>
            );
          })}
        </div>

        <section
          aria-hidden={!open}
          className="cg-orb__card"
          data-edge={position.edge}
          data-zone={zone}
          style={cardStyle}
        >
          <h2>{status.worldName}</h2>
          <p>{status.sessionTitle}</p>
          <StatusMetrics status={status} />
          {exitConfirmation ? (
            <div className="cg-orb__exit-confirm" role="group" aria-label="确认返回主菜单">
              <p>当前行动会在后台继续推演。确定返回主菜单？</p>
              <div>
                <button onClick={() => void navigate(exitAction, true)} type="button">继续离开</button>
                <button onClick={() => setExitConfirmation(false)} type="button">留在游戏</button>
              </div>
            </div>
          ) : null}
          {!exitConfirmation && inspectorEnabled ? (
            <div className="cg-orb__tools">
              <span>开发者工具</span>
              <button onClick={openInspector} tabIndex={open ? 0 : -1} type="button">
                <Network aria-hidden="true" />
                <span><strong>世界演化</strong><small>查看完整推演与 Agent 认知</small></span>
              </button>
            </div>
          ) : null}
        </section>
      </div>

      <Sheet onOpenChange={(next) => { setMobileOpen(next); if (!next) setExitConfirmation(false); }} open={mobileOpen}>
        <SheetContent
          aria-describedby="cg-control-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <SheetTitle>{status.worldName}</SheetTitle>
          <SheetDescription id="cg-control-description">{status.sessionTitle}</SheetDescription>
          <dl className="cg-sheet-status">
            <div><dt>步数</dt><dd>{status.step}</dd></div>
            <div><dt>世界时间</dt><dd>{fullTime(status.elapsedSeconds)}</dd></div>
            <div>
              <dt>状态</dt>
              <dd>{status.phase === "saved" ? <Check aria-hidden="true" className="inline size-3.5" /> : <LoaderCircle aria-hidden="true" className="inline size-3.5" />} {phaseLabel(status.phase)}</dd>
            </div>
          </dl>
          <nav aria-label="游戏控制" className="cg-sheet-actions">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <button key={action.kind} onClick={() => void navigate(action)} type="button">
                  <Icon aria-hidden="true" className="size-5" />
                  <span><strong>{action.label}</strong><small>{action.description}</small></span>
                </button>
              );
            })}
          </nav>
          {!exitConfirmation && inspectorEnabled ? (
            <section className="cg-sheet-tools" aria-label="开发者工具">
              <h3>开发者工具</h3>
              <button onClick={openInspector} type="button">
                <Network aria-hidden="true" className="size-5" />
                <span><strong>打开世界演化</strong><small>查看完整推演、隐藏检定和 Agent 认知</small></span>
              </button>
            </section>
          ) : null}
          {exitConfirmation ? (
            <div className="cg-sheet-exit" role="group" aria-label="确认返回主菜单">
              <p>当前行动会在后台继续推演。确定返回主菜单？</p>
              <button onClick={() => void navigate(exitAction, true)} type="button">继续离开</button>
              <button className="cg-button--quiet" onClick={() => setExitConfirmation(false)} type="button">留在游戏</button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
