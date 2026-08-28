"use client";

import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  m,
  useMotionValue,
} from "motion/react";
import {
  Check,
  CircleAlert,
  LoaderCircle,
  Network,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  controlOrbSize,
  defaultControlPosition,
  floatingLabelOffset,
  moveControlPosition,
  noticeSide,
  positionFromPixels,
  positionToPixels,
  radialActionRadius,
  radialOffsets,
  safeOpenPoint,
  statusSide,
  type ControlPosition,
  type ViewportBounds,
} from "../_lib/control-orb-position";
import {
  readControlPosition,
  writeControlPosition,
} from "../_lib/browser-state";
import { controlActions, type ControlAction } from "../_lib/control-actions";
import { WorldSpirit } from "./world-spirit";

export type ControlOrbPhase = "running" | "confirming" | "saved";
export type ControlOrbNoticeTone = "success" | "warning" | "error";

export interface ControlOrbNotice {
  id: string;
  message: string;
  tone: Exclude<ControlOrbNoticeTone, "success">;
}

export interface ControlOrbStatus {
  elapsedSeconds: number;
  phase: ControlOrbPhase;
  sessionTitle: string;
  step: number;
  worldContentHash: string;
  worldName: string;
}

type RadialAction = ControlAction | {
  description: string;
  icon: typeof Network;
  kind: "inspector";
  label: string;
};

type OrbActionStyle = CSSProperties & {
  "--cg-action-lift-x"?: string;
  "--cg-action-lift-y"?: string;
};

type OrbLabelStyle = CSSProperties & {
  "--cg-orb-label-offset"?: string;
};

type BoundsStyle = CSSProperties & {
  inset: string;
};

interface RoutineNotice {
  id: string;
  message: string;
  tone: ControlOrbNoticeTone;
}

interface OrbDragState {
  lastAt: number;
  lastX: number;
  moved: boolean;
  originX: number;
  originY: number;
  pointerId: number;
  startX: number;
  startY: number;
}

const desktopQuery = "(min-width: 48rem)";
const minimumComposerSpace = 96;
const motionEase = [0.4, 0, 0.2, 1] as const;
const loadMotionFeatures = () => import("./motion-features").then((module) => module.default);

function viewportBounds(): ViewportBounds {
  return { height: window.innerHeight, width: window.innerWidth };
}

function edgeMargin(): number {
  return window.matchMedia(desktopQuery).matches ? 16 : 12;
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
  return "已保存";
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

function useMeasuredWidth<Element extends HTMLElement>(): [
  (node: Element | null) => void,
  number,
] {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);
  const measure = useCallback((node: Element | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const update = () => {
      const styles = getComputedStyle(node);
      const computedWidth = Number.parseFloat(styles.width);
      const extras = styles.boxSizing === "border-box"
        ? 0
        : Number.parseFloat(styles.paddingInlineStart) +
          Number.parseFloat(styles.paddingInlineEnd) +
          Number.parseFloat(styles.borderInlineStartWidth) +
          Number.parseFloat(styles.borderInlineEndWidth);
      const next = Math.ceil(computedWidth + extras);
      setWidth((current) => current === next ? current : next);
    };
    update();
    observerRef.current = new ResizeObserver(update);
    observerRef.current.observe(node);
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return [measure, width];
}

function MobileStatus({ status }: { status: ControlOrbStatus }) {
  return (
    <dl className="cg-sheet-status">
      <div><dt>步数</dt><dd>{status.step}</dd></div>
      <div><dt>世界时间</dt><dd>{fullTime(status.elapsedSeconds)}</dd></div>
      <div>
        <dt>状态</dt>
        <dd>
          {status.phase === "saved"
            ? <Check aria-hidden="true" className="inline size-3.5" />
            : <LoaderCircle aria-hidden="true" className="inline size-3.5" />}
          {" "}{phaseLabel(status.phase)}
        </dd>
      </div>
    </dl>
  );
}

export function ControlOrb({
  composerDocked,
  inspectorEnabled,
  notice,
  onAction,
  onOpenInspector,
  reduceMotion,
  status,
}: {
  composerDocked: boolean;
  inspectorEnabled: boolean;
  notice?: ControlOrbNotice;
  onAction: (kind: ControlAction["kind"]) => Promise<void> | void;
  onOpenInspector: () => void;
  reduceMotion: boolean;
  status: ControlOrbStatus;
}) {
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
        <ControlOrbContent
          composerDocked={composerDocked}
          inspectorEnabled={inspectorEnabled}
          notice={notice}
          onAction={onAction}
          onOpenInspector={onOpenInspector}
          reduceMotion={reduceMotion}
          status={status}
        />
      </MotionConfig>
    </LazyMotion>
  );
}

function ControlOrbContent({
  composerDocked,
  inspectorEnabled,
  notice,
  onAction,
  onOpenInspector,
  reduceMotion,
  status,
}: {
  composerDocked: boolean;
  inspectorEnabled: boolean;
  notice?: ControlOrbNotice;
  onAction: (kind: ControlAction["kind"]) => Promise<void> | void;
  onOpenInspector: () => void;
  reduceMotion: boolean;
  status: ControlOrbStatus;
}) {
  const desktop = useDesktop();
  const mounted = useSyncExternalStore(subscribeMounted, () => true, () => false);
  const reservedBottom = useComposerReservedSpace(composerDocked);
  const margin = mounted ? edgeMargin() : 16;
  const [viewport, setViewport] = useState<ViewportBounds>(() => (
    typeof window === "undefined" ? { height: 720, width: 1_280 } : viewportBounds()
  ));
  const [position, setPosition] = useState<ControlPosition>(() => (
    typeof window === "undefined" ? defaultControlPosition : readControlPosition()
  ));
  const initialPoint = positionToPixels(position, viewport, margin, reservedBottom);
  const dragX = useMotionValue(initialPoint.x - margin);
  const dragY = useMotionValue(initialPoint.y - margin);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<OrbDragState | undefined>(undefined);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const keyboardOpeningRef = useRef(false);
  const ignoreClickRef = useRef(false);
  const previousPhaseRef = useRef(status.phase);
  const exitConfirmRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [exitConfirmation, setExitConfirmation] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [gaze, setGaze] = useState<readonly [number, number] | null>(null);
  const [dismissedNoticeId, setDismissedNoticeId] = useState("");
  const [savedNoticeStep, setSavedNoticeStep] = useState<number>();
  const [measureHint, hintWidth] = useMeasuredWidth<HTMLSpanElement>();
  const [measureStatus, statusWidth] = useMeasuredWidth<HTMLDivElement>();

  const radialActions = useMemo<readonly RadialAction[]>(() => inspectorEnabled
    ? [...controlActions, {
        description: "查看完整推演、隐藏检定和 Agent 认知",
        icon: Network,
        kind: "inspector",
        label: "世界演化",
      }]
    : controlActions, [inspectorEnabled]);
  const offsets = useMemo(() => radialOffsets(radialActions.length), [radialActions.length]);
  const point = positionToPixels(position, viewport, margin, reservedBottom);
  const openPoint = desktop ? safeOpenPoint(point, viewport, margin, reservedBottom) : point;
  const displayedPoint = open ? openPoint : point;
  const shift = { x: openPoint.x - point.x, y: openPoint.y - point.y };
  const persistentNotice = notice && dismissedNoticeId !== notice.id ? notice : undefined;
  const routineNotice: RoutineNotice | undefined = status.phase === "confirming"
    ? { id: "confirming", message: "正在确认你的行动", tone: "success" }
    : status.phase === "running"
      ? { id: "running", message: "世界正在推演", tone: "success" }
      : savedNoticeStep !== undefined
        ? { id: `saved-${savedNoticeStep}`, message: "进度已自动保存", tone: "success" }
        : undefined;
  const displayedNotice = exitConfirmation
    ? undefined
    : persistentNotice ?? (!open && !dragging ? routineNotice : undefined);
  const displayedNoticeSide = noticeSide(displayedPoint, viewport, reservedBottom);
  const displayedStatusSide = statusSide(displayedPoint, viewport);
  const hintStyle: OrbLabelStyle = {
    "--cg-orb-label-offset": `${floatingLabelOffset(displayedPoint, hintWidth, viewport, margin)}px`,
  };
  const statusStyle: OrbLabelStyle = {
    "--cg-orb-label-offset": `${floatingLabelOffset(displayedPoint, statusWidth, viewport, margin)}px`,
  };
  const statusTone: ControlOrbNoticeTone | undefined = persistentNotice?.tone;
  const statusText = statusTone === "error"
    ? "行动失败"
    : statusTone === "warning"
      ? "同步中断"
      : phaseLabel(status.phase);
  const exitAction = controlActions.find((action) => action.kind === "exit")!;

  const place = useCallback((next: ControlPosition, persist: boolean) => {
    const nextPoint = positionToPixels(next, viewportBounds(), edgeMargin(), reservedBottom);
    setPosition(next);
    dragX.set(nextPoint.x - edgeMargin());
    dragY.set(nextPoint.y - edgeMargin());
    if (persist) writeControlPosition(next);
  }, [dragX, dragY, reservedBottom]);

  useEffect(() => {
    const resize = () => setViewport(viewportBounds());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (dragging) return;
    const next = positionToPixels(position, viewport, margin, reservedBottom);
    dragX.set(next.x - margin);
    dragY.set(next.y - margin);
  }, [dragX, dragY, dragging, margin, position, reservedBottom, viewport]);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = status.phase;
    if (status.phase !== "saved" || previous === "saved") return;
    const reveal = window.setTimeout(() => setSavedNoticeStep(status.step), 0);
    const dismiss = window.setTimeout(() => setSavedNoticeStep(undefined), 2_400);
    return () => {
      window.clearTimeout(reveal);
      window.clearTimeout(dismiss);
    };
  }, [status.phase, status.step]);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setExitConfirmation(false);
        setGaze(null);
      }
    };
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setExitConfirmation(false);
      setGaze(null);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

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
    const next = !open;
    setExitConfirmation(false);
    setOpen(next);
    setGaze(null);
    if (next && keyboardOpeningRef.current) {
      setActiveIndex(0);
      queueMicrotask(() => actionRefs.current[0]?.focus());
    }
    keyboardOpeningRef.current = false;
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "Enter" || event.key === " ") keyboardOpeningRef.current = true;
    if (event.key === "Escape") {
      setOpen(false);
      setExitConfirmation(false);
      setGaze(null);
      return;
    }
    if (!event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    place(moveControlPosition(position, event.key, viewport, reservedBottom, margin), true);
    setOpen(false);
  }

  function onActionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % radialActions.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + radialActions.length) % radialActions.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = radialActions.length - 1;
    else return;
    event.preventDefault();
    setActiveIndex(next);
    actionRefs.current[next]?.focus();
  }

  async function navigate(action: ControlAction, confirmed = false): Promise<void> {
    if (action.kind === "exit" && status.phase !== "saved" && !confirmed) {
      setExitConfirmation(true);
      queueMicrotask(() => exitConfirmRef.current?.focus());
      return;
    }
    setOpen(false);
    setMobileOpen(false);
    setExitConfirmation(false);
    setGaze(null);
    await onAction(action.kind);
  }

  function openInspector(): void {
    setOpen(false);
    setMobileOpen(false);
    setExitConfirmation(false);
    setGaze(null);
    queueMicrotask(onOpenInspector);
  }

  function activateRadialAction(action: RadialAction): void {
    if (action.kind === "inspector") openInspector();
    else void navigate(action);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0 || open) return;
    dragRef.current = {
      lastAt: performance.now(),
      lastX: event.clientX,
      moved: false,
      originX: dragX.get(),
      originY: dragY.get(),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    event.preventDefault();
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      setOpen(false);
      setExitConfirmation(false);
      setGaze(null);
    }
    const maximumX = Math.max(0, viewport.width - (margin * 2) - controlOrbSize);
    const maximumY = Math.max(0, viewport.height - (margin * 2) - reservedBottom - controlOrbSize);
    dragX.set(Math.min(maximumX, Math.max(0, drag.originX + dx)));
    dragY.set(Math.min(maximumY, Math.max(0, drag.originY + dy)));
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastAt);
    const velocity = (event.clientX - drag.lastX) / elapsed * 1_000;
    const tilt = Math.max(-4, Math.min(4, velocity / 450));
    rootRef.current?.style.setProperty("--cg-drag-tilt", `${tilt}deg`);
    drag.lastAt = now;
    drag.lastX = event.clientX;
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag?.moved) return;
    const absolute = {
      x: dragX.get() + margin,
      y: dragY.get() + margin,
    };
    const next = positionFromPixels(absolute, viewport, margin, reservedBottom);
    setPosition(next);
    writeControlPosition(next);
    setDragging(false);
    ignoreClickRef.current = true;
    rootRef.current?.style.setProperty("--cg-drag-tilt", "0deg");
  }

  const boundsStyle: BoundsStyle = {
    inset: `${margin}px ${margin}px ${reservedBottom + margin}px`,
  };
  const label = `${statusText}；第 ${status.step} 步；世界时间 ${fullTime(status.elapsedSeconds)}`;

  return (
    <>
      <div className="cg-orb__bounds" style={boundsStyle}>
        <m.div
          className="cg-orb"
          data-dragging={dragging || undefined}
          data-mounted={mounted || undefined}
          ref={rootRef}
          style={{ x: dragX, y: dragY }}
        >
          <m.div
            animate={{ x: open ? shift.x : 0, y: open ? shift.y : 0 }}
            className="cg-orb__cluster"
            data-open={open || undefined}
            data-phase={status.phase}
            data-tone={statusTone}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: motionEase }}
          >
            <button
              aria-controls={desktop ? "cg-orb-actions" : undefined}
              aria-describedby="cg-orb-instructions"
              aria-expanded={desktop ? open : mobileOpen}
              aria-label={`${open || mobileOpen ? "关闭" : "打开"}游戏控制；${label}`}
              className="cg-orb__trigger"
              data-cg-orb-trigger
              onClick={activate}
              onKeyDown={onTriggerKeyDown}
              onPointerCancel={finishDrag}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishDrag}
              ref={triggerRef}
              type="button"
            >
              <svg aria-hidden="true" className="cg-orb__progress" viewBox="0 0 64 64">
                <circle className="cg-orb__track" cx="32" cy="32" r="29" />
                <circle className="cg-orb__value" cx="32" cy="32" r="29" />
              </svg>
              <WorldSpirit
                appReducedMotion={reduceMotion}
                gaze={gaze}
                noticeTone={statusTone}
                phase={status.phase}
                worldContentHash={status.worldContentHash}
              />
              <span className="cg-orb__status-dot" />
            </button>
            <span className="cg-sr-only" id="cg-orb-instructions">
              拖动可改变位置。按住 Alt 并使用方向键移动，按住 Alt 并按 Home 恢复默认位置。
            </span>
            <span
              aria-hidden="true"
              className="cg-orb__hint"
              ref={measureHint}
              style={hintStyle}
            >
              拖动移动 · 点击展开
            </span>

            <AnimatePresence initial={false}>
              {!open && !dragging && !displayedNotice ? (
                <m.div
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="cg-orb__status"
                  data-side={displayedStatusSide}
                  data-tone={statusTone}
                  exit={{ opacity: 0, scale: 0.96, y: displayedStatusSide === "bottom" ? -4 : 4 }}
                  initial={{ opacity: 0, scale: 0.96, y: displayedStatusSide === "bottom" ? -4 : 4 }}
                  key={`${displayedStatusSide}:${statusText}`}
                  ref={measureStatus}
                  style={statusStyle}
                  transition={{ duration: 0.18, ease: motionEase }}
                >
                  {statusTone ? <CircleAlert aria-hidden="true" /> : status.phase === "saved" ? <Check aria-hidden="true" /> : <LoaderCircle aria-hidden="true" />}
                  <span>{statusText}</span>
                  <small>第 {status.step} 步</small>
                </m.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {open ? (
                <m.svg
                  animate={{ opacity: 1, scale: 1 }}
                  aria-hidden="true"
                  className="cg-orb__orbit"
                  exit={{ opacity: 0, scale: 0.92 }}
                  initial={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.3, ease: motionEase }}
                  viewBox="0 0 232 232"
                >
                  <m.circle
                    animate={{ pathLength: 1 }}
                    cx="116"
                    cy="116"
                    fill="none"
                    initial={{ pathLength: 0 }}
                    r={radialActionRadius}
                    transition={{ duration: 0.42, ease: motionEase }}
                  />
                </m.svg>
              ) : null}
            </AnimatePresence>

            <div
              aria-hidden={!open}
              aria-label="游戏控制"
              className="cg-orb__menu"
              id="cg-orb-actions"
              role="toolbar"
            >
              <AnimatePresence initial={false}>
                {open ? radialActions.map((action, index) => {
                  const [x, y] = offsets[index];
                  const Icon = action.icon;
                  const vector = [x / radialActionRadius, y / radialActionRadius] as const;
                  const style: OrbActionStyle = {
                    "--cg-action-lift-x": `${vector[0] * 2}px`,
                    "--cg-action-lift-y": `${vector[1] * 2}px`,
                  };
                  return (
                    <m.button
                      animate={{ filter: "blur(0px)", opacity: 1, scale: 1, x, y }}
                      aria-describedby={`cg-orb-action-description-${action.kind}`}
                      aria-label={action.label}
                      className="cg-orb__action"
                      data-kind={action.kind}
                      exit={{ filter: "blur(3px)", opacity: 0, scale: 0.5, x: x * 0.2, y: y * 0.2 }}
                      initial={{ filter: "blur(4px)", opacity: 0, scale: 0.25, x: 0, y: 0 }}
                      key={action.kind}
                      onBlur={() => setGaze(null)}
                      onClick={() => activateRadialAction(action)}
                      onFocus={() => { setActiveIndex(index); setGaze(vector); }}
                      onKeyDown={(event) => onActionKeyDown(event, index)}
                      onMouseEnter={() => setGaze(vector)}
                      onMouseLeave={() => setGaze(null)}
                      ref={(node) => { actionRefs.current[index] = node; }}
                      style={style}
                      tabIndex={activeIndex === index ? 0 : -1}
                      transition={{ delay: index * 0.03, duration: 0.3, ease: motionEase }}
                      type="button"
                    >
                      <span className="cg-orb__action-surface">
                        <Icon aria-hidden="true" />
                      </span>
                      <span aria-hidden="true" className="cg-orb__action-label">{action.label}</span>
                      <span className="cg-sr-only" id={`cg-orb-action-description-${action.kind}`}>
                        {action.description}
                      </span>
                    </m.button>
                  );
                }) : null}
              </AnimatePresence>
            </div>
            <AnimatePresence initial={false}>
              {displayedNotice ? (
                <m.div
                  animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                  aria-live={persistentNotice ? "off" : "polite"}
                  className="cg-orb__notice"
                  data-side={displayedNoticeSide}
                  data-tone={displayedNotice.tone}
                  exit={{ opacity: 0, scale: 0.96 }}
                  initial={{ opacity: 0, scale: 0.96 }}
                  key={displayedNotice.id}
                  role={persistentNotice ? undefined : "status"}
                  transition={{ duration: 0.24, ease: motionEase }}
                >
                  <span aria-hidden="true" className="cg-orb__notice-mark" />
                  <p>{displayedNotice.message}</p>
                  {persistentNotice ? (
                    <button
                      aria-label="关闭状态消息"
                      onClick={() => setDismissedNoticeId(persistentNotice.id)}
                      type="button"
                    >
                      <X aria-hidden="true" />
                    </button>
                  ) : null}
                </m.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {exitConfirmation ? (
                <m.div
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  aria-label="确认返回主菜单"
                  className="cg-orb__confirm"
                  data-side={displayedNoticeSide}
                  exit={{ opacity: 0, scale: 0.96, y: 4 }}
                  initial={{ opacity: 0, scale: 0.96, y: 6 }}
                  role="group"
                  transition={{ duration: 0.24, ease: motionEase }}
                >
                  <strong>返回主菜单？</strong>
                  <p>当前行动会在后台继续推演。</p>
                  <div>
                    <button onClick={() => void navigate(exitAction, true)} ref={exitConfirmRef} type="button">返回主菜单</button>
                    <button onClick={() => setExitConfirmation(false)} type="button">留在游戏</button>
                  </div>
                </m.div>
              ) : null}
            </AnimatePresence>

            <span aria-live="polite" className="cg-sr-only" role="status">
              {routineNotice && displayedNotice ? null : phaseLabel(status.phase)}
            </span>
          </m.div>
        </m.div>
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
          <MobileStatus status={status} />
          <nav aria-label="游戏控制" className="cg-sheet-actions">
            {controlActions.map((action) => {
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
              <button onClick={() => void navigate(exitAction, true)} type="button">返回主菜单</button>
              <button className="cg-button--quiet" onClick={() => setExitConfirmation(false)} type="button">留在游戏</button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
