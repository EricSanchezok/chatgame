// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PublicSessionDetail,
  WorldRunEvent,
  WorldRunRecordView,
  WorldRunSnapshot,
} from "../../shared/world-api";

interface RuntimeOptions {
  isRunning: boolean;
  isSendDisabled: boolean;
  messages: MockMessage[];
  onCancel: () => Promise<void>;
  onNew: (message: { content: Array<{ type: "text"; text: string }> }) => Promise<void>;
}

interface MockMessage {
  id: string;
  role: "user" | "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "data"; name: string; data: unknown }
  >;
}

let runtimeOptions: RuntimeOptions | undefined;

const api = vi.hoisted(() => ({
  cancelRun: vi.fn(),
  continueRun: vi.fn(),
  retryRun: vi.fn(),
  run: vi.fn(),
  runEventsUrl: vi.fn((sessionId: string, runId: string, after: number) =>
    `/api/sessions/${sessionId}/runs/${runId}/events?after=${after}`),
  session: vi.fn(),
  startRun: vi.fn(),
}));

vi.mock("../lib/world-api-client", () => ({
  WorldApiError: class WorldApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  },
  worldApi: api,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("./control-orb", () => ({ ControlOrb: () => null }));
vi.mock("@assistant-ui/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const MessageContext = React.createContext<MockMessage | undefined>(undefined);
  return {
    AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => children,
    ComposerPrimitive: {
      Root: ({ children, className }: { children: ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
      ),
      Input: ({
        submitMode: _submitMode,
        unstable_insertNewlineOnTouchEnter: _touchEnter,
        ...props
      }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
        submitMode?: string;
        unstable_insertNewlineOnTouchEnter?: boolean;
      }) => {
        void _submitMode;
        void _touchEnter;
        return <textarea {...props} />;
      },
      Cancel: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
      Send: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
    },
    MessagePrimitive: {
      Root: ({ children, className }: { children: ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
      ),
      Parts: ({ components }: {
        components: {
          Text?: ComponentType<{ text: string }>;
          data?: { by_name?: Record<string, ComponentType<{ data: unknown }>> };
        };
      }) => {
        const message = React.useContext(MessageContext);
        return message?.content.map((part, index) => {
          if (part.type === "text") {
            const Text = components.Text;
            return Text ? <Text key={index} text={part.text} /> : null;
          }
          const Data = components.data?.by_name?.[part.name];
          return Data ? <Data data={part.data} key={index} /> : null;
        }) ?? null;
      },
    },
    ThreadPrimitive: {
      Empty: ({ children }: { children: ReactNode }) => runtimeOptions?.messages.length ? null : children,
      Messages: ({ components }: {
        components: { UserMessage: ComponentType; AssistantMessage: ComponentType };
      }) => runtimeOptions?.messages.map((message) => {
        const Message = message.role === "user" ? components.UserMessage : components.AssistantMessage;
        return (
          <MessageContext.Provider key={message.id} value={message}>
            <Message />
          </MessageContext.Provider>
        );
      }) ?? null,
      Root: ({ children, className }: { children: ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
      ),
      ScrollToBottom: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
      Viewport: ({
        autoScroll: _autoScroll,
        children,
        turnAnchor: _turnAnchor,
        ...props
      }: React.HTMLAttributes<HTMLDivElement> & {
        autoScroll?: boolean;
        turnAnchor?: string;
      }) => {
        void _autoScroll;
        void _turnAnchor;
        return <div {...props}>{children}</div>;
      },
    },
    useExternalStoreRuntime: (options: RuntimeOptions) => {
      runtimeOptions = options;
      return {};
    },
  };
});

import { GameSession } from "./game-session";
import { WorldApiError } from "../lib/world-api-client";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = FakeEventSource.CONNECTING;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const handler = listener as (event: MessageEvent<string>) => void;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(event: WorldRunEvent): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(new MessageEvent(event.type, { data: JSON.stringify(event) }));
    }
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }
}

function run(status: WorldRunRecordView["status"], events: WorldRunEvent[] = []): WorldRunRecordView {
  return {
    id: "run-1",
    sessionId: "session-1",
    inputs: [{
      id: "input-1",
      kind: "goal",
      text: "打开石门",
      at: "2026-08-24T00:00:00.000Z",
    }],
    status,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    cancelRequested: false,
    events,
  };
}

function detail(currentRun: WorldRunRecordView): PublicSessionDetail {
  return {
    summary: {
      id: "session-1",
      worldId: "world-1",
      title: "测试存档",
      world: {
        id: "world-1",
        name: "测试世界",
        version: "1.0.0",
        contentHash: "hash",
        description: "测试",
      },
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
      revision: 0,
      step: 0,
      elapsedSeconds: 0,
      activeRun: currentRun.status === "queued" || currentRun.status === "running"
        ? { id: currentRun.id, status: currentRun.status }
        : undefined,
    },
    state: {
      id: "session-1",
      worldId: "world-1",
      worldHash: "hash",
      worldVersion: "1.0.0",
      revision: 0,
      step: 0,
      elapsedSeconds: 0,
      player: { localEntities: {}, claims: {}, evidence: {}, observationIds: [] },
      activeIntent: currentRun.status === "completed" || currentRun.status === "cancelled"
        ? undefined
        : {
            id: "intent-1",
            goal: "打开石门",
            latestInput: {
              id: "input-1",
              text: "打开石门",
              kind: "goal",
              submittedAtStep: 0,
            },
            status: "active",
            startedAtStep: 0,
          },
    },
    runs: [currentRun],
  };
}

function snapshot(currentRun: WorldRunRecordView): WorldRunSnapshot {
  const currentDetail = detail(currentRun);
  return { run: currentRun, state: currentDetail.state };
}

function displayedRun(): WorldRunRecordView {
  const part = runtimeOptions?.messages
    .flatMap((message) => message.content)
    .find((candidate) => candidate.type === "data" && candidate.name === "world-run");
  if (!part || part.type !== "data") throw new Error("world run message is not rendered");
  return part.data as WorldRunRecordView;
}

const inputMessage = (text: string) => ({ content: [{ type: "text" as const, text }] });

describe("GameSession WorldRun lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.runEventsUrl.mockImplementation((sessionId: string, runId: string, after: number) =>
      `/api/sessions/${sessionId}/runs/${runId}/events?after=${after}`);
    runtimeOptions = undefined;
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "clarification-id") });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not open an EventSource for a snapshot that is already terminal", async () => {
    api.session.mockResolvedValue(detail(run("failed")));

    render(<GameSession sessionId="session-1" />);

    await screen.findByRole("heading", { name: "测试存档" });
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(runtimeOptions).toMatchObject({ isRunning: false, isSendDisabled: true });
  });

  it.each([
    {
      status: "awaiting_player" as const,
      event: {
        sequence: 2,
        type: "run.awaiting_player" as const,
        at: "2026-08-24T00:00:01.000Z",
        payload: { runId: "run-1", revision: 0, step: 0 },
      },
      narrative: "世界在等待你的决定。",
      retryLabel: undefined,
    },
    {
      status: "step_limit" as const,
      event: {
        sequence: 2,
        type: "run.step_limit" as const,
        at: "2026-08-24T00:00:01.000Z",
        payload: { runId: "run-1", revision: 0, step: 0 },
      },
      narrative: "本次推演已到上限。你可以放弃当前目标。",
      retryLabel: "继续推演",
    },
    {
      status: "failed" as const,
      event: {
        sequence: 2,
        type: "run.failed" as const,
        at: "2026-08-24T00:00:01.000Z",
        payload: { runId: "run-1", message: "暂时无法连接模型服务。", retriable: true },
      },
      narrative: "这一步没有提交，世界仍停留在上一个已保存状态。",
      retryLabel: "重试这一步",
    },
    {
      status: "failed" as const,
      event: {
        sequence: 2,
        type: "run.failed" as const,
        at: "2026-08-24T00:00:01.000Z",
        payload: { runId: "run-1", message: "模型配置无效。", retriable: false },
      },
      narrative: "这一步没有提交，世界仍停留在上一个已保存状态。",
      retryLabel: undefined,
    },
  ])("shows accurate $status recovery actions", async ({ event, narrative, retryLabel, status }) => {
    api.session.mockResolvedValue(detail(run(status, [event])));
    api.cancelRun.mockResolvedValue(snapshot(run("cancelled")));

    render(<GameSession sessionId="session-1" />);

    await screen.findByRole("heading", { name: "测试存档" });
    expect(screen.getByText(narrative)).toBeVisible();
    const abandonButton = screen.getByRole("button", { name: "放弃目标" });
    expect(abandonButton).toBeEnabled();
    if (retryLabel) expect(screen.getByRole("button", { name: retryLabel })).toBeEnabled();
    else expect(screen.queryByRole("button", { name: /重试这一步|继续推演/ })).not.toBeInTheDocument();
    expect(screen.queryByText("世界正在推演…")).not.toBeInTheDocument();
    fireEvent.click(abandonButton);
    await waitFor(() => expect(api.cancelRun).toHaveBeenCalledWith("session-1", "run-1"));
  });

  it("closes a terminal stream, reconciles once, and ignores stale source errors", async () => {
    const queued = run("queued");
    const failedEvent: WorldRunEvent = {
      sequence: 2,
      type: "run.failed",
      at: "2026-08-24T00:00:01.000Z",
      payload: { runId: "run-1", message: "这一步未能完成。", retriable: true },
    };
    const failed = { ...queued, status: "failed" as const, events: [failedEvent] };
    api.session
      .mockResolvedValueOnce(detail(queued))
      .mockResolvedValueOnce(detail(failed));

    render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    act(() => source.fail());
    expect(screen.getByRole("status")).toHaveTextContent("进度连接暂时中断");
    act(() => source.open());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    act(() => source.emit(failedEvent));

    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(2));
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    source.readyState = FakeEventSource.CONNECTING;
    act(() => source.fail());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("does not let a delayed cancel snapshot overwrite a terminal stream", async () => {
    const running = run("running");
    const cancelledEvent: WorldRunEvent = {
      sequence: 1,
      type: "run.cancelled",
      at: "2026-08-24T00:00:02.000Z",
      payload: { runId: "run-1", revision: 0, step: 0 },
    };
    const cancelled = {
      ...running,
      status: "cancelled" as const,
      updatedAt: cancelledEvent.at,
      events: [cancelledEvent],
    };
    let resolveCancel: ((value: WorldRunSnapshot) => void) | undefined;
    api.session
      .mockResolvedValueOnce(detail(running))
      .mockResolvedValueOnce(detail(cancelled))
      .mockResolvedValueOnce(detail(cancelled));
    api.cancelRun.mockImplementation(() => new Promise<WorldRunSnapshot>((resolve) => {
      resolveCancel = resolve;
    }));

    render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    let cancelPromise: Promise<void> | undefined;
    act(() => { cancelPromise = runtimeOptions!.onCancel(); });
    act(() => source.emit(cancelledEvent));
    await screen.findByText("目标已经结束");

    resolveCancel?.(snapshot({
      ...running,
      cancelRequested: true,
      updatedAt: "2026-08-24T00:00:01.000Z",
    }));
    await act(async () => cancelPromise);

    expect(screen.getByText("目标已经结束")).toBeVisible();
    expect(screen.queryByText("世界正在推演…")).not.toBeInTheDocument();
    expect(runtimeOptions).toMatchObject({ isRunning: false, isSendDisabled: false });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("accepts an SSE terminal state when DELETE and reconciliation both fail", async () => {
    const running = run("running");
    const cancelledEvent: WorldRunEvent = {
      sequence: 1,
      type: "run.cancelled",
      at: "2026-08-24T00:00:02.000Z",
      payload: { runId: "run-1", revision: 0, step: 0 },
    };
    let rejectCancel: ((reason: unknown) => void) | undefined;
    api.session
      .mockResolvedValueOnce(detail(running))
      .mockRejectedValue(new TypeError("存档响应中断"));
    api.cancelRun.mockImplementation(() => new Promise<WorldRunSnapshot>((_resolve, reject) => {
      rejectCancel = reject;
    }));

    render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    let cancelPromise: Promise<void> | undefined;
    act(() => { cancelPromise = runtimeOptions!.onCancel(); });
    act(() => source.emit(cancelledEvent));
    await screen.findByText("目标已经结束");
    rejectCancel?.(new TypeError("DELETE 响应中断"));
    await act(async () => cancelPromise);

    expect(screen.getByText("目标已经结束")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(runtimeOptions).toMatchObject({ isRunning: false, isSendDisabled: false });
    expect(api.session).toHaveBeenCalledTimes(3);
  });

  it("clears a failed DELETE alert when its terminal SSE arrives later", async () => {
    const running = run("running");
    const cancelledEvent: WorldRunEvent = {
      sequence: 1,
      type: "run.cancelled",
      at: "2026-08-24T00:00:02.000Z",
      payload: { runId: "run-1", revision: 0, step: 0 },
    };
    api.session
      .mockResolvedValueOnce(detail(running))
      .mockRejectedValue(new TypeError("存档响应中断"));
    api.cancelRun.mockRejectedValue(new TypeError("DELETE 响应中断"));

    render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    await act(async () => {
      await expect(runtimeOptions!.onCancel()).rejects.toThrow("DELETE 响应中断");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("DELETE 响应中断");

    act(() => source.emit(cancelledEvent));
    await screen.findByText("目标已经结束");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(runtimeOptions).toMatchObject({ isRunning: false, isSendDisabled: false });
  });

  it("does not let an old terminal SSE clear a newer independent error", async () => {
    const running = run("running");
    const cancelledEvent: WorldRunEvent = {
      sequence: 1,
      type: "run.cancelled",
      at: "2026-08-24T00:00:02.000Z",
      payload: { runId: "run-1", revision: 0, step: 0 },
    };
    api.session
      .mockResolvedValueOnce(detail(running))
      .mockRejectedValue(new TypeError("存档响应中断"));
    api.cancelRun.mockRejectedValue(new TypeError("旧取消错误"));
    api.startRun.mockRejectedValue(new WorldApiError(401, "新的独立错误"));

    render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    await act(async () => {
      await expect(runtimeOptions!.onCancel()).rejects.toThrow("旧取消错误");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("旧取消错误");
    await act(async () => {
      await expect(runtimeOptions!.onNew(inputMessage("另一项操作"))).rejects.toThrow("新的独立错误");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("新的独立错误");

    act(() => source.emit(cancelledEvent));
    await screen.findByText("目标已经结束");

    expect(screen.getByRole("alert")).toHaveTextContent("新的独立错误");
  });

  it("keeps a persisted cancel request when a stale detail response omits it", async () => {
    const running = run("running");
    const cancelRequested = { ...running, cancelRequested: true };
    api.session
      .mockResolvedValueOnce(detail(running))
      .mockResolvedValueOnce(detail(running));
    api.cancelRun.mockResolvedValue(snapshot(cancelRequested));

    render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await act(async () => runtimeOptions!.onCancel());

    expect(screen.getByRole("button", { name: "正在停止推演" })).toBeDisabled();
    expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("accepts the authoritative cleared cancel flag after a terminal event", async () => {
    const running = run("running");
    const cancelRequested = { ...running, cancelRequested: true };
    const cancelledEvent: WorldRunEvent = {
      sequence: 1,
      type: "run.cancelled",
      at: "2026-08-24T00:00:02.000Z",
      payload: { runId: "run-1", revision: 0, step: 0 },
    };
    const cancelled = {
      ...running,
      status: "cancelled" as const,
      updatedAt: cancelledEvent.at,
      cancelRequested: false,
      events: [cancelledEvent],
    };
    let resolveTerminal: ((value: PublicSessionDetail) => void) | undefined;
    api.session
      .mockResolvedValueOnce(detail(running))
      .mockResolvedValueOnce(detail(cancelRequested))
      .mockImplementationOnce(() => new Promise<PublicSessionDetail>((resolve) => {
        resolveTerminal = resolve;
      }));
    api.cancelRun.mockResolvedValue(snapshot(cancelRequested));

    render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    await act(async () => runtimeOptions!.onCancel());
    expect(displayedRun().cancelRequested).toBe(true);

    act(() => source.emit(cancelledEvent));
    await screen.findByText("目标已经结束");
    expect(displayedRun()).toMatchObject({ status: "cancelled", cancelRequested: true });

    resolveTerminal?.(detail(cancelled));
    await waitFor(() => expect(displayedRun().cancelRequested).toBe(false));
    expect(displayedRun().status).toBe("cancelled");
    expect(runtimeOptions).toMatchObject({ isRunning: false, isSendDisabled: false });
  });

  it("observes an executing run returned while abandoning a stale failure", async () => {
    const failedEvent: WorldRunEvent = {
      sequence: 2,
      type: "run.failed",
      at: "2026-08-24T00:00:01.000Z",
      payload: { runId: "run-1", message: "暂时失败。", retriable: true },
    };
    const failed = run("failed", [failedEvent]);
    const retrying = { ...failed, status: "queued" as const, cancelRequested: true };
    api.session
      .mockResolvedValueOnce(detail(failed))
      .mockResolvedValueOnce(detail(retrying));
    api.cancelRun.mockResolvedValue(snapshot(retrying));

    render(<GameSession sessionId="session-1" />);
    const abandonButton = await screen.findByRole("button", { name: "放弃目标" });
    fireEvent.click(abandonButton);

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toContain("/runs/run-1/events");
    expect(screen.getByRole("button", { name: "正在停止推演" })).toBeDisabled();
    expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
  });

  it("does not let a stale retry boundary overwrite the queued retry", async () => {
    const failedEvent: WorldRunEvent = {
      sequence: 2,
      type: "run.failed",
      at: "2026-08-24T00:00:01.000Z",
      payload: { runId: "run-1", message: "暂时失败。", retriable: true },
    };
    const failed = run("failed", [failedEvent]);
    const retrying = { ...failed, status: "queued" as const };
    const cancelledEvent: WorldRunEvent = {
      sequence: 3,
      type: "run.cancelled",
      at: "2026-08-24T00:00:02.000Z",
      payload: { runId: "run-1", revision: 0, step: 0 },
    };
    const cancelled = {
      ...retrying,
      status: "cancelled" as const,
      updatedAt: cancelledEvent.at,
      events: [...retrying.events, cancelledEvent],
    };
    api.session
      .mockResolvedValueOnce(detail(failed))
      .mockResolvedValueOnce(detail(retrying))
      .mockResolvedValueOnce(detail(failed))
      .mockResolvedValueOnce(detail(cancelled));
    api.retryRun.mockResolvedValue(snapshot(retrying));

    render(<GameSession sessionId="session-1" />);
    const retryButton = await screen.findByRole("button", { name: "重试这一步" });
    fireEvent.click(retryButton);

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    act(() => source.open());
    expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
    expect(screen.getByText("世界正在推演…")).toBeVisible();

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(3));

    expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
    expect(screen.getByText("世界正在推演…")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重试这一步" })).not.toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.readyState).toBe(FakeEventSource.OPEN);

    act(() => source.emit(cancelledEvent));
    await screen.findByText("目标已经结束");
    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(4));
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("reconciles a persisted start after the POST response is lost", async () => {
    const completed = run("completed");
    const next = {
      ...run("queued"),
      id: "run-2",
      inputs: [{
        ...run("queued").inputs[0],
        id: "input-2",
        text: "观察石门",
      }],
    };
    api.session
      .mockResolvedValueOnce(detail(completed))
      .mockResolvedValueOnce(detail(next));
    api.startRun.mockRejectedValue(new TypeError("响应连接中断"));

    render(<GameSession sessionId="session-1" />);
    await screen.findByRole("heading", { name: "测试存档" });
    await act(async () => runtimeOptions!.onNew(inputMessage("观察石门")));

    expect(api.run).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain("/runs/run-2/events");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([408, 409, 429, 503])(
    "locks an uncertain HTTP %s POST until a later session reveals its run",
    async (status) => {
      const completed = run("completed");
      const next = {
        ...run("queued"),
        id: "run-2",
        inputs: [{
          ...run("queued").inputs[0],
          id: "input-2",
          text: "观察石门",
        }],
      };
      api.session
        .mockResolvedValueOnce(detail(completed))
        .mockRejectedValueOnce(new TypeError("存档响应中断"))
        .mockResolvedValueOnce(detail(next));
      api.startRun.mockRejectedValue(new WorldApiError(status, "启动服务暂时不可用"));

      render(<GameSession sessionId="session-1" />);
      await screen.findByRole("heading", { name: "测试存档" });
      await act(async () => runtimeOptions!.onNew(inputMessage("观察石门")));

      expect(api.run).not.toHaveBeenCalled();
      expect(api.startRun).toHaveBeenCalledTimes(1);
      expect(FakeEventSource.instances).toHaveLength(0);
      expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
      expect(screen.getByRole("button", { name: "正在确认行动" })).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent("行动已经提交，正在重新确认世界进度");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await act(async () => runtimeOptions!.onNew(inputMessage("重复提交")));
      expect(api.startRun).toHaveBeenCalledTimes(1);

      act(() => window.dispatchEvent(new Event("focus")));
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
      expect(FakeEventSource.instances[0].url).toContain("/runs/run-2/events");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
    },
  );

  it("does not lock a start rejected by a permanent 4xx", async () => {
    const completed = run("completed");
    api.session
      .mockResolvedValueOnce(detail(completed))
      .mockRejectedValueOnce(new TypeError("存档响应中断"));
    api.startRun.mockRejectedValue(new WorldApiError(401, "模型密钥无效"));

    render(<GameSession sessionId="session-1" />);
    await screen.findByRole("heading", { name: "测试存档" });
    await act(async () => {
      await expect(runtimeOptions!.onNew(inputMessage("观察石门"))).rejects.toThrow("模型密钥无效");
    });

    expect(screen.getByRole("alert")).toHaveTextContent("模型密钥无效");
    expect(screen.getByRole("button", { name: "发送行动" })).toBeEnabled();
    expect(runtimeOptions).toMatchObject({ isRunning: false, isSendDisabled: false });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("releases an uncertain POST only after repeated authoritative absence", async () => {
    const completed = run("completed");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    api.session
      .mockResolvedValueOnce(detail(completed))
      .mockResolvedValueOnce(detail(completed))
      .mockResolvedValueOnce(detail(completed));
    api.startRun.mockRejectedValue(new TypeError("启动响应中断"));

    render(<GameSession sessionId="session-1" />);
    await screen.findByRole("heading", { name: "测试存档" });
    await act(async () => runtimeOptions!.onNew(inputMessage("观察石门")));

    expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    now.mockReturnValue(2_500);

    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByRole("alert");

    expect(screen.getByRole("alert")).toHaveTextContent("启动响应中断");
    expect(screen.getByRole("button", { name: "发送行动" })).toBeEnabled();
    expect(runtimeOptions).toMatchObject({ isRunning: false, isSendDisabled: false });
    expect(FakeEventSource.instances).toHaveLength(0);
    now.mockRestore();
  });

  it("reconciles and observes when the run GET response is lost", async () => {
    const completed = run("completed");
    const next = { ...run("queued"), id: "run-2" };
    api.session
      .mockResolvedValueOnce(detail(completed))
      .mockResolvedValueOnce(detail(next));
    api.startRun.mockResolvedValue({ runId: "run-2" });
    api.run.mockRejectedValue(new TypeError("读取响应中断"));

    render(<GameSession sessionId="session-1" />);
    await screen.findByRole("heading", { name: "测试存档" });
    await act(async () => runtimeOptions!.onNew(inputMessage("打开石门")));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain("/runs/run-2/events");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a known run locked until an uncertain start can be observed", async () => {
    const completed = run("completed");
    const next = { ...run("queued"), id: "run-2" };
    api.session
      .mockResolvedValueOnce(detail(completed))
      .mockRejectedValueOnce(new TypeError("存档读取中断"))
      .mockResolvedValueOnce(detail(next));
    api.startRun.mockResolvedValue({ runId: "run-2" });
    api.run.mockRejectedValue(new TypeError("运行读取中断"));

    render(<GameSession sessionId="session-1" />);
    await screen.findByRole("heading", { name: "测试存档" });
    await act(async () => runtimeOptions!.onNew(inputMessage("打开石门")));

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
    expect(screen.getByRole("button", { name: "正在确认行动" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("行动已经提交，正在重新确认世界进度");

    await act(async () => runtimeOptions!.onNew(inputMessage("重复提交")));
    expect(api.startRun).toHaveBeenCalledTimes(1);

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toContain("/runs/run-2/events");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
  });

  it("observes a run created in another tab when this page regains focus", async () => {
    const completed = run("completed");
    const next = { ...run("running"), id: "run-2" };
    api.session
      .mockResolvedValueOnce(detail(completed))
      .mockResolvedValueOnce(detail(next));

    render(<GameSession sessionId="session-1" />);
    await screen.findByRole("heading", { name: "测试存档" });
    expect(FakeEventSource.instances).toHaveLength(0);
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toContain("/runs/run-2/events");
    expect(runtimeOptions).toMatchObject({ isRunning: true, isSendDisabled: true });
  });

  it("does not let an older reconciliation failure overwrite a newer success", async () => {
    const running = run("running");
    const cancelledEvent: WorldRunEvent = {
      sequence: 1,
      type: "run.cancelled",
      at: "2026-08-24T00:00:02.000Z",
      payload: { runId: "run-1", revision: 0, step: 0 },
    };
    const cancelled = {
      ...running,
      status: "cancelled" as const,
      updatedAt: cancelledEvent.at,
      events: [cancelledEvent],
    };
    let rejectStaleReconciliation: ((reason: unknown) => void) | undefined;
    api.session
      .mockResolvedValueOnce(detail(running))
      .mockImplementationOnce(() => new Promise<PublicSessionDetail>((_resolve, reject) => {
        rejectStaleReconciliation = reject;
      }))
      .mockResolvedValueOnce(detail(cancelled));

    render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    const malformedListener = source.listeners.get("player.observation")?.[0];
    expect(malformedListener).toBeDefined();
    act(() => malformedListener?.(new MessageEvent("player.observation", { data: "{" })));
    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(2));

    act(() => source.emit(cancelledEvent));
    await screen.findByText("目标已经结束");
    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(3));
    rejectStaleReconciliation?.(new Error("旧请求失败"));
    await act(async () => Promise.resolve());

    expect(screen.getByText("目标已经结束")).toBeVisible();
    expect(runtimeOptions).toMatchObject({ isRunning: false, isSendDisabled: false });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("closes the active source on unmount and ignores its callbacks", async () => {
    api.session.mockResolvedValue(detail(run("running")));
    const view = render(<GameSession sessionId="session-1" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    view.unmount();
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    source.readyState = FakeEventSource.CONNECTING;
    expect(() => source.fail()).not.toThrow();
    expect(api.session).toHaveBeenCalledTimes(1);
  });

  it("keeps a clarification id stable until persistence is confirmed", async () => {
    const awaiting = run("awaiting_player");
    api.session.mockResolvedValue(detail(awaiting));
    api.continueRun
      .mockRejectedValueOnce(new Error("连接中断"))
      .mockResolvedValueOnce(snapshot({
        ...awaiting,
        status: "completed",
        inputs: [
          ...awaiting.inputs,
          {
            id: "clarification-id",
            kind: "clarification",
            text: "使用铜钥匙",
            at: "2026-08-24T00:00:01.000Z",
          },
        ],
      }));

    render(<GameSession sessionId="session-1" />);
    await screen.findByRole("heading", { name: "测试存档" });

    await expect(runtimeOptions!.onNew(inputMessage("使用铜钥匙"))).rejects.toThrow("连接中断");
    await act(async () => runtimeOptions!.onNew(inputMessage("使用铜钥匙")));

    expect(api.continueRun).toHaveBeenCalledTimes(2);
    expect(api.continueRun.mock.calls.map((call) => call[2])).toEqual([
      "clarification-id",
      "clarification-id",
    ]);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("uses a synchronous action guard to reject duplicate submissions", async () => {
    api.session.mockResolvedValue(detail(run("completed")));
    let resolveStart: ((value: { runId: string }) => void) | undefined;
    api.startRun.mockImplementation(() => new Promise((resolve) => { resolveStart = resolve; }));
    const completed = run("completed");
    api.run.mockResolvedValue(snapshot(completed));

    render(<GameSession sessionId="session-1" />);
    await screen.findByRole("heading", { name: "测试存档" });

    const first = runtimeOptions!.onNew(inputMessage("观察石门"));
    const second = runtimeOptions!.onNew(inputMessage("观察石门"));
    expect(api.startRun).toHaveBeenCalledTimes(1);
    resolveStart?.({ runId: "run-1" });
    await act(async () => Promise.all([first, second]));

    expect(api.run).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
