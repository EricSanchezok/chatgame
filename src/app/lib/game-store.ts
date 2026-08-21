import type {
  ActionPreview,
  IntentHint,
  ScriptDetail,
  SessionPresentation,
  SessionSnapshot,
  TurnResultFull,
  WorldStateView,
} from "../../shared/client-dto";
import type { GamePort } from "./api";

export type PanelId = "inventory" | "character" | "relations" | "tasks" | "map" | "log" | string;
export type ThemeMode = "follow" | string;
export type GameOperation = "idle" | "starting" | "turn" | "preview" | "saving" | "advancing" | "leaving";

export interface SessionHandle {
  id: string;
  runId: string;
  scriptId: string;
  state: WorldStateView;
  presentation: SessionPresentation;
}

export interface GameState {
  screen: "launcher" | "game";
  operation: GameOperation;
  error: string;
  announcement: string;
  session: SessionHandle | null;
  detail: ScriptDetail | null;
  themeMode: ThemeMode;
  audioEnabled: boolean;
  dirty: boolean;
  panel: PanelId | null;
  paused: boolean;
  lastTurn: TurnResultFull | null;
  trackedTaskId: string | null;
  requestGeneration: number;
}

export const initialGameState: GameState = {
  screen: "launcher",
  operation: "idle",
  error: "",
  announcement: "",
  session: null,
  detail: null,
  themeMode: "follow",
  audioEnabled: false,
  dirty: false,
  panel: null,
  paused: false,
  lastTurn: null,
  trackedTaskId: null,
  requestGeneration: 0,
};

export type GameAction =
  | { type: "begin"; operation: GameOperation; generation: number }
  | { type: "error"; message: string; generation: number }
  | { type: "enter"; session: SessionHandle; detail: ScriptDetail; trackedTaskId: string | null; generation: number }
  | { type: "turn"; result: TurnResultFull; generation: number }
  | { type: "sessionSnapshot"; snapshot: SessionSnapshot; generation: number }
  | { type: "updateState"; state: WorldStateView; generation: number }
  | { type: "previewed"; generation: number }
  | { type: "theme"; mode: ThemeMode }
  | { type: "audio"; on: boolean }
  | { type: "panel"; panel: PanelId | null }
  | { type: "pause"; on: boolean }
  | { type: "trackTask"; taskId: string | null }
  | { type: "saved"; generation: number }
  | { type: "announce"; message: string }
  | { type: "clearError" }
  | { type: "exit"; generation: number };

/** Pure state transition. Generation-stamped results cannot mutate a newer session. */
export function reduceGameState(state: GameState, action: GameAction): GameState {
  if ("generation" in action && action.type !== "begin" && action.generation !== state.requestGeneration) {
    return state;
  }
  switch (action.type) {
    case "begin":
      return { ...state, operation: action.operation, error: "", requestGeneration: action.generation };
    case "error":
      return { ...state, operation: "idle", error: action.message, announcement: `操作失败：${action.message}` };
    case "enter":
      return {
        ...state,
        screen: "game",
        operation: "idle",
        error: "",
        announcement: `已进入${action.detail.scriptId}`,
        session: action.session,
        detail: action.detail,
        dirty: false,
        panel: null,
        paused: false,
        lastTurn: null,
        trackedTaskId: action.trackedTaskId,
      };
    case "turn":
      return {
        ...state,
        operation: "idle",
        error: "",
        announcement: "世界已回应",
        session: state.session
          ? { ...state.session, state: action.result.state, presentation: action.result.presentation }
          : null,
        lastTurn: action.result,
        dirty: true,
      };
    case "sessionSnapshot":
      return {
        ...state,
        operation: "idle",
        session: state.session
          ? { ...state.session, state: action.snapshot.state, presentation: action.snapshot.presentation }
          : null,
        dirty: true,
      };
    case "updateState":
      return {
        ...state,
        operation: "idle",
        session: state.session ? { ...state.session, state: action.state } : null,
        dirty: true,
      };
    case "previewed":
      return { ...state, operation: "idle" };
    case "theme":
      return { ...state, themeMode: action.mode };
    case "audio":
      return { ...state, audioEnabled: action.on };
    case "panel":
      return { ...state, panel: action.panel };
    case "pause":
      return { ...state, paused: action.on, panel: action.on ? null : state.panel };
    case "trackTask":
      return { ...state, trackedTaskId: action.taskId };
    case "saved":
      return { ...state, operation: "idle", dirty: false, announcement: "游戏已保存" };
    case "announce":
      return { ...state, announcement: action.message };
    case "clearError":
      return { ...state, error: "" };
    case "exit":
      return { ...initialGameState, requestGeneration: action.generation };
  }
}

export interface GameStore {
  getSnapshot(): GameState;
  subscribe(listener: () => void): () => void;
  dispatch(action: GameAction): void;
}

export function createGameStore(initial: GameState = initialGameState): GameStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(action) {
      const next = reduceGameState(state, action);
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

export interface GameControllerEffects {
  readLastRun(): { scriptId: string; runId: string } | null;
  rememberLastRun(scriptId: string, runId: string): void;
  clearLastRun(): void;
  onAudioEnabled(enabled: boolean): void;
  onThemeChanged?(mode: ThemeMode): void;
  onTurn(result: TurnResultFull, detail: ScriptDetail, scriptId: string): void;
  onSessionCleanupError(sessionId: string, error: Error): void;
  readTrackedTask?(scriptId: string, runId: string): string | null;
  rememberTrackedTask?(scriptId: string, runId: string, taskId: string | null): void;
  onExit(): void;
}

const noEffects: GameControllerEffects = {
  readLastRun: () => null,
  rememberLastRun: () => undefined,
  clearLastRun: () => undefined,
  onAudioEnabled: () => undefined,
  onTurn: () => undefined,
  onSessionCleanupError: () => undefined,
  onExit: () => undefined,
};

export class GameController {
  private generation = 0;
  private readonly pending = new Set<AbortController>();
  private readonly committedSessionIds = new Set<string>();

  constructor(
    readonly store: GameStore,
    readonly port: GamePort,
    private readonly effects: GameControllerEffects = noEffects,
  ) {
    this.startNewGame = this.startNewGame.bind(this);
    this.continueGame = this.continueGame.bind(this);
    this.resumeLast = this.resumeLast.bind(this);
    this.submitTurn = this.submitTurn.bind(this);
    this.previewAction = this.previewAction.bind(this);
    this.save = this.save.bind(this);
    this.advance = this.advance.bind(this);
    this.updateDescriptor = this.updateDescriptor.bind(this);
    this.exitGame = this.exitGame.bind(this);
  }

  private begin(operation: GameOperation, supersede = false): { generation: number; signal: AbortSignal } {
    if (supersede) this.abortPending();
    const generation = supersede ? ++this.generation : this.generation;
    const request = new AbortController();
    this.pending.add(request);
    this.store.dispatch({ type: "begin", operation, generation });
    return { generation, signal: request.signal };
  }

  private finish(signal: AbortSignal): void {
    for (const request of this.pending) {
      if (request.signal === signal) this.pending.delete(request);
    }
  }

  private abortPending(): void {
    for (const request of this.pending) request.abort();
    this.pending.clear();
  }

  private fail(error: unknown, generation: number, signal: AbortSignal): void {
    this.finish(signal);
    if (signal.aborted || generation !== this.generation) return;
    this.store.dispatch({ type: "error", message: error instanceof Error ? error.message : String(error), generation });
  }

  private async cleanupUncommittedSession(sessionId: string): Promise<void> {
    if (this.committedSessionIds.has(sessionId)) return;
    try {
      await this.port.destroySession(sessionId);
    } catch (error) {
      this.effects.onSessionCleanupError(
        sessionId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private async openSession(
    scriptId: string,
    input: Parameters<GamePort["createSession"]>[0],
    rememberedRunId: string,
  ): Promise<void> {
    const request = this.begin("starting", true);
    let createdSessionId: string | null = null;
    let committed = false;
    try {
      const detailRequest = Promise.resolve().then(
        () => this.port.scriptDetail(scriptId, request.signal),
      );
      const sessionRequest = Promise.resolve()
        .then(() => this.port.createSession(input, request.signal))
        .then((session) => {
          createdSessionId = session.id;
          return session;
        });
      const [detailResult, sessionResult] = await Promise.allSettled([detailRequest, sessionRequest]);
      if (detailResult.status === "rejected") throw detailResult.reason;
      if (sessionResult.status === "rejected") throw sessionResult.reason;

      if (request.signal.aborted || request.generation !== this.generation) return;
      const session = sessionResult.value;
      this.store.dispatch({
        type: "enter",
        session: { ...session, scriptId },
        detail: detailResult.value,
        trackedTaskId: this.effects.readTrackedTask?.(scriptId, session.runId) ?? null,
        generation: request.generation,
      });
      const active = this.store.getSnapshot();
      if (
        request.signal.aborted ||
        request.generation !== this.generation ||
        active.requestGeneration !== request.generation ||
        active.session?.id !== session.id
      ) return;

      committed = true;
      this.committedSessionIds.add(session.id);
      this.effects.rememberLastRun(scriptId, rememberedRunId);
    } catch (error) {
      this.fail(error, request.generation, request.signal);
    } finally {
      this.finish(request.signal);
      if (createdSessionId && !committed) {
        const active = this.store.getSnapshot();
        if (
          active.requestGeneration === request.generation &&
          active.session?.id === createdSessionId
        ) {
          this.committedSessionIds.add(createdSessionId);
        } else {
          await this.cleanupUncommittedSession(createdSessionId);
        }
      }
    }
  }

  async startNewGame(scriptId: string, originId: string, playerName?: string): Promise<void> {
    await this.openSession(
      scriptId,
      { scriptId, originId, playerName },
      "autosave.json",
    );
  }

  async continueGame(scriptId: string, runId: string): Promise<void> {
    await this.openSession(scriptId, { scriptId, loadRunId: runId }, runId);
  }

  async resumeLast(): Promise<boolean> {
    const last = this.effects.readLastRun();
    if (!last) return false;
    await this.continueGame(last.scriptId, last.runId);
    const ok = this.store.getSnapshot().screen === "game";
    if (!ok) this.effects.clearLastRun();
    return ok;
  }

  async submitTurn(text: string, intentHint?: IntentHint): Promise<void> {
    const before = this.store.getSnapshot();
    if (!before.session || before.operation !== "idle") return;
    const request = this.begin("turn");
    try {
      const result = await this.port.submitTurn(before.session.id, { text, intentHint }, request.signal);
      this.finish(request.signal);
      if (request.signal.aborted || request.generation !== this.generation) return;
      this.store.dispatch({ type: "turn", result, generation: request.generation });
      if (before.detail) this.effects.onTurn(result, before.detail, before.session.scriptId);
      this.effects.rememberLastRun(before.session.scriptId, "autosave.json");
    } catch (error) {
      this.fail(error, request.generation, request.signal);
    }
  }

  async previewAction(intentHint: IntentHint): Promise<ActionPreview | null> {
    const before = this.store.getSnapshot();
    if (!before.session || before.operation !== "idle") return null;
    const request = this.begin("preview");
    try {
      const result = await this.port.previewAction(before.session.id, intentHint, request.signal);
      this.finish(request.signal);
      if (request.signal.aborted || request.generation !== this.generation) return null;
      this.store.dispatch({ type: "previewed", generation: request.generation });
      return result;
    } catch (error) {
      this.fail(error, request.generation, request.signal);
      return null;
    }
  }

  async save(): Promise<void> {
    const before = this.store.getSnapshot();
    if (!before.session || before.operation !== "idle") return;
    const session = before.session;
    const request = this.begin("saving");
    try {
      await this.port.save(session.id, request.signal);
      this.finish(request.signal);
      if (request.signal.aborted || request.generation !== this.generation) return;
      this.store.dispatch({ type: "saved", generation: request.generation });
    } catch (error) {
      this.fail(error, request.generation, request.signal);
    }
  }

  async advance(hours: number): Promise<void> {
    const before = this.store.getSnapshot();
    if (!before.session || before.operation !== "idle") return;
    const session = before.session;
    const request = this.begin("advancing");
    try {
      const result = await this.port.advance(session.id, hours, request.signal);
      this.finish(request.signal);
      if (request.signal.aborted || request.generation !== this.generation) return;
      this.store.dispatch({ type: "sessionSnapshot", snapshot: result, generation: request.generation });
    } catch (error) {
      this.fail(error, request.generation, request.signal);
    }
  }

  async updateDescriptor(path: string, text: string): Promise<void> {
    const before = this.store.getSnapshot();
    if (!before.session || before.operation !== "idle") return;
    const session = before.session;
    const request = this.begin("saving");
    try {
      const result = await this.port.setDescriptor(session.id, path, text, request.signal);
      this.finish(request.signal);
      if (request.signal.aborted || request.generation !== this.generation) return;
      this.store.dispatch({ type: "updateState", state: result.state, generation: request.generation });
    } catch (error) {
      this.fail(error, request.generation, request.signal);
    }
  }

  async exitGame(saveFirst: boolean): Promise<void> {
    const before = this.store.getSnapshot();
    if (!before.session) return;
    const request = this.begin("leaving", true);
    try {
      if (saveFirst && before.dirty) await this.port.save(before.session.id, request.signal);
      await this.port.destroySession(before.session.id, request.signal);
      this.finish(request.signal);
      if (request.signal.aborted || request.generation !== this.generation) return;
      this.committedSessionIds.delete(before.session.id);
      this.effects.rememberLastRun(before.session.scriptId, "autosave.json");
      this.effects.onExit();
      this.store.dispatch({ type: "exit", generation: request.generation });
    } catch (error) {
      this.fail(error, request.generation, request.signal);
    }
  }

  setTheme = (mode: ThemeMode) => {
    this.effects.onThemeChanged?.(mode);
    this.store.dispatch({ type: "theme", mode });
  };
  setAudio = (on: boolean) => {
    this.effects.onAudioEnabled(on);
    this.store.dispatch({ type: "audio", on });
  };
  setPanel = (panel: PanelId | null) => this.store.dispatch({ type: "panel", panel });
  setPause = (on: boolean) => this.store.dispatch({ type: "pause", on });
  setTrackedTask = (taskId: string | null) => {
    const session = this.store.getSnapshot().session;
    if (!session) return;
    this.effects.rememberTrackedTask?.(session.scriptId, session.runId, taskId);
    this.store.dispatch({ type: "trackTask", taskId });
  };
  clearError = () => this.store.dispatch({ type: "clearError" });

  dispose(): void {
    this.abortPending();
    this.effects.onExit();
  }
}
