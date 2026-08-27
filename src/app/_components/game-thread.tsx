"use client";

import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  useAuiState,
  type TextMessagePartComponent,
} from "@assistant-ui/react";
import { ArrowDown, ArrowUp, Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/cn";

export interface GameThreadProps {
  actionError: string;
  busy: boolean;
  footer?: ReactNode;
  readOnly?: boolean;
  streamWarning: string;
  suggestions?: readonly string[];
}

const MessageText: TextMessagePartComponent = ({ text }) => (
  <p className="cg-narrative whitespace-pre-wrap">{text}</p>
);

function UserMessage() {
  return (
    <MessagePrimitive.Root
      className="animate-in fade-in slide-in-from-bottom-1 flex w-full justify-end px-2 duration-150 motion-reduce:animate-none"
      data-role="user"
    >
      <div className="aui-user-message-bubble rounded-xl bg-muted px-4 py-2 text-foreground">
        <MessagePrimitive.Parts components={{ Text: MessageText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root
      className="animate-in fade-in slide-in-from-bottom-1 relative -mb-7.5 pb-7.5 duration-150 motion-reduce:animate-none"
      data-role="assistant"
    >
      <div className="px-2 leading-relaxed text-foreground wrap-break-word">
        <MessagePrimitive.Parts components={{ Text: MessageText }} />
      </div>
      <div className="ms-2 flex min-h-7.5 items-center pt-1.5">
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

function SuggestionChips({ suggestions }: { suggestions: readonly string[] }) {
  const composer = unstable_useComposerInput();
  if (suggestions.length === 0) return null;
  return (
    <div className="cg-thread-suggestions" aria-label="行动建议">
      {suggestions.map((suggestion) => (
        <button key={suggestion} onClick={() => composer.setText(suggestion)} type="button">
          {suggestion}
        </button>
      ))}
    </div>
  );
}

function Composer({ busy, suggestions }: { busy: boolean; suggestions: readonly string[] }) {
  const autoFocus = useDesktopAutoFocus();
  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col">
      <SuggestionChips suggestions={suggestions} />
      <div className="aui-composer-shell flex w-full cursor-text flex-col gap-2 rounded-3xl border border-border bg-card p-2">
        <ComposerPrimitive.Input
          aria-label="你的行动"
          autoFocus={autoFocus}
          className="max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
          enterKeyHint="send"
          maxLength={4000}
          placeholder="说出你的行动…"
          rows={1}
          submitMode="enter"
          unstable_insertNewlineOnTouchEnter
        />
        <div className="flex min-h-8 items-center justify-end">
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              aria-label={busy ? "世界正在推演" : "发送行动"}
              className="size-8 bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
              disabled={busy}
              tooltip={busy ? "世界正在推演" : "发送行动"}
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
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

export function GameThread({
  actionError,
  busy,
  footer,
  readOnly = false,
  streamWarning,
  suggestions = [],
}: GameThreadProps) {
  const isEmpty = useAuiState((state) => state.thread.messages.length === 0);
  return (
    <ThreadPrimitive.Root
      className="aui-root flex h-full flex-col bg-background"
      style={{ ["--thread-max-width" as string]: "44rem" }}
    >
      <ThreadPrimitive.Viewport
        className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth"
        turnAnchor="top"
      >
        <div className={cn(
          "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
          isEmpty && "justify-center",
        )}>
          {isEmpty ? (
            <section className="mb-6 flex flex-col items-center px-4 text-center">
              <h2 className="text-2xl font-medium tracking-tight">
                {readOnly ? "这个角色还没有留下可见经历" : "你想做什么？"}
              </h2>
            </section>
          ) : null}
          <div className="mb-14 flex flex-col gap-y-6 empty:hidden">
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
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
            <div
              aria-live="polite"
              className={cn("rounded-xl border bg-card px-3 py-2 text-sm", !streamWarning && "cg-sr-only")}
              role="status"
            >
              {streamWarning}
            </div>
            {actionError ? (
              <div className="rounded-xl border border-destructive bg-destructive-soft px-3 py-2 text-sm" role="alert">
                {actionError}
              </div>
            ) : null}
            {footer}
            {!readOnly ? <Composer busy={busy} suggestions={suggestions} /> : null}
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
