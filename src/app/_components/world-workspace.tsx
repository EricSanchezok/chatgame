"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { PublicSessionSummary, WorldSummary } from "../../shared/world-api";
import { useWorldLibrary } from "./use-world-library";
import { WorldDetail } from "./world-detail";
import { WorldList } from "./world-list";

export function WorldWorkspace({ selectedWorldId }: { selectedWorldId?: string }) {
  const router = useRouter();
  const library = useWorldLibrary();
  const recentWorldId = library.sessions.find((session) =>
    library.worlds.some((world) => world.id === session.worldId))?.worldId;
  const defaultWorldId = recentWorldId ?? library.worlds[0]?.id;
  const selectedWorld = library.worlds.find((world) =>
    world.id === (selectedWorldId ?? defaultWorldId));
  const selectedSessions = selectedWorld
    ? library.sessions.filter((session) => session.worldId === selectedWorld.id)
    : [];

  async function createSession(world: WorldSummary) {
    const detail = await library.createSession(world);
    router.push(`/play/${encodeURIComponent(detail.summary.id)}`);
    return detail;
  }

  async function deleteWorld(world: WorldSummary): Promise<void> {
    await library.deleteWorld(world);
    router.replace("/worlds");
  }

  async function importWorld(file: File): Promise<void> {
    const result = await library.importWorld(file);
    router.push(`/worlds/${encodeURIComponent(result.id)}`);
  }

  async function updateWorld(world: WorldSummary, file: File): Promise<void> {
    await library.importWorld(file, { expectedWorldId: world.id, replace: true });
  }

  async function renameSession(session: PublicSessionSummary, title: string): Promise<void> {
    await library.renameSession(session, title);
  }

  return (
    <main className="cg-world-workspace" data-world-selected={Boolean(selectedWorldId && selectedWorld) || undefined}>
      <header className="cg-workspace-bar">
        <Link className="cg-back-link" href="/"><ArrowLeft aria-hidden="true" />主菜单</Link>
        <span>世界包与本地存档</span>
      </header>
      <div className="cg-world-workspace__body">
        <WorldList
          busy={library.busy}
          onImport={importWorld}
          selectedWorldId={selectedWorld?.id}
          sessions={library.sessions}
          worlds={library.worlds}
        />
        <div className="cg-world-workspace__content">
          <div className="cg-feedback" aria-live="polite">
            {library.error ? <p className="cg-alert" role="alert">{library.error}</p> : null}
            {library.notice ? <p className="cg-notice">{library.notice}</p> : null}
          </div>
          {library.loading ? <div className="cg-workspace-empty" role="status">正在读取本地世界…</div> : null}
          {!library.loading && library.worlds.length === 0 ? (
            <div className="cg-workspace-empty">
              <h1>还没有安装世界包</h1>
              <p>使用左侧的“导入世界包”，安装一个 schema v6 ZIP 后开始游戏。</p>
            </div>
          ) : null}
          {!library.loading && selectedWorld ? (
            <WorldDetail
              busy={library.busy}
              onCreateSession={createSession}
              onDeleteSession={library.deleteSession}
              onDeleteWorld={deleteWorld}
              onRenameSession={renameSession}
              onUpdateWorld={updateWorld}
              sessions={selectedSessions}
              world={selectedWorld}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
