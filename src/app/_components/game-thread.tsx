"use client";

import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type DataMessagePartComponent,
  type TextMessagePartComponent,
} from "@assistant-ui/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  RotateCcw,
  Square,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import type { WorldRunRecordView } from "../../shared/world-api";
import { isWorldRunActiveIntentOwner, isWorldRunRetriable } from "../../shared/world-api";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/cn";
import {
  worldRunCheckText,
  worldRunNarrative,
  worldRunStatusText,
} from "../_lib/world-run-presentation";

export interface WorldRunActions {
  abandon: (runId: string) => Promise<void>;
  actionableInputId?: string;
  actionableRunId?: string;
  pendingRunId?: string;
  retry: (runId: string) => Promise<void>;
}

interface GameThreadProps {
  actionError: string;
  awaitingPlayer: boolean;
  cancelPending: boolean;
  confirmationPending: boolean;
  runActions: WorldRunActions;
  streamWarning: string;
}

const RunActionsContext = createContext<WorldRunActions | null>(null);

function canAbandon(run: WorldRunRecordView): boolean {
  return run.status === "awaiting_player" || run.status === "step_limit" || run.status === "failed";
}

const WorldRunPart: DataMessagePartComponent = ({ data }) => {
  const actions = useContext(RunActionsContext);
  const run = data as WorldRunRecordView;
  const narrative = worldRunNarrative(run);
  const checks = run.events.filter((event) => event.type === "check.resolved");
  const actionable = actions?.actionableRunId === run.id &&
    actions.actionableInputId === run.inputs.at(-1)?.id &&
    isWorldRunActiveIntentOwner(run.status);
  const retriable = Boolean(actionable && isWorldRunRetriable(run));
  const abandonable = Boolean(actionable && canAbandon(run));
  const actionPending = actions?.pendingRunId === run.id;

  return (
    <div className="cg-world-reply" data-status={run.status}>
      {narrative.map((text, index) => (
        <p
          className={cn("cg-narrative", (run.status === "queued" || run.status === "running") && index === narrative.length - 1 ? "cg-narrative--thinking" : undefined)}
          key={`${run.id}:narrative:${index}`}
        >
          {text}
        </p>
      ))}
      {checks.length > 0 ? (
        <details className="cg-checks">
          <summary>{checks.length} 次可见检定</summary>
          <ul>
            {checks.map((event) => (
              <li key={event.sequence}>
                <span>{worldRunCheckText(event)}</span>
                <strong>{event.payload.succeeded ? "成功" : "失败"}</strong>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <footer className="cg-run-status">
        <span>{worldRunStatusText[run.status]}</span>
        {run.error ? <span className="cg-run-status__error" role="alert">{run.error}</span> : null}
        {retriable && actions ? (
          <button
            className="cg-button--quiet"
            disabled={actionPending}
            onClick={() => void actions.retry(run.id)}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {run.status === "step_limit" ? "继续推演" : "重试这一步"}
          </button>
        ) : null}
        {abandonable && actions ? (
          <button
            className="cg-button--quiet"
            disabled={actionPending}
            onClick={() => void actions.abandon(run.id)}
            type="button"
          >
            放弃目标
          </button>
        ) : null}
      </footer>
    </div>
  );
};

const UserText: TextMessagePartComponent = ({ text }) => <p className="whitespace-pre-wrap">{text}</p>;
const CopyOnlyText: TextMessagePartComponent = () => null;

function UserMessage() {
  return (
    <MessagePrimitive.Root
      className="animate-in fade-in slide-in-from-bottom-1 grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 motion-reduce:animate-none [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <div className="col-start-2 min-w-0">
        <div className="max-w-[min(85%,34rem)] rounded-xl bg-muted px-4 py-2 text-foreground wrap-break-word">
          <MessagePrimitive.Parts components={{ Text: UserText }} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantActionBar() {
  return (
    <ActionBarPrimitive.Root
      autohide="not-last"
      className="animate-in fade-in -ms-1 flex gap-1 text-muted-foreground duration-150 motion-reduce:animate-none"
      hideWhenRunning
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="复制世界回复">
          <AuiIf condition={(state) => state.message.isCopied}>
            <Check aria-hidden="true" className="size-4" />
          </AuiIf>
          <AuiIf condition={(state) => !state.message.isCopied}>
            <Copy aria-hidden="true" className="size-4" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root
      className="animate-in fade-in slide-in-from-bottom-1 relative -mb-7.5 pb-7.5 duration-150 motion-reduce:animate-none"
      data-role="assistant"
    >
      <div className="px-2 leading-relaxed text-foreground wrap-break-word">
        <MessagePrimitive.Parts
          components={{
            Text: CopyOnlyText,
            data: { by_name: { "world-run": WorldRunPart } },
          }}
        />
      </div>
      <div className="ms-2 flex min-h-7.5 items-center pt-1.5">
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
}

function ThreadMessage() {
  const role = useAuiState((state) => state.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage />;
}

function useDesktopAutoFocus(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 48rem) and (pointer: fine)");
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return enabled;
}

function Composer({
  awaitingPlayer,
  cancelPending,
  confirmationPending,
}: Pick<GameThreadProps, "awaitingPlayer" | "cancelPending" | "confirmationPending">) {
  const autoFocus = useDesktopAutoFocus();
  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col">
      <div className="aui-composer-shell flex w-full cursor-text flex-col gap-2 rounded-3xl border border-border bg-card p-2">
        <ComposerPrimitive.Input
          aria-label={awaitingPlayer ? "补充信息" : "你的行动"}
          autoFocus={autoFocus}
          className="max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
          enterKeyHint="send"
          maxLength={4000}
          placeholder={awaitingPlayer ? "补充你的选择、方法或缺失信息…" : "说出你的行动…"}
          rows={1}
          submitMode="enter"
          unstable_insertNewlineOnTouchEnter
        />
        <div className="flex min-h-8 items-center justify-end">
          <AuiIf condition={(state) => !state.thread.isRunning}>
            <ComposerPrimitive.Send asChild>
              <TooltipIconButton
                aria-label={confirmationPending ? "正在确认行动" : "发送行动"}
                className="size-8 bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                disabled={confirmationPending}
                tooltip={confirmationPending ? "正在确认行动" : "发送行动"}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(state) => state.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild>
              <TooltipIconButton
                aria-label={cancelPending ? "正在停止推演" : "停止推演"}
                className="size-8 bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                disabled={cancelPending}
                tooltip={cancelPending ? "正在停止推演" : "停止推演"}
              >
                <Square aria-hidden="true" className="size-3.5 fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

function ScrollToBottom() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        className="absolute -top-12 z-10 self-center border bg-background disabled:invisible"
        tooltip="滚动到最新消息"
      >
        <ArrowDown aria-hidden="true" className="size-4" />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
}

function ThreadContent(props: GameThreadProps) {
  const isEmpty = useAuiState((state) => state.thread.messages.length === 0);
  return (
    <ThreadPrimitive.Root
      className="aui-root flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "44rem",
      }}
    >
      <ThreadPrimitive.Viewport
        className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth"
        turnAnchor="top"
      >
        <div className={cn("mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4", isEmpty && "justify-center")}>
          {isEmpty ? (
            <section className="mb-6 flex flex-col items-center px-4 text-center">
              <h2 className="animate-in fade-in slide-in-from-bottom-1 text-2xl font-medium tracking-tight duration-200 motion-reduce:animate-none">
                你想做什么？
              </h2>
            </section>
          ) : null}
          <div className="mb-14 flex flex-col gap-y-6 empty:hidden">
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter
            data-docked={!isEmpty}
            data-slot="aui-thread-viewport-footer"
            className={cn(
              "relative flex flex-col gap-3 overflow-visible bg-background pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-6",
              !isEmpty && "sticky bottom-0 mt-auto rounded-t-3xl",
            )}
          >
            <ScrollToBottom />
            <div aria-live="polite" className={cn("rounded-xl border bg-card px-3 py-2 text-sm", !props.streamWarning && "cg-sr-only")} role="status">
              {props.streamWarning}
            </div>
            {props.actionError ? (
              <div className="rounded-xl border border-destructive bg-destructive-soft px-3 py-2 text-sm text-foreground" role="alert">
                {props.actionError}
              </div>
            ) : null}
            <Composer
              awaitingPlayer={props.awaitingPlayer}
              cancelPending={props.cancelPending}
              confirmationPending={props.confirmationPending}
            />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

export function GameThread(props: GameThreadProps) {
  return (
    <RunActionsContext.Provider value={props.runActions}>
      <ThreadContent {...props} />
    </RunActionsContext.Provider>
  );
}
