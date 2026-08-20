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
}

const GameRuntimeContext = createContext<GameRuntime | null>(null);

function productionEffects(audio: AudioController, port: GamePort): GameControllerEffects {
  return {
    readLastRun: () => readPlayerSettings().lastRun,
    rememberLastRun: (scriptId, runId) => {
      patchPlayerSettings({ lastRun: { scriptId, runId } });
    },
    clearLastRun: () => {
      patchPlayerSettings({ lastRun: null });
    },
    onAudioEnabled: (enabled) => {
      audio.setEnabled(enabled);
      patchPlayerSettings({ audioEnabled: enabled });
    },
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
      controller: new GameController(store, port, effects ?? productionEffects(audio, port)),
    };
  });

  useEffect(() => () => runtime.controller.dispose(), [runtime]);

  const session = useGameStoreValue(runtime.store, (state) => state.session);
  const themeMode = useGameStoreValue(runtime.store, (state) => state.themeMode);
  const activeTheme = useMemo(
    () => resolveActiveTheme(session?.presentation, themeMode),
    [session?.presentation, themeMode],
  );

  useEffect(() => {
    if (!activeTheme) return;
    applyTheme(activeTheme, undefined, {
      assetUrl: session ? (file) => runtime.port.assetUrl(session.scriptId, file) : undefined,
    });
  }, [activeTheme, runtime.port, session]);

  return <GameRuntimeContext.Provider value={runtime}>{children}</GameRuntimeContext.Provider>;
}

function useGameStoreValue<T>(store: GameStore, selector: (state: GameState) => T): T {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return selector(snapshot);
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
