"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicSessionSummary, WorldSummary } from "../../shared/world-api";
import { worldApi } from "../lib/world-api-client";

interface WorldLibrarySnapshot {
  sessions: PublicSessionSummary[];
  worlds: WorldSummary[];
}

export interface ImportWorldOptions {
  expectedWorldId?: string;
  replace?: boolean;
}

export function useWorldLibrary(currentSession?: PublicSessionSummary) {
  const [snapshot, setSnapshot] = useState<WorldLibrarySnapshot>({ sessions: [], worlds: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refreshSequence = useRef(0);

  const refresh = useCallback(async (): Promise<WorldLibrarySnapshot> => {
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    try {
      const [worldResult, sessionResult] = await Promise.all([
        worldApi.worlds(),
        worldApi.sessions(),
      ]);
      const next = { worlds: worldResult.worlds, sessions: sessionResult.sessions };
      if (refreshSequence.current === sequence) {
        setSnapshot(next);
        setError("");
      }
      return next;
    } catch (reason) {
      if (refreshSequence.current === sequence) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      throw reason;
    } finally {
      if (refreshSequence.current === sequence) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const sessions = useMemo(() => {
    if (!currentSession) return snapshot.sessions;
    const others = snapshot.sessions.filter((session) => session.id !== currentSession.id);
    return [currentSession, ...others]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }, [currentSession, snapshot.sessions]);

  const hasRunningSession = sessions.some((session) => Boolean(session.activeRun));

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!hasRunningSession) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [hasRunningSession, refresh]);

  const perform = useCallback(async <Result,>(
    key: string,
    action: () => Promise<Result>,
    successMessage: string,
  ): Promise<Result> => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(successMessage);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(undefined);
    }
  }, []);

  const importWorld = useCallback(async (file: File, options: ImportWorldOptions = {}) => {
    const result = await perform(
      `world-import:${options.expectedWorldId ?? file.name}`,
      () => worldApi.importWorld(file, options),
      options.replace ? "世界包已更新。" : "世界包已导入。",
    );
    await refresh();
    return result;
  }, [perform, refresh]);

  const deleteWorld = useCallback(async (world: WorldSummary) => {
    await perform(
      `world-delete:${world.id}`,
      () => worldApi.deleteWorld(world.id),
      `世界包“${world.name}”已卸载。`,
    );
    await refresh();
  }, [perform, refresh]);

  const createSession = useCallback((world: WorldSummary) => perform(
    `session-create:${world.id}`,
    () => worldApi.createSession(world.id),
    "新游戏已创建。",
  ), [perform]);

  const renameSession = useCallback(async (session: PublicSessionSummary, title: string) => {
    const detail = await perform(
      `session-rename:${session.id}`,
      () => worldApi.renameSession(session.id, title),
      "存档名称已更新。",
    );
    setSnapshot((current) => ({
      ...current,
      sessions: current.sessions.map((item) => item.id === session.id ? detail.summary : item),
    }));
    return detail.summary;
  }, [perform]);

  const deleteSession = useCallback(async (session: PublicSessionSummary) => {
    await perform(
      `session-delete:${session.id}`,
      () => worldApi.deleteSession(session.id),
      `存档“${session.title}”已删除。`,
    );
    setSnapshot((current) => ({
      ...current,
      sessions: current.sessions.filter((item) => item.id !== session.id),
    }));
  }, [perform]);

  return {
    busy,
    clearFeedback: () => { setError(""); setNotice(""); },
    createSession,
    deleteSession,
    deleteWorld,
    error,
    importWorld,
    loading,
    notice,
    refresh,
    renameSession,
    sessions,
    worlds: snapshot.worlds,
  };
}
