"use client";

import { useRouter } from "next/navigation";
import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { CircleDot, X } from "lucide-react";
import {
  CONTROL_CORNER_KEY,
  readControlCorner,
  type ControlCorner,
} from "../_lib/browser-state";
import { controlActions } from "../_lib/control-actions";

type ActionStyle = CSSProperties & { "--cg-action-x": string; "--cg-action-y": string };

const offsets: Record<ControlCorner, Array<[number, number]>> = {
  "top-left": [[82, 0], [72, 46], [46, 72], [0, 82]],
  "top-right": [[-82, 0], [-72, 46], [-46, 72], [0, 82]],
  "bottom-left": [[82, 0], [72, -46], [46, -72], [0, -82]],
  "bottom-right": [[-82, 0], [-72, -46], [-46, -72], [0, -82]],
};

function keyboardCorner(current: ControlCorner, key: string): ControlCorner {
  const vertical = key === "ArrowUp" ? "top" : key === "ArrowDown" ? "bottom" : current.split("-")[0];
  const horizontal = key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : current.split("-")[1];
  return `${vertical}-${horizontal}` as ControlCorner;
}

export function ControlOrb({
  status,
  onNavigate,
}: {
  status: "running" | "saved";
  onNavigate: (href: string) => Promise<void>;
}) {
  const router = useRouter();
  const [corner, setCorner] = useState<ControlCorner>(() =>
    typeof window === "undefined" ? "bottom-right" : readControlCorner());
  const [open, setOpen] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const ignoreClick = useRef(false);

  function persist(next: ControlCorner): void {
    setCorner(next);
    localStorage.setItem(CONTROL_CORNER_KEY, next);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>): void {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>): void {
    if (!drag.current) return;
    if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 8) {
      drag.current.moved = true;
    }
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>): void {
    if (!drag.current?.moved) {
      drag.current = undefined;
      return;
    }
    const next = `${event.clientY < window.innerHeight / 2 ? "top" : "bottom"}-${event.clientX < window.innerWidth / 2 ? "left" : "right"}` as ControlCorner;
    persist(next);
    setOpen(false);
    ignoreClick.current = true;
    drag.current = undefined;
  }

  function activate(): void {
    if (ignoreClick.current) {
      ignoreClick.current = false;
      return;
    }
    if (window.matchMedia("(max-width: 47.999rem)").matches) {
      router.push("/control");
      return;
    }
    setOpen((value) => !value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "Escape") setOpen(false);
    if (event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      persist(keyboardCorner(corner, event.key));
    }
  }

  return (
    <div className="cg-orb" data-corner={corner} data-open={open || undefined}>
      {open ? (
        <div className="cg-orb__ring" aria-label="游戏控制">
          {controlActions.map((action, index) => {
            const [x, y] = offsets[corner][index];
            const Icon = action.icon;
            const style: ActionStyle = { "--cg-action-x": `${x}px`, "--cg-action-y": `${y}px` };
            return (
              <button key={action.href} onClick={() => void onNavigate(action.href)} style={style} title={action.label} type="button">
                <Icon aria-hidden="true" />
                <span className="cg-visually-hidden">{action.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <button
        className="cg-orb__trigger"
        aria-expanded={open}
        aria-label={`${open ? "关闭" : "打开"}游戏控制；${status === "running" ? "世界正在推演" : "已自动保存"}`}
        onClick={activate}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = undefined; }}
        title="拖动到任意角落；Alt + 方向键也可移动"
        type="button"
      >
        {open ? <X aria-hidden="true" /> : <CircleDot aria-hidden="true" />}
        <span className="cg-orb__pulse" data-running={status === "running" || undefined} />
      </button>
    </div>
  );
}
