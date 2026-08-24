"use client";

import Link from "next/link";
import { ArrowRight, Waypoints } from "lucide-react";
import { SettingsDialog } from "./settings-dialog";
import { useWorldLibrary } from "./use-world-library";

export function MainMenu() {
  const { error, loading, sessions, worlds } = useWorldLibrary();
  const running = sessions.filter((session) => session.activeRun).length;

  return (
    <main className="cg-launcher">
      <Link className="cg-launcher__brand" href="/" aria-label="Living World Engine 主菜单">
        <span aria-hidden="true">L</span>
        <strong>Living World Engine</strong>
      </Link>
      <div className="cg-launcher__field" aria-hidden="true" />
      <section className="cg-launcher__panel" aria-labelledby="launcher-title">
        <p className="cg-eyebrow">本地开放世界</p>
        <h1 id="launcher-title">从哪里开始？</h1>
        <p>选择一个世界继续旅程，或调整这台设备上的阅读体验。</p>
        {error ? <p className="cg-alert" role="alert">无法读取本地内容。进入世界包后可以重试。</p> : null}
        <div className="cg-launcher__actions">
          <Link className="cg-launcher__action" href="/worlds">
            <Waypoints aria-hidden="true" />
            <span>
              <strong>世界包</strong>
              <small>{loading ? "正在读取本地世界…" : `${worlds.length} 个世界 · ${sessions.length} 份存档${running > 0 ? ` · ${running} 个正在推演` : ""}`}</small>
            </span>
            <ArrowRight aria-hidden="true" />
          </Link>
          <SettingsDialog />
        </div>
      </section>
      <footer className="cg-launcher__footer">
        <span>仅在这台设备运行</span>
        <span>自动保存</span>
      </footer>
    </main>
  );
}
