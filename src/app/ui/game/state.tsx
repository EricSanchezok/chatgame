"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { httpGamePort, type GamePort } from "../../lib/api";
import { AudioController, cuesToAudio } from "../../lib/audio";
import {
  createGameStore,
  GameController,
  initialGameState,
  type GameControllerEffects,
  type GameState,
  type GameStore,
  type ThemeMode,
} from "../../lib/game-store";
import { applyTheme, type ThemeView } from "../../lib/theme";
import { patchPlayerSettings, readPlayerSettings } from "../../lib/settings";
import { loadScriptUi } from "../../lib/script-registry";
import type { SessionPresentation } from "../../../shared/client-dto";

export type { GameState, PanelId, ThemeMode } from "../../lib/game-store";

export function resolveActiveTheme(
  presentation: SessionPresentation | undefined,
  themeMode: ThemeMode,
): ThemeView | null {
  if (!presentation) return null;
  if (themeMode !== "follow") {
    const manual = presentation.themes.find((theme) => theme.id === themeMode);
    if (manual) return manual;
  }
  return presentation.currentTheme;
}

interface GameRuntime {
  store: GameStore;
  controller: GameController;
  port: GamePort;
  audio: AudioController;
}

const GameRuntimeContext = createContext<GameRuntime | null>(null);

function productionEffects(audio: AudioController, port: GamePort): GameControllerEffects {
  return {
    onAudioEnabled: (enabled) => {
      audio.setEnabled(enabled);
      patchPlayerSettings({ audioEnabled: enabled });
    },
    onThemeChanged: (mode) => patchPlayerSettings({ themeMode: mode }),
    onTurn: (result, detail, scriptId) => {
      cuesToAudio(
        audio,
        result.mediaCues,
        detail.assets,
        scriptId,
        (id, file) => port.assetUrl(id, file),
        (id, kind, entityId) => port.entityAssetUrl(id, kind, entityId),
      );
    },
    onSessionCleanupError: (sessionId, error) => {
      console.error(`Failed to clean up uncommitted session "${sessionId}"`, error);
    },
    readTrackedTask: (scriptId, runId) => readPlayerSettings().trackedTasks[`${scriptId}:${runId}`] ?? null,
    rememberTrackedTask: (scriptId, runId, taskId) => {
      const settings = readPlayerSettings();
      const key = `${scriptId}:${runId}`;
      const trackedTasks = { ...settings.trackedTasks };
      if (taskId) trackedTasks[key] = taskId;
      else delete trackedTasks[key];
      patchPlayerSettings({ trackedTasks });
    },
    onExit: () => audio.stopAll(),
  };
}

export function GameProvider({
  children,
  port = httpGamePort,
  initialState,
  effects,
}: {
  children: ReactNode;
  port?: GamePort;
  initialState?: GameState;
  effects?: GameControllerEffects;
}) {
  const [runtime] = useState<GameRuntime>(() => {
    const store = createGameStore(initialState ?? initialGameState);
    const audio = new AudioController();
    return {
      store,
      port,
      audio,
      controller: new GameController(store, port, effects ?? productionEffects(audio, port)),
    };
  });

  useEffect(() => () => runtime.controller.dispose(), [runtime]);

  useEffect(() => {
    const settings = readPlayerSettings();
    runtime.audio.setVolumes({
      master: settings.masterVolume / 100,
      ambient: settings.ambientVolume / 100,
      voice: settings.voiceVolume / 100,
      effects: settings.effectsVolume / 100,
    });
    runtime.controller.setTheme(settings.themeMode);
    runtime.controller.setAudio(settings.audioEnabled);
  }, [runtime]);

  const session = useGameStoreValue(runtime.store, (state) => state.session);
  const themeMode = useGameStoreValue(runtime.store, (state) => state.themeMode);
  const activeTheme = useMemo(
    () => resolveActiveTheme(session?.presentation, themeMode),
    [session?.presentation, themeMode],
  );

  useEffect(() => {
    if (!activeTheme || !session) return;
    void loadScriptUi(session.scriptId, session.presentation.uiBundle, {
      beforeCommit: () => applyTheme(activeTheme, undefined, {
        assetUrl: (file) => runtime.port.assetUrl(session.scriptId, file),
      }),
    });
  }, [activeTheme, runtime.port, session]);

  return <GameRuntimeContext.Provider value={runtime}>{children}</GameRuntimeContext.Provider>;
}

function useGameStoreValue<T>(store: GameStore, selector: (state: GameState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  );
}

export function useGameSelector<T>(selector: (state: GameState) => T): T {
  const runtime = useContext(GameRuntimeContext);
  if (!runtime) throw new Error("useGameSelector must be used inside GameProvider");
  return useGameStoreValue(runtime.store, selector);
}

export function useGameActions(): GameController {
  const runtime = useContext(GameRuntimeContext);
  if (!runtime) throw new Error("useGameActions must be used inside GameProvider");
  return runtime.controller;
}

export function useGamePort(): GamePort {
  const runtime = useContext(GameRuntimeContext);
  if (!runtime) throw new Error("useGamePort must be used inside GameProvider");
  return runtime.port;
}
