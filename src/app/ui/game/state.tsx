"use client";

// GameProvider: the single UI state owner for a game session.
// Pure reducer (testable in node) + a thin shell that wires API calls,
// theme application and audio side effects. No external state library.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  type ScriptDetail,
  type SessionPresentation,
  type TurnResultFull,
  type WorldState,
} from "../../lib/api";
import { applyTheme, type ThemeView } from "../../lib/theme";
import { AudioController, cuesToAudio } from "../../lib/audio";

export type PanelId = "inventory" | "character" | "relations" | "tasks" | "map" | "log";
/** "follow" = 跟随剧本 (default + by_location); otherwise a manual theme id. */
export type ThemeMode = "follow" | string;

export interface SessionHandle {
  id: string;
  scriptId: string;
  state: WorldState;
  presentation: SessionPresentation;
}

export interface GameState {
  screen: "launcher" | "game";
  busy: boolean;
  error: string;
  session: SessionHandle | null;
  detail: ScriptDetail | null;
  themeMode: ThemeMode;
  audioEnabled: boolean;
  dirty: boolean;
  panel: PanelId | null;
  lastTurn: TurnResultFull | null;
}

export type GameAction =
  | { type: "busy"; on: boolean }
  | { type: "error"; message: string }
  | { type: "enter"; session: SessionHandle; detail: ScriptDetail }
  | { type: "turn"; result: TurnResultFull }
  | { type: "updateState"; state: WorldState }
  | { type: "theme"; mode: ThemeMode }
  | { type: "audio"; on: boolean }
  | { type: "panel"; panel: PanelId | null }
  | { type: "saved" }
  | { type: "exit" };

export const initialGameState: GameState = {
  screen: "launcher",
  busy: false,
  error: "",
  session: null,
  detail: null,
  themeMode: "follow",
  audioEnabled: false,
  dirty: false,
  panel: null,
  lastTurn: null,
};

/** Pure state transitions (exported for node tests). */
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "busy":
      return { ...state, busy: action.on };
    case "error":
      return { ...state, error: action.message, busy: false };
    case "enter":
      return {
        ...state,
        screen: "game",
        session: action.session,
        detail: action.detail,
        error: "",
        busy: false,
        dirty: false,
        panel: null,
        lastTurn: null,
      };
    case "turn":
      return {
        ...state,
        session: state.session
          ? {
              ...state.session,
              state: action.result.state,
              presentation: action.result.presentation,
            }
          : state.session,
        lastTurn: action.result,
        dirty: true,
        busy: false,
        error: "",
      };
    case "updateState":
      return {
        ...state,
        session: state.session ? { ...state.session, state: action.state } : state.session,
        dirty: true,
        busy: false,
        error: "",
      };
    case "theme":
      return { ...state, themeMode: action.mode };
    case "audio":
      return { ...state, audioEnabled: action.on };
    case "panel":
      return { ...state, panel: action.panel };
    case "saved":
      return { ...state, dirty: false };
    case "exit":
      return { ...initialGameState };
    default:
      return state;
  }
}

/** Resolves the active theme for a themeMode (exported for tests). */
export function resolveActiveTheme(
  presentation: SessionPresentation | undefined,
  themeMode: ThemeMode,
): ThemeView | null {
  if (!presentation) return null;
  if (themeMode !== "follow") {
    const manual = presentation.themes.find((t) => t.id === themeMode);
    if (manual) return manual;
  }
  return presentation.currentTheme;
}

interface GameApi {
  state: GameState;
  startNewGame: (scriptId: string, originId: string, playerName?: string) => Promise<void>;
  continueGame: (scriptId: string, runId: string) => Promise<void>;
  sendTurn: (input: string) => Promise<void>;
  save: () => Promise<void>;
  advance: (hours: number) => Promise<void>;
  updateDescriptor: (path: string, text: string) => Promise<void>;
  exitGame: (saveFirst: boolean) => Promise<void>;
  setTheme: (mode: ThemeMode) => void;
  setAudio: (on: boolean) => void;
  setPanel: (panel: PanelId | null) => void;
  clearError: () => void;
}

const GameContext = createContext<GameApi | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  // Stable singleton per provider mount (never recreated during renders).
  const [audio] = useState(() => new AudioController());
  const locationRef = useRef<string | null>(null);

  // Theme application: JSON theme -> :root CSS variables (600ms transition
  // in globals.css smooths the switch).
  const activeTheme = useMemo(
    () => resolveActiveTheme(state.session?.presentation, state.themeMode),
    [state.session?.presentation, state.themeMode],
  );
  useEffect(() => {
    if (!activeTheme) return;
    if (state.session) {
      applyTheme(activeTheme, undefined, {
        assetUrl: (file) => api.fileAsset(state.session!.scriptId, file),
      });
    } else {
      applyTheme(activeTheme);
    }
  }, [activeTheme, state.session]);

  // Ambient loop follows the player's location (graceful silent skip when
  // the script declares no audio file/prompt for the location).
  const locationId = state.session?.state.player.locationId;
  useEffect(() => {
    const controller = audio;
    if (!state.audioEnabled) {
      controller.setEnabled(false);
      return;
    }
    controller.setEnabled(true);
    if (!state.session || !state.detail || !locationId) return;
    if (locationRef.current === locationId) return;
    locationRef.current = locationId;
    const entry = state.detail.assets.ambient[locationId];
    if (!entry) {
      controller.playAmbient(locationId, ""); // stops the previous loop
      return;
    }
    const src = entry.file
      ? api.fileAsset(state.session.scriptId, entry.file)
      : entry.prompt
        ? api.entityAsset(state.session.scriptId, "ambient", locationId)
        : "";
    controller.playAmbient(locationId, src);
  }, [state.audioEnabled, locationId, state.session, state.detail, audio]);

  async function startNewGame(scriptId: string, originId: string, playerName?: string): Promise<void> {
    dispatch({ type: "busy", on: true });
    try {
      const detail = await api.scriptDetail(scriptId);
      const session = await api.createSession({ scriptId, originId, playerName });
      locationRef.current = session.state.player.locationId;
      dispatch({ type: "enter", session: { ...session, scriptId }, detail });
      dispatch({ type: "audio", on: true }); // the start click is the gesture
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function continueGame(scriptId: string, runId: string): Promise<void> {
    dispatch({ type: "busy", on: true });
    try {
      const detail = await api.scriptDetail(scriptId);
      const session = await api.createSession({ scriptId, loadRunId: runId });
      locationRef.current = session.state.player.locationId;
      dispatch({ type: "enter", session: { ...session, scriptId }, detail });
      dispatch({ type: "audio", on: true });
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function sendTurn(input: string): Promise<void> {
    if (!state.session || state.busy) return;
    dispatch({ type: "busy", on: true });
    try {
      const result = await api.turn(state.session.id, input);
      if (state.audioEnabled && state.detail) {
        cuesToAudio(audio, result.mediaCues, state.detail.assets, state.session.scriptId, api.fileAsset, api.entityAsset);
      }
      dispatch({ type: "turn", result });
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function save(): Promise<void> {
    if (!state.session) return;
    await api.save(state.session.id);
    dispatch({ type: "saved" });
  }
  async function advance(hours: number): Promise<void> {
    if (!state.session || state.busy) return;
    dispatch({ type: "busy", on: true });
    try {
      const res = await api.advance(state.session.id, hours);
      locationRef.current = res.state.player.locationId;
      dispatch({ type: "updateState", state: res.state });
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function updateDescriptor(path: string, text: string): Promise<void> {
    if (!state.session || state.busy) return;
    dispatch({ type: "busy", on: true });
    try {
      const res = await api.setDescriptor(state.session.id, path, text);
      dispatch({ type: "updateState", state: res.state });
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }


  async function exitGame(saveFirst: boolean): Promise<void> {
    if (!state.session) {
      dispatch({ type: "exit" });
      return;
    }
    if (saveFirst && state.dirty) await api.save(state.session.id);
    await api.destroySession(state.session.id);
    audio.stopAll();
    locationRef.current = null;
    dispatch({ type: "exit" });
  }

  const value = useMemo<GameApi>(
    () => ({
      state,
      startNewGame,
      continueGame,
      sendTurn,
      save,
      advance,
      updateDescriptor,
      exitGame,
      setTheme: (mode) => dispatch({ type: "theme", mode }),
      setAudio: (on) => dispatch({ type: "audio", on }),
      setPanel: (panel) => dispatch({ type: "panel", panel }),
      clearError: () => dispatch({ type: "error", message: "" }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameApi {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside GameProvider");
  return ctx;
}
