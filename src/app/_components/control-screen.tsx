"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { PublicSessionSummary } from "../../shared/world-api";
import { CURRENT_SESSION_KEY } from "../_lib/browser-state";
import { controlActions } from "../_lib/control-actions";
import { worldApi } from "../lib/world-api-client";

export function ControlScreen() {
  const router = useRouter();
  const [session, setSession] = useState<PublicSessionSummary>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void worldApi.sessions()
      .then(({ sessions }) => {
        if (!active) return;
        const id = localStorage.getItem(CURRENT_SESSION_KEY);
        setSession(sessions.find((candidate) => candidate.id === id));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, []);

  async function navigate(href: string): Promise<void> {
    try {
      if (session?.activeRun) {
        if (!window.confirm("世界仍在推演。离开前要安全取消当前行动吗？")) return;
        await worldApi.cancelRun(session.id, session.activeRun.id);
      }
      router.push(href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <main className="cg-control-page">
      <header>
        {session ? (
          <Link href={`/play/${encodeURIComponent(session.id)}`}>
            <ArrowLeft aria-hidden="true" /> 返回世界
          </Link>
        ) : <Link href="/"><ArrowLeft aria-hidden="true" /> 主菜单</Link>}
        <p className="cg-eyebrow">GAME CONTROL</p>
        <h1>游戏控制</h1>
        {session ? <p>{session.title} · 第 {session.step} 步 · {session.activeRun ? "推演中" : "已自动保存"}</p> : <p>当前没有选中的存档。</p>}
      </header>
      {error ? <p className="cg-alert" role="alert">{error}</p> : null}
      <nav className="cg-control-list" aria-label="游戏控制">
        {controlActions.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.href} onClick={() => void navigate(action.href)} type="button">
              <Icon aria-hidden="true" />
              <span><strong>{action.label}</strong><small>{action.description}</small></span>
              <ArrowRight aria-hidden="true" />
            </button>
          );
        })}
      </nav>
    </main>
  );
}
