"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import type { PublicSessionSummary } from "../../shared/world-api";
import { CURRENT_SESSION_KEY } from "../_lib/browser-state";
import { worldApi } from "../lib/world-api-client";
import { ManagementShell } from "./management-shell";

export function SavesScreen() {
  const [sessions, setSessions] = useState<PublicSessionSummary[]>([]);
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void worldApi.sessions()
      .then(({ sessions: result }) => { if (active) setSessions(result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function rename(session: PublicSessionSummary): Promise<void> {
    const normalized = title.trim();
    if (!normalized) return;
    setError("");
    try {
      const detail = await worldApi.renameSession(session.id, normalized);
      setSessions((current) => current.map((item) => item.id === session.id ? detail.summary : item));
      setEditing(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function remove(session: PublicSessionSummary): Promise<void> {
    if (!window.confirm(`永久删除存档“${session.title}”？此操作无法撤销。`)) return;
    setError("");
    try {
      await worldApi.deleteSession(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      if (localStorage.getItem(CURRENT_SESSION_KEY) === session.id) {
        localStorage.removeItem(CURRENT_SESSION_KEY);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <ManagementShell eyebrow="LOCAL ARCHIVE" title="存档" description="每个存档是一段独立旅程。它们共享同一个剧本世界，却拥有各自的时间、认知与选择。">
      {error ? <p className="cg-alert" role="alert">{error}</p> : null}
      {loading ? <p className="cg-empty-state" aria-live="polite">正在读取本地存档…</p> : null}
      {!loading && sessions.length === 0 ? (
        <section className="cg-empty-state">
          <h2>还没有旅程</h2>
          <p>选择一个世界，让第一句话成为它的开端。</p>
          <Link className="cg-text-link" href="/worlds">开始新游戏 <ArrowRight aria-hidden="true" /></Link>
        </section>
      ) : null}
      <div className="cg-save-list">
        {sessions.map((session) => (
          <article className="cg-save" key={session.id}>
            <div className="cg-save__main">
              <p className="cg-eyebrow">{session.world.name}</p>
              {editing === session.id ? (
                <form className="cg-rename" onSubmit={(event) => { event.preventDefault(); void rename(session); }}>
                  <label htmlFor={`title-${session.id}`}>存档名称</label>
                  <input id={`title-${session.id}`} maxLength={80} onChange={(event) => setTitle(event.target.value)} value={title} autoFocus required />
                  <button type="submit">保存名称</button>
                  <button className="cg-button--quiet" type="button" onClick={() => setEditing(undefined)}>取消</button>
                </form>
              ) : <h2>{session.title}</h2>}
              <p>第 {session.step} 步 · 世界时间 {session.elapsedSeconds} 秒 · {new Date(session.updatedAt).toLocaleString("zh-CN")}</p>
            </div>
            <div className="cg-save__actions">
              <Link href={`/play/${encodeURIComponent(session.id)}`} onClick={() => localStorage.setItem(CURRENT_SESSION_KEY, session.id)}>
                进入世界 <ArrowRight aria-hidden="true" />
              </Link>
              <button className="cg-icon-button" aria-label={`重命名 ${session.title}`} onClick={() => { setEditing(session.id); setTitle(session.title); }} type="button">
                <Pencil aria-hidden="true" />
              </button>
              <button className="cg-icon-button cg-icon-button--danger" aria-label={`删除 ${session.title}`} disabled={Boolean(session.activeRun)} onClick={() => void remove(session)} type="button">
                <Trash2 aria-hidden="true" />
              </button>
            </div>
            {session.activeRun ? <p className="cg-save__running">世界正在推演，结束后才能删除。</p> : null}
          </article>
        ))}
      </div>
    </ManagementShell>
  );
}
