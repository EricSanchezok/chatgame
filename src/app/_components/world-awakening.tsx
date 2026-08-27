"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Eye } from "lucide-react";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useMemo, useRef } from "react";
import type { CreateInstanceInput, OriginView, WorldSummary } from "../../shared/world-api";

const premiumEase = [0.4, 0, 0.2, 1] as const;

export interface WorldWeaveSignature {
  arcs: [number, number, number];
  nodes: Array<{ delay: number; radius: number; size: number; x: number; y: number }>;
  paths: [string, string];
  pulseScale: number;
}

function signatureBytes(contentHash: string): number[] {
  const hexadecimal = contentHash.replace(/^sha256:/i, "").replace(/[^0-9a-f]/gi, "");
  if (hexadecimal.length >= 32) {
    return Array.from({ length: 16 }, (_, index) => Number.parseInt(hexadecimal.slice(index * 2, index * 2 + 2), 16));
  }
  const source = contentHash || "living-world";
  return Array.from({ length: 16 }, (_, index) => {
    const first = source.charCodeAt(index % source.length);
    const second = source.charCodeAt((index * 7 + 3) % source.length);
    return (first * 31 + second * 17 + index * 13) % 256;
  });
}

export function worldWeaveSignature(contentHash: string): WorldWeaveSignature {
  const bytes = signatureBytes(contentHash);
  const nodes = Array.from({ length: 8 }, (_, index) => {
    const angle = ((bytes[index] / 255) * 0.7 + index / 8) * Math.PI * 2;
    const radius = 78 + (bytes[index + 8] % 58);
    return {
      delay: 0.16 + index * 0.04,
      radius,
      size: 2.5 + (bytes[(index + 5) % bytes.length] % 4) * 0.65,
      x: 160 + Math.cos(angle) * radius,
      y: 160 + Math.sin(angle) * radius,
    };
  });
  const horizontalBend = 108 + (bytes[12] % 44);
  const verticalBend = 102 + (bytes[13] % 54);
  return {
    arcs: [bytes[9] % 70 - 35, bytes[10] % 70 - 35, bytes[11] % 70 - 35],
    nodes,
    paths: [
      `M 38 160 C ${horizontalBend} ${64 + bytes[14] % 58}, ${214 - bytes[15] % 48} ${246 - bytes[6] % 52}, 282 160`,
      `M 160 38 C ${250 - bytes[4] % 62} ${verticalBend}, ${65 + bytes[5] % 58} ${211 - bytes[7] % 42}, 160 282`,
    ],
    pulseScale: 1.018 + (bytes[8] % 8) / 1000,
  };
}

export function useAwakeningLeaveGuard(): void {
  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, []);
}

function WorldWeave({
  contentHash,
  mark,
  observer,
  reduceMotion,
}: {
  contentHash: string;
  mark: string;
  observer: boolean;
  reduceMotion: boolean;
}) {
  const signature = useMemo(() => worldWeaveSignature(contentHash), [contentHash]);
  const shouldReduceMotion = reduceMotion;
  return (
    <m.div
      animate={{ opacity: 1, scale: 1 }}
      className="cg-world-weave"
      initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 }}
      transition={{ duration: shouldReduceMotion ? 0.12 : 0.76, ease: premiumEase }}
    >
      <m.svg aria-hidden="true" className="cg-world-weave__svg" viewBox="0 0 320 320">
        <circle className="cg-world-weave__boundary" cx="160" cy="160" r="148" />
        {[72, 106, 138].map((radius, index) => (
          <m.ellipse
            animate={shouldReduceMotion
              ? { opacity: 0.58, pathLength: 1, rotate: signature.arcs[index] }
              : {
                  opacity: 0.58,
                  pathLength: 1,
                  rotate: [signature.arcs[index] - 2, signature.arcs[index] + 2, signature.arcs[index] - 2],
                }}
            className="cg-world-weave__orbit"
            cx="160"
            cy="160"
            initial={{ opacity: 0, pathLength: 0, rotate: signature.arcs[index] }}
            key={radius}
            rx={radius}
            ry={Math.round(radius * (0.54 + index * 0.08))}
            style={{ transformOrigin: "160px 160px" }}
            transition={shouldReduceMotion
              ? { duration: 0.12 }
              : {
                  opacity: { duration: 0.42, delay: index * 0.08 },
                  pathLength: { duration: 0.76, delay: index * 0.08, ease: premiumEase },
                  rotate: { duration: 12 + index * 3, ease: "easeInOut", repeat: Infinity },
                }}
          />
        ))}
        {signature.paths.map((path, index) => (
          <m.path
            animate={{ opacity: 0.72, pathLength: 1 }}
            className="cg-world-weave__path"
            d={path}
            initial={{ opacity: 0, pathLength: shouldReduceMotion ? 1 : 0 }}
            key={path}
            transition={shouldReduceMotion
              ? { duration: 0.12 }
              : { delay: 0.12 + index * 0.1, duration: 0.76, ease: premiumEase }}
          />
        ))}
        {signature.nodes.map((node, index) => (
          <m.circle
            animate={shouldReduceMotion
              ? { opacity: 0.72, scale: 1 }
              : { opacity: [0.42, 1, 0.42], scale: [0.82, 1, 0.82] }}
            className="cg-world-weave__node"
            cx={node.x}
            cy={node.y}
            initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0 }}
            key={`${node.x}:${node.y}`}
            r={node.size}
            style={{ transformOrigin: `${node.x}px ${node.y}px` }}
            transition={shouldReduceMotion
              ? { duration: 0.12 }
              : {
                  delay: node.delay,
                  duration: 3.8 + index * 0.24,
                  ease: "easeInOut",
                  repeat: Infinity,
                }}
          />
        ))}
      </m.svg>
      <m.div
        animate={shouldReduceMotion
          ? { opacity: 1, scale: 1 }
          : { opacity: 1, scale: [1, signature.pulseScale, 1] }}
        className="cg-world-weave__mark"
        initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.9 }}
        transition={shouldReduceMotion
          ? { duration: 0.12 }
          : {
              opacity: { delay: 0.18, duration: 0.42, ease: premiumEase },
              scale: { delay: 0.18, duration: 4.8, ease: "easeInOut", repeat: Infinity },
            }}
      >
        {observer ? <Eye aria-hidden="true" /> : <span aria-hidden="true">{mark}</span>}
      </m.div>
    </m.div>
  );
}

export function WorldAwakening({
  origin,
  reduceMotion,
  submission,
  world,
}: {
  origin?: OriginView;
  reduceMotion: boolean;
  submission: CreateInstanceInput;
  world: WorldSummary;
}) {
  useAwakeningLeaveGuard();
  const awakeningRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = Boolean(useReducedMotion()) || reduceMotion;
  const originStart = submission.start.kind === "origin" ? submission.start : undefined;
  const observer = !originStart;
  const displayName = originStart?.displayName ?? "观察者";
  const mark = observer ? "" : (origin?.title || displayName || world.name).slice(0, 1);
  const identity = observer ? "无人观察" : origin?.title ?? "已选身份";
  const location = observer ? "整个世界" : origin?.location ?? "世界入口";
  const shortHash = world.contentHash.replace(/^sha256:/i, "").slice(0, 8).toUpperCase();

  useEffect(() => {
    awakeningRef.current?.focus();
  }, []);

  return (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      className="cg-awakening"
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 16 }}
      ref={awakeningRef}
      tabIndex={0}
      transition={{ delay: shouldReduceMotion ? 0 : 0.1, duration: shouldReduceMotion ? 0.12 : 0.42, ease: premiumEase }}
    >
      <header className="cg-awakening__meta">
        <span>{world.name}</span>
        <span>世界标识 {shortHash}</span>
      </header>
      <div className="cg-awakening__main">
        <WorldWeave contentHash={world.contentHash} mark={mark} observer={observer} reduceMotion={shouldReduceMotion} />
        <div className="cg-awakening__copy">
          <p className="cg-eyebrow">{observer ? "观察方式已确认" : "身份已确认"}</p>
          <Dialog.Title asChild>
            <h2>世界正在苏醒</h2>
          </Dialog.Title>
          <Dialog.Description asChild>
            <p>
              {observer
                ? "正在唤醒世界中的行动者，并准备第一个可观察视角。"
                : `正在将「${displayName}」带到「${location}」，并生成你将看见的第一幕。`}
            </p>
          </Dialog.Description>
          <div className="cg-awakening__identity" aria-label={`已确认：${displayName}，${identity}，${location}`}>
            <strong>{displayName}</strong>
            <span>{identity} · {location}</span>
          </div>
        </div>
      </div>
      <p className="cg-awakening__notice" role="status" aria-live="polite">
        唤醒完成前请保持此页面开启。
      </p>
    </m.div>
  );
}
