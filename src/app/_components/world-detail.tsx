"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Trash2 } from "lucide-react";
import type { PublicSessionDetail, PublicSessionSummary, WorldSummary } from "../../shared/world-api";
import { SaveList } from "./save-list";

export function WorldDetail({
  busy,
  onCreateSession,
  onDeleteSession,
  onDeleteWorld,
  onRenameSession,
  onUpdateWorld,
  sessions,
  world,
}: {
  busy?: string;
  onCreateSession: (world: WorldSummary) => Promise<PublicSessionDetail>;
  onDeleteSession: (session: PublicSessionSummary) => Promise<void>;
  onDeleteWorld: (world: WorldSummary) => Promise<void>;
  onRenameSession: (session: PublicSessionSummary, title: string) => Promise<void>;
  onUpdateWorld: (world: WorldSummary, file: File) => Promise<void>;
  sessions: PublicSessionSummary[];
  world: WorldSummary;
}) {
  const updateInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function selectUpdate(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) void onUpdateWorld(world, file).catch(() => undefined).finally(() => { event.target.value = ""; });
  }

  return (
    <section className="cg-world-detail" aria-labelledby="world-detail-title">
      <Link className="cg-world-detail__mobile-back cg-back-link" href="/worlds"><ArrowLeft aria-hidden="true" />全部世界</Link>
      <header className="cg-world-detail__header">
        <div>
          <p className="cg-eyebrow">世界包 · 版本 {world.version}</p>
          <h1 id="world-detail-title">{world.name}</h1>
          <p>{world.description}</p>
        </div>
        <div className="cg-world-detail__tools">
          <button className="cg-button--quiet" disabled={busy?.startsWith("world-import:")} onClick={() => updateInput.current?.click()} type="button">
            <RefreshCw aria-hidden="true" />更新世界包
          </button>
          <input ref={updateInput} className="cg-sr-only" accept=".zip,application/zip" onChange={selectUpdate} type="file" />
          <button
            className="cg-button--quiet cg-button--danger"
            disabled={sessions.length > 0 || busy === `world-delete:${world.id}`}
            onClick={() => setConfirmDelete(true)}
            type="button"
          >
            <Trash2 aria-hidden="true" />卸载世界包
          </button>
        </div>
        <dl className="cg-world-facts">
          <div><dt>存档</dt><dd>{sessions.length}</dd></div>
          <div><dt>推演中</dt><dd>{sessions.filter((session) => session.activeRun).length}</dd></div>
          <div><dt>内容标识</dt><dd>{world.contentHash}</dd></div>
        </dl>
        {sessions.length > 0 ? <p className="cg-world-detail__constraint">删除这个世界的全部存档后才能卸载世界包。</p> : null}
        {confirmDelete ? (
          <div className="cg-inline-confirm" role="group" aria-label={`确认卸载世界包“${world.name}”`}>
            <p>卸载“{world.name}”？之后需要重新导入才能开始新游戏。</p>
            <button onClick={() => void onDeleteWorld(world).catch(() => undefined)} type="button">卸载世界包</button>
            <button className="cg-button--quiet" onClick={() => setConfirmDelete(false)} type="button">取消</button>
          </div>
        ) : null}
      </header>

      <button
        className="cg-new-game"
        disabled={busy === `session-create:${world.id}`}
        onClick={() => void onCreateSession(world).catch(() => undefined)}
        type="button"
      >
        <span><small>从这个世界的起点开始</small><strong>{busy === `session-create:${world.id}` ? "正在创建新游戏…" : "开始新游戏"}</strong></span>
        <ArrowRight aria-hidden="true" />
      </button>

      <section className="cg-world-saves" aria-labelledby="world-saves-title">
        <div className="cg-world-saves__heading">
          <div>
            <p className="cg-eyebrow">本地旅程</p>
            <h2 id="world-saves-title">存档</h2>
          </div>
          <span>{sessions.length} 份</span>
        </div>
        {sessions.length === 0 ? (
          <div className="cg-workspace-empty">
            <h3>这个世界还没有存档</h3>
            <p>开始新游戏后，世界会在每一步自动保存。</p>
          </div>
        ) : (
          <SaveList
            busy={busy}
            onDelete={onDeleteSession}
            onRename={onRenameSession}
            sessions={sessions}
          />
        )}
      </section>
    </section>
  );
}
