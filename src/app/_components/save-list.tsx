"use client";

import Link from "next/link";
import { ArrowRight, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useState, type MouseEvent } from "react";
import type { PublicSessionSummary } from "../../shared/world-api";

function elapsedTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}

export interface SaveListProps {
  busy?: string;
  currentSessionId?: string;
  sessions: PublicSessionSummary[];
  shouldConfirmNavigation?: (session: PublicSessionSummary) => boolean;
  onDelete: (session: PublicSessionSummary) => Promise<void>;
  onRename: (session: PublicSessionSummary, title: string) => Promise<void>;
}

export function SaveList({
  busy,
  currentSessionId,
  sessions,
  shouldConfirmNavigation,
  onDelete,
  onRename,
}: SaveListProps) {
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState("");
  const [deleteId, setDeleteId] = useState<string>();
  const [switchId, setSwitchId] = useState<string>();

  function beginRename(session: PublicSessionSummary): void {
    setEditingId(session.id);
    setTitle(session.title);
    setDeleteId(undefined);
    setSwitchId(undefined);
  }

  async function submitRename(session: PublicSessionSummary): Promise<void> {
    const normalized = title.trim();
    if (!normalized) return;
    try {
      await onRename(session, normalized);
      setEditingId(undefined);
    } catch {
      // The shared library controller exposes the actionable error beside the list.
    }
  }

  function handleNavigation(event: MouseEvent<HTMLAnchorElement>, session: PublicSessionSummary): void {
    if (!shouldConfirmNavigation?.(session)) return;
    event.preventDefault();
    setSwitchId(session.id);
    setDeleteId(undefined);
    setEditingId(undefined);
  }

  return (
    <div className="cg-library-saves">
      {sessions.map((session) => {
        const isCurrent = session.id === currentSessionId;
        const isRunning = Boolean(session.activeRun);
        const isBusy = busy?.endsWith(session.id) === true;
        return (
          <article className="cg-library-save" data-current={isCurrent || undefined} key={session.id}>
            <div className="cg-library-save__content">
              <div className="cg-library-save__labels">
                {isCurrent ? <span className="cg-badge">当前游戏</span> : null}
                {isRunning ? <span className="cg-badge cg-badge--running"><LoaderCircle aria-hidden="true" />推演中</span> : null}
                <span>世界版本 {session.world.version}</span>
              </div>
              {editingId === session.id ? (
                <form className="cg-inline-form" onSubmit={(event) => { event.preventDefault(); void submitRename(session); }}>
                  <label htmlFor={`save-title-${session.id}`}>存档名称</label>
                  <input
                    autoFocus
                    id={`save-title-${session.id}`}
                    maxLength={80}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                  <button disabled={isBusy} type="submit">保存名称</button>
                  <button className="cg-button--quiet" onClick={() => setEditingId(undefined)} type="button">取消</button>
                </form>
              ) : <h3>{session.title}</h3>}
              <p className="cg-library-save__meta">
                第 {session.step} 步 · 世界时间 {elapsedTime(session.elapsedSeconds)} · {new Date(session.updatedAt).toLocaleString("zh-CN")}
              </p>
            </div>

            <div className="cg-library-save__actions">
              <Link
                href={`/play/${encodeURIComponent(session.id)}`}
                onClick={(event) => handleNavigation(event, session)}
              >
                {isCurrent ? "返回游戏" : "继续游戏"}<ArrowRight aria-hidden="true" />
              </Link>
              <button
                aria-label={`重命名存档“${session.title}”`}
                className="cg-icon-button"
                disabled={isRunning || isBusy}
                onClick={() => beginRename(session)}
                type="button"
              >
                <Pencil aria-hidden="true" />
              </button>
              {!isCurrent ? (
                <button
                  aria-label={`删除存档“${session.title}”`}
                  className="cg-icon-button cg-icon-button--danger"
                  disabled={isRunning || isBusy}
                  onClick={() => { setDeleteId(session.id); setEditingId(undefined); setSwitchId(undefined); }}
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {isRunning ? <p className="cg-library-save__note">推演结束前不能重命名或删除这份存档。</p> : null}
            {isCurrent ? <p className="cg-library-save__note">当前存档需要回到世界包工作台后才能删除。</p> : null}
            {deleteId === session.id ? (
              <div className="cg-inline-confirm" role="group" aria-label={`确认删除存档“${session.title}”`}>
                <p>永久删除“{session.title}”？这段旅程无法恢复。</p>
                <button disabled={isBusy} onClick={() => void onDelete(session).then(() => setDeleteId(undefined)).catch(() => undefined)} type="button">删除存档</button>
                <button className="cg-button--quiet" onClick={() => setDeleteId(undefined)} type="button">取消</button>
              </div>
            ) : null}
            {switchId === session.id ? (
              <div className="cg-inline-confirm cg-inline-confirm--switch" role="group" aria-label={`确认切换到存档“${session.title}”`}>
                <p>当前存档仍在推演。切换后它会在后台继续运行。</p>
                <Link href={`/play/${encodeURIComponent(session.id)}`}>继续切换<ArrowRight aria-hidden="true" /></Link>
                <button className="cg-button--quiet" onClick={() => setSwitchId(undefined)} type="button">取消</button>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
