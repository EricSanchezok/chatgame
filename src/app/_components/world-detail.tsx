"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Eye, Pause, Radio, Trash2, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import type {
  CreateInstanceInput,
  OriginView,
  PublicInstanceSummary,
  WorldStartOptions,
  WorldSummary,
} from "../../shared/world-api";
import { worldApi } from "../lib/world-api-client";

type StartChoice =
  | { key: string; kind: "origin"; origin: OriginView }
  | { key: "observer"; kind: "observer" };

function StartChoiceCard({
  choice,
  index,
  selected,
  worldId,
  onSelect,
  setRef,
}: {
  choice: StartChoice;
  index: number;
  selected: boolean;
  worldId: string;
  onSelect: () => void;
  setRef: (element: HTMLLabelElement | null) => void;
}) {
  const origin = choice.kind === "origin" ? choice.origin : undefined;
  return (
    <label className="cg-start-card" data-kind={choice.kind} ref={setRef}>
      <input checked={selected} name="start-choice" onChange={onSelect} type="radio" value={choice.key} />
      <span className="cg-start-card__surface">
        <span className="cg-start-card__visual" data-has-image={Boolean(origin?.image) || undefined}>
          {origin?.image ? (
          <Image
            alt={origin.image.alt}
            height={900}
            src={`/api/worlds/${encodeURIComponent(worldId)}/assets/${encodeURIComponent(origin.image.hash)}`}
            unoptimized
            width={720}
          />
          ) : choice.kind === "observer" ? (
            <Eye aria-hidden="true" />
          ) : (
            <span aria-hidden="true" className="cg-start-card__monogram">{origin?.title.slice(0, 1)}</span>
          )}
          <span className="cg-start-card__type">{choice.kind === "observer" ? "无人观察" : `身份 ${String(index + 1).padStart(2, "0")}`}</span>
        </span>
        <span className="cg-start-card__copy">
          <small>{origin?.location ?? "整个世界"}</small>
          <strong>{origin?.title ?? "观察世界"}</strong>
          <p>{origin?.fantasy ?? "不创建玩家角色，让所有 Agent 按自己的目标继续生活。"}</p>
          <em>{origin?.relationshipHooks[0] ?? (choice.kind === "observer" ? "之后可以接管任意空闲 Agent。" : "你的故事将从这里展开。")}</em>
        </span>
      </span>
    </label>
  );
}

export function WorldDetail({
  busy,
  instances,
  onCreateInstance,
  onDeleteInstance,
  onDeleteWorld,
  world,
}: {
  busy?: string;
  instances: PublicInstanceSummary[];
  onCreateInstance: (input: CreateInstanceInput) => Promise<void>;
  onDeleteInstance: (instance: PublicInstanceSummary) => Promise<void>;
  onDeleteWorld: (world: WorldSummary) => Promise<void>;
  world: WorldSummary;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [options, setOptions] = useState<WorldStartOptions>();
  const [startStage, setStartStage] = useState<"choice" | "customize">("choice");
  const [startKind, setStartKind] = useState<"origin" | "observer">("origin");
  const [originId, setOriginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [appearance, setAppearance] = useState("");
  const [motivation, setMotivation] = useState("");
  const [startError, setStartError] = useState("");
  const [nameError, setNameError] = useState("");
  const cardRefs = useRef<Array<HTMLLabelElement | null>>([]);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const startTriggerRef = useRef<HTMLButtonElement>(null);

  async function openStart(): Promise<void> {
    setStartOpen(true);
    setStartStage("choice");
    setOptions(undefined);
    setStartError("");
    setNameError("");
    setDisplayName("");
    setAppearance("");
    setMotivation("");
    try {
      const loaded = await worldApi.worldStartOptions(world.id);
      setOptions(loaded);
      const first = loaded.origins[0];
      if (first) {
        setStartKind("origin");
        setOriginId(first.id);
      } else {
        setStartKind("observer");
      }
    } catch {
      setStartError("开始选项暂时无法读取。");
    }
  }

  async function create(): Promise<void> {
    setStartError("");
    if (startKind === "origin" && !displayName.trim()) {
      setNameError("请先为这个角色取一个名字。");
      displayNameRef.current?.focus();
      return;
    }
    try {
      await onCreateInstance(startKind === "observer"
        ? { worldId: world.id, start: { kind: "observer" } }
        : {
            worldId: world.id,
            start: { kind: "origin", originId, displayName, appearance, motivation },
          });
    } catch {
      setStartError("新游戏暂时无法创建，请检查角色信息后重试。");
    }
  }

  const choices: StartChoice[] = options
    ? [
        ...options.origins.map((origin) => ({ key: `origin:${origin.id}`, kind: "origin" as const, origin })),
        { key: "observer" as const, kind: "observer" as const },
      ]
    : [];
  const selectedKey = startKind === "observer" ? "observer" : `origin:${originId}`;
  const selectedIndex = Math.max(0, choices.findIndex((choice) => choice.key === selectedKey));
  const selectedOrigin = options?.origins.find((origin) => origin.id === originId);

  function selectChoice(index: number): void {
    const choice = choices[index];
    if (!choice) return;
    if (choice.kind === "observer") {
      setStartKind("observer");
    } else {
      setStartKind("origin");
      setOriginId(choice.origin.id);
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => cardRefs.current[index]?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    }));
  }

  function continueStart(): void {
    if (startKind === "observer") {
      void create();
      return;
    }
    setStartStage("customize");
    window.requestAnimationFrame(() => displayNameRef.current?.focus());
  }

  return (
    <section className="cg-world-detail" aria-labelledby="world-detail-title">
      <header className="cg-world-detail__intro">
        <p className="cg-eyebrow">{world.participation === "open" ? "可参与的活世界" : "无人演化世界"}</p>
        <h1 id="world-detail-title">{world.name}</h1>
        <p>{world.description}</p>
      </header>
      <section className="cg-world-saves" aria-labelledby="world-instances-title">
        <div className="cg-world-saves__heading">
          <div><p className="cg-eyebrow">持续运行</p><h2 id="world-instances-title">世界实例</h2></div>
          <button
            className="cg-new-game"
            disabled={busy === `instance-create:${world.id}`}
            onClick={() => void openStart()}
            ref={startTriggerRef}
            type="button"
          >
            <span><small>选择出身或无人观察</small><strong>开始新游戏</strong></span>
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
        {instances.length === 0 ? (
          <div className="cg-workspace-empty"><h3>还没有实例</h3><p>开始新游戏，或创建一个完全自主演化的世界。</p></div>
        ) : (
          <ul className="cg-instance-list">
            {instances.map((instance) => (
              <li key={instance.id}>
                <Link href={`/play/${encodeURIComponent(instance.id)}`}>
                  <span><strong>{instance.title}</strong><small>Revision {instance.revision} · Step {instance.step}</small></span>
                  <span className="cg-instance-state">
                    {instance.schedulerMode === "realtime" ? <Radio aria-hidden="true" /> : <Pause aria-hidden="true" />}
                    {instance.schedulerMode === "realtime" ? "实时" : "已暂停"}
                  </span>
                </Link>
                <button
                  aria-label={`删除实例“${instance.title}”`}
                  disabled={busy === `instance-delete:${instance.id}`}
                  onClick={() => void onDeleteInstance(instance)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="cg-world-package" aria-labelledby="world-package-title">
        <div className="cg-world-package__header">
          <div><p className="cg-eyebrow">世界包</p><h2 id="world-package-title">版本与内容</h2></div>
          <button
            className="cg-button--quiet cg-button--danger"
            disabled={instances.length > 0}
            onClick={() => setConfirmDelete(true)}
            type="button"
          >
            <Trash2 aria-hidden="true" />卸载
          </button>
        </div>
        <dl className="cg-world-facts">
          <div><dt>版本</dt><dd>{world.version}</dd></div>
          <div><dt>内容标识</dt><dd>{world.contentHash}</dd></div>
        </dl>
        {confirmDelete ? (
          <div className="cg-inline-confirm" role="group" aria-label="确认卸载世界包">
            <p>卸载“{world.name}”？</p>
            <button onClick={() => void onDeleteWorld(world)} type="button">确认卸载</button>
            <button className="cg-button--quiet" onClick={() => setConfirmDelete(false)} type="button">取消</button>
          </div>
        ) : null}
      </section>

      <Dialog.Root
        onOpenChange={(open) => {
          setStartOpen(open);
          if (!open) {
            setStartStage("choice");
            setStartError("");
            setNameError("");
          }
        }}
        open={startOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="cg-modal-overlay" />
          <Dialog.Content
            className="cg-start-dialog cg-modal-surface"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              window.setTimeout(() => startTriggerRef.current?.focus(), 0);
            }}
          >
            <header>
              <p className="cg-eyebrow">新游戏 · {startStage === "choice" ? "选择入口" : "塑造角色"}</p>
              <Dialog.Title>{startStage === "choice" ? "选择你的身份" : `成为${selectedOrigin?.title ?? "这个角色"}`}</Dialog.Title>
              <Dialog.Description>
                {startStage === "choice"
                  ? "每个身份都有自己的起点、关系和风险；你也可以只观察这个世界。"
                  : "名字、外观与动机会成为角色的一部分，但不会改写这个出身的资源和处境。"}
              </Dialog.Description>
            </header>
            <div className="cg-start-dialog__content cg-modal-scroll">
              {startError ? <p className="cg-alert" role="alert">{startError}</p> : null}
              {!options ? <p className="cg-muted" role="status">正在准备身份…</p> : startStage === "choice" ? (
                <div className="cg-start-choice-step">
                  <fieldset>
                    <legend className="cg-sr-only">选择一个身份或观察世界</legend>
                    <div className="cg-start-deck__toolbar">
                      <p><strong>{String(selectedIndex + 1).padStart(2, "0")}</strong><span>/ {String(choices.length).padStart(2, "0")}</span></p>
                      <div aria-label="切换身份卡片" role="group">
                        <button
                          aria-label="上一张身份卡片"
                          disabled={selectedIndex === 0}
                          onClick={() => selectChoice(selectedIndex - 1)}
                          type="button"
                        ><ChevronLeft aria-hidden="true" /></button>
                        <button
                          aria-label="下一张身份卡片"
                          disabled={selectedIndex === choices.length - 1}
                          onClick={() => selectChoice(selectedIndex + 1)}
                          type="button"
                        ><ChevronRight aria-hidden="true" /></button>
                      </div>
                    </div>
                    <div className="cg-start-deck__viewport">
                      <div className="cg-start-deck">
                        {choices.map((choice, index) => (
                          <StartChoiceCard
                            choice={choice}
                            index={index}
                            key={choice.key}
                            onSelect={() => selectChoice(index)}
                            selected={choice.key === selectedKey}
                            setRef={(element) => { cardRefs.current[index] = element; }}
                            worldId={world.id}
                          />
                        ))}
                      </div>
                    </div>
                  </fieldset>
                  <footer className="cg-start-choice-step__footer">
                    <p>
                      <span>{startKind === "observer" ? "观察者" : "已选身份"}</span>
                      <strong>{startKind === "observer" ? "观察世界" : selectedOrigin?.title}</strong>
                    </p>
                    <button className="cg-start-dialog__confirm" disabled={Boolean(busy)} onClick={continueStart} type="button">
                      {busy ? "正在唤醒世界…" : startKind === "observer" ? "开始观察" : "继续塑造角色"}
                      <ArrowRight aria-hidden="true" />
                    </button>
                  </footer>
                </div>
              ) : (
                <form className="cg-origin-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
                  <button className="cg-start-dialog__back" onClick={() => setStartStage("choice")} type="button">
                    <ArrowLeft aria-hidden="true" />重新选择身份
                  </button>
                  <section className="cg-selected-origin" aria-label="当前选择的身份">
                    <span aria-hidden="true" className="cg-selected-origin__mark">{selectedOrigin?.title.slice(0, 1)}</span>
                    <span><small>{selectedOrigin?.location}</small><strong>{selectedOrigin?.title}</strong><p>{selectedOrigin?.fantasy}</p></span>
                  </section>
                  <fieldset className="cg-origin-customization">
                    <legend className="cg-sr-only">角色定制</legend>
                    <label>
                      你的名字
                      <input
                        aria-describedby={nameError ? "cg-display-name-error" : undefined}
                        aria-invalid={Boolean(nameError) || undefined}
                        autoComplete="off"
                        maxLength={80}
                        onChange={(event) => { setDisplayName(event.target.value); setNameError(""); }}
                        ref={displayNameRef}
                        value={displayName}
                      />
                      {nameError ? <small id="cg-display-name-error" role="alert">{nameError}</small> : null}
                    </label>
                    <label>外观描述<textarea maxLength={500} onChange={(event) => setAppearance(event.target.value)} placeholder="例如：衣着、体态或引人注意的细节" rows={4} value={appearance} /></label>
                    <label>一个自由动机<textarea maxLength={500} onChange={(event) => setMotivation(event.target.value)} placeholder="你此刻最想做成什么？" rows={4} value={motivation} /></label>
                  </fieldset>
                  <footer className="cg-origin-form__footer">
                    <p>角色创建后，世界会从这个身份可见的第一幕开始。</p>
                    <button className="cg-start-dialog__confirm" disabled={Boolean(busy)} type="submit">
                      {busy ? "正在唤醒世界…" : "进入世界"}<ArrowRight aria-hidden="true" />
                    </button>
                  </footer>
                </form>
              )}
            </div>
            <Dialog.Close aria-label="取消开始新游戏" className="cg-modal-close"><X aria-hidden="true" /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
