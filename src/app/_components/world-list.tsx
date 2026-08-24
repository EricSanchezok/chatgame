"use client";

import Link from "next/link";
import { LoaderCircle, Upload } from "lucide-react";
import type { ChangeEvent } from "react";
import type { PublicSessionSummary, WorldSummary } from "../../shared/world-api";

export function WorldList({
  busy,
  onImport,
  selectedWorldId,
  sessions,
  worlds,
}: {
  busy?: string;
  onImport: (file: File) => Promise<void>;
  selectedWorldId?: string;
  sessions: PublicSessionSummary[];
  worlds: WorldSummary[];
}) {
  function selectFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) void onImport(file).catch(() => undefined).finally(() => { event.target.value = ""; });
  }

  return (
    <aside className="cg-world-sidebar" aria-label="已安装世界">
      <div className="cg-world-sidebar__heading">
        <p className="cg-eyebrow">本地世界</p>
        <h2>世界包</h2>
      </div>
      <nav className="cg-world-nav" aria-label="世界包列表">
        {worlds.map((world) => {
          const worldSessions = sessions.filter((session) => session.worldId === world.id);
          const running = worldSessions.filter((session) => session.activeRun).length;
          return (
            <Link
              aria-current={world.id === selectedWorldId ? "page" : undefined}
              href={`/worlds/${encodeURIComponent(world.id)}`}
              key={world.id}
            >
              <strong>{world.name}</strong>
              <span>版本 {world.version} · {worldSessions.length} 份存档</span>
              {running > 0 ? <small><LoaderCircle aria-hidden="true" />{running} 个世界正在推演</small> : null}
            </Link>
          );
        })}
      </nav>
      <label className="cg-import-world">
        <Upload aria-hidden="true" />
        <span><strong>{busy?.startsWith("world-import:") ? "正在导入…" : "导入世界包"}</strong><small>选择 schema v6 ZIP</small></span>
        <input accept=".zip,application/zip" disabled={busy?.startsWith("world-import:")} onChange={selectFile} type="file" />
      </label>
    </aside>
  );
}
