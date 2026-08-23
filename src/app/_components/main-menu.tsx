"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, LibraryBig, Settings, Waypoints } from "lucide-react";
import type { PublicSessionSummary } from "../../shared/world-api";
import { CURRENT_SESSION_KEY } from "../_lib/browser-state";
import { worldApi } from "../lib/world-api-client";

export function MainMenu() {
  const [current, setCurrent] = useState<PublicSessionSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void worldApi.sessions()
      .then(({ sessions }) => {
        if (!active) return;
        const currentId = localStorage.getItem(CURRENT_SESSION_KEY);
        const selected = sessions.find((session) => session.id === currentId);
        if (!selected && currentId) localStorage.removeItem(CURRENT_SESSION_KEY);
        setCurrent(selected);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <main className="cg-menu">
      <div className="cg-menu__atmosphere" aria-hidden="true">
        <span>WORLD / LOCAL</span>
        <span>TRUTH / PERSISTENT</span>
      </div>
      <section className="cg-menu__content" aria-labelledby="menu-title">
        <p className="cg-eyebrow">LIVING WORLD ENGINE</p>
        <h1 id="menu-title">世界在等待<br />你的下一句话。</h1>
        <p className="cg-menu__lede">剧本定义世界，语言推动命运。每一次行动都会被世界共同理解，并在本地持续生长。</p>

        {error ? <p className="cg-alert" role="alert">{error}</p> : null}

        <nav className="cg-menu__actions" aria-label="游戏菜单">
          {loading ? <p className="cg-muted" aria-live="polite">正在寻找上一次旅程…</p> : null}
          {!loading && current ? (
            <Link className="cg-primary-action" href={`/play/${encodeURIComponent(current.id)}`}>
              <span>
                <small>继续当前世界</small>
                <strong>{current.title}</strong>
              </span>
              <ArrowRight aria-hidden="true" />
            </Link>
          ) : null}
          {!loading && !current ? (
            <Link className="cg-primary-action" href="/worlds">
              <span>
                <small>没有正在进行的旅程</small>
                <strong>开始新游戏</strong>
              </span>
              <ArrowRight aria-hidden="true" />
            </Link>
          ) : null}
          <div className="cg-menu__secondary">
            <Link href="/worlds"><Waypoints aria-hidden="true" />新游戏</Link>
            <Link href="/saves"><LibraryBig aria-hidden="true" />存档</Link>
            <Link href="/settings"><Settings aria-hidden="true" />设置</Link>
          </div>
        </nav>
      </section>
      <footer className="cg-menu__footer">
        <span>仅在这台设备运行</span>
        <span>自动保存</span>
      </footer>
    </main>
  );
}
