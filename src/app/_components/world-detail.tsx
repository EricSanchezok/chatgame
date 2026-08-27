"use client";

import Link from "next/link";
import { ArrowRight, Pause, Radio, Trash2 } from "lucide-react";
import { useState } from "react";
import type { PublicInstanceSummary, WorldSummary } from "../../shared/world-api";

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
  onCreateInstance: (world: WorldSummary) => Promise<void>;
  onDeleteInstance: (instance: PublicInstanceSummary) => Promise<void>;
  onDeleteWorld: (world: WorldSummary) => Promise<void>;
  world: WorldSummary;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
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
          <button className="cg-new-game" disabled={busy === `instance-create:${world.id}`}
            onClick={() => void onCreateInstance(world)} type="button">
            <span><small>从世界起点初始化</small><strong>{busy ? "请稍候…" : "创建实例"}</strong></span>
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
        {instances.length === 0 ? <div className="cg-workspace-empty"><h3>还没有实例</h3><p>实例可以无人运行，也可以稍后进入。</p></div> : (
          <ul className="cg-instance-list">
            {instances.map((instance) => (
              <li key={instance.id}>
                <Link href={`/play/${encodeURIComponent(instance.id)}`}>
                  <span><strong>{instance.title}</strong><small>Revision {instance.revision} · Step {instance.step}</small></span>
                  <span className="cg-instance-state">{instance.schedulerMode === "realtime" ? <Radio aria-hidden="true" /> : <Pause aria-hidden="true" />}{instance.schedulerMode === "realtime" ? "实时" : "已暂停"}</span>
                </Link>
                <button aria-label={`删除实例“${instance.title}”`} disabled={busy === `instance-delete:${instance.id}`}
                  onClick={() => void onDeleteInstance(instance)} type="button"><Trash2 aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="cg-world-package" aria-labelledby="world-package-title">
        <div className="cg-world-package__header"><div><p className="cg-eyebrow">世界包</p><h2 id="world-package-title">版本与内容</h2></div>
          <button className="cg-button--quiet cg-button--danger" disabled={instances.length > 0}
            onClick={() => setConfirmDelete(true)} type="button"><Trash2 aria-hidden="true" />卸载</button></div>
        <dl className="cg-world-facts"><div><dt>版本</dt><dd>{world.version}</dd></div><div><dt>内容标识</dt><dd>{world.contentHash}</dd></div></dl>
        {confirmDelete ? <div className="cg-inline-confirm" role="group" aria-label="确认卸载世界包"><p>卸载“{world.name}”？</p>
          <button onClick={() => void onDeleteWorld(world)} type="button">确认卸载</button>
          <button className="cg-button--quiet" onClick={() => setConfirmDelete(false)} type="button">取消</button></div> : null}
      </section>
    </section>
  );
}
