"use client";

import { Blobatar } from "@blobatar/react";
import {
  happy,
  idle,
  sad,
  thinking,
  unsure,
  type Expression,
} from "blobatar/expression";
import { useReducedMotion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ControlOrbPhase, ControlOrbNoticeTone } from "./control-orb";

export type WorldSpiritPose = "idle" | "happy" | "sad" | "thinking" | "unsure";

type SpiritStyle = CSSProperties & {
  "--cg-spirit-gaze-x"?: number;
  "--cg-spirit-gaze-y"?: number;
};

const expressions: Record<WorldSpiritPose, Expression> = {
  happy,
  idle,
  sad,
  thinking,
  unsure,
};

// Decorative Blobatar silhouettes such as `nub` add detached circles around
// the body. At the control's 54px size those read as stray dots instead of a
// coherent character, so keep the world spirit's body round while allowing the
// world hash to continue driving its face and motion timing.
const worldSpiritTraits = { shape: 0.1 } as const;

export function worldSpiritPose(
  phase: ControlOrbPhase,
  tone?: ControlOrbNoticeTone,
  celebrating = false,
): WorldSpiritPose {
  if (tone === "error") return "sad";
  if (tone === "warning") return "unsure";
  if (celebrating) return "happy";
  if (phase === "confirming" || phase === "running") return "thinking";
  return "idle";
}

export function WorldSpirit({
  appReducedMotion,
  gaze,
  noticeTone,
  phase,
  worldContentHash,
}: {
  appReducedMotion: boolean;
  gaze: readonly [number, number] | null;
  noticeTone?: ControlOrbNoticeTone;
  phase: ControlOrbPhase;
  worldContentHash: string;
}) {
  const systemReducedMotion = Boolean(useReducedMotion());
  const reducedMotion = appReducedMotion || systemReducedMotion;
  const rootRef = useRef<HTMLSpanElement>(null);
  const previousPhaseRef = useRef(phase);
  const [celebrating, setCelebrating] = useState(false);
  const pose = worldSpiritPose(phase, noticeTone, celebrating);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (phase !== "saved" || previous === "saved") return;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), 900);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reset = () => {
      root.style.setProperty("--cg-spirit-gaze-x", "0");
      root.style.setProperty("--cg-spirit-gaze-y", "0");
    };
    if (reducedMotion) {
      reset();
      return;
    }
    if (gaze) {
      root.style.setProperty("--cg-spirit-gaze-x", String(gaze[0] * 1.8));
      root.style.setProperty("--cg-spirit-gaze-y", String(gaze[1] * 1.35));
      return;
    }
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!finePointer.matches) {
      reset();
      return;
    }
    let frame: number | undefined;
    let pointer = { x: 0, y: 0 };
    const render = () => {
      frame = undefined;
      const bounds = root.getBoundingClientRect();
      const dx = pointer.x - (bounds.left + bounds.width / 2);
      const dy = pointer.y - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance < 12) {
        reset();
        return;
      }
      const strength = Math.min(1, (distance - 12) / 308);
      root.style.setProperty("--cg-spirit-gaze-x", String((dx / distance) * strength * 1.8));
      root.style.setProperty("--cg-spirit-gaze-y", String((dy / distance) * strength * 1.35));
    };
    const track = (event: globalThis.PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (frame === undefined) frame = window.requestAnimationFrame(render);
    };
    const onVisibility = () => {
      if (document.hidden) reset();
    };
    window.addEventListener("pointermove", track, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", track);
      document.removeEventListener("visibilitychange", onVisibility);
      reset();
    };
  }, [gaze, reducedMotion]);

  const common = {
    background: false as const,
    expression: expressions[pose],
    name: worldContentHash || "living-world",
    palette: {
      head: "var(--cg-foreground)",
      eye: "var(--cg-background)",
    },
    size: 54,
    traits: worldSpiritTraits,
  };

  return (
    <span
      aria-hidden="true"
      className="cg-world-spirit"
      data-pose={pose}
      data-reduced-motion={reducedMotion || undefined}
      ref={rootRef}
      style={{ "--cg-spirit-gaze-x": 0, "--cg-spirit-gaze-y": 0 } as SpiritStyle}
    >
      <Blobatar {...common} animate={reducedMotion ? "hover" : "always"} focusable="false" />
    </span>
  );
}
