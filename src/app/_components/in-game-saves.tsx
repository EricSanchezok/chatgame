"use client";

import type { PublicSessionSummary } from "../../shared/world-api";
import { SaveList } from "./save-list";
import { useGameSession } from "./game-session-context";
import { useWorldLibrary } from "./use-world-library";

export function InGameSaves() {
  const { interactionPending, session, updateSession } = useGameSession();
  const library = useWorldLibrary(session);
  const sessions = library.sessions.filter((candidate) => candidate.worldId === session.worldId);

  async function renameSession(candidate: PublicSessionSummary, title: string): Promise<void> {
    const renamed = await library.renameSession(candidate, title);
    if (renamed.id === session.id) updateSession(renamed);
  }

  return (
    <section className="cg-game-manage__section" aria-labelledby="game-saves-title">
      <header>
        <p className="cg-eyebrow">当前世界</p>
        <h2 id="game-saves-title">存档</h2>
        <p>查看和切换“{session.world.name}”中的旅程。其他世界请回到主菜单管理。</p>
      </header>
      <div className="cg-feedback" aria-live="polite">
        {library.error ? <p className="cg-alert" role="alert">{library.error}</p> : null}
        {library.notice ? <p className="cg-notice">{library.notice}</p> : null}
      </div>
      {library.loading ? <p className="cg-muted" role="status">正在读取存档…</p> : null}
      {!library.loading && sessions.length === 0 ? <p className="cg-muted">这个世界还没有存档。</p> : null}
      {!library.loading && sessions.length > 0 ? (
        <SaveList
          busy={library.busy}
          currentSessionId={session.id}
          onDelete={library.deleteSession}
          onRename={renameSession}
          sessions={sessions}
          shouldConfirmNavigation={(candidate) => interactionPending && candidate.id !== session.id}
        />
      ) : null}
    </section>
  );
}
