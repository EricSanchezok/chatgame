import { useState, type CSSProperties, type FormEvent } from "react";
import {
  SCRIPT_UI_API_VERSION,
  type BubbleSlotProps,
  type ComposerSlotProps,
  type GameShellSlotProps,
  type HudSlotProps,
  type LauncherSlotProps,
  type MessageCardSlotProps,
  type ObjectiveTrackerSlotProps,
  type PanelSlotProps,
  type PauseMenuSlotProps,
  type SceneSlotProps,
  type ScriptUiContext,
  type SettingsSlotProps,
  type ToolbarSlotProps,
} from "@chatgame/ui";

export const apiVersion = SCRIPT_UI_API_VERSION;

const frame: CSSProperties = {
  border: "var(--cg-border-width) solid var(--cg-border)",
  borderRadius: "var(--cg-radius-chrome)",
  background: "var(--cg-surface)",
  color: "var(--cg-text)",
};

function WorkbenchLauncher({ script, detail, actions }: LauncherSlotProps) {
  return (
    <main data-slot="launcher" className="cg-programme" aria-labelledby="core-programme-title">
      <section className="cg-programme__stage" style={frame}>
        <div className="cg-programme__copy">
          <p style={{ color: "var(--cg-accent)" }}>UI API v4 · deterministic fixture</p>
          <h1 id="core-programme-title">{script.name}</h1>
          <p>{script.description}</p>
          <p>{detail.origins.length} 个出身 · {detail.catalog.locations.length} 个地点</p>
        </div>
      </section>
      <aside className="cg-programme__actions" aria-label={`${script.name} 玩家操作`}>
        <button type="button" className="cg-button cg-button--primary" onClick={actions.openNewGame}>
          建立值班
        </button>
        <button
          type="button"
          className="cg-button cg-button--secondary"
          disabled={detail.saves.length === 0}
          onClick={actions.openSaves}
        >
          读取存档
        </button>
      </aside>
    </main>
  );
}

function WorkbenchGameShell({ regions }: GameShellSlotProps) {
  return (
    <div data-slot="game-shell" className="cg-game-shell">
      {regions.hud}
      {regions.tracker}
      {regions.scene}
      {regions.toolbar}
      {regions.composer}
      {regions.overlays}
    </div>
  );
}

function WorkbenchObjectiveTracker({ openTasks }: ObjectiveTrackerSlotProps) {
  return <button type="button" data-slot="objective-tracker" className="cg-objective-tracker" onClick={openTasks}>核心测试目标</button>;
}

function WorkbenchScene({ transcript }: SceneSlotProps) {
  return <section data-slot="scene" aria-label="可追溯值班记录">{transcript}</section>;
}

function WorkbenchHud({ state }: HudSlotProps) {
  return (
    <header data-slot="hud" style={{ ...frame, display: "flex", justifyContent: "space-between", padding: "var(--cg-space-2) var(--cg-space-3)" }}>
      <strong>核心测试台</strong>
      <span>{state.runtimeState.coreTestEngine === "v2-ready" ? "Engine API v2 已启动" : "扩展未启动"}</span>
    </header>
  );
}

function WorkbenchToolbar({ panel, openPanel }: ToolbarSlotProps) {
  return (
    <nav data-slot="toolbar" aria-label="工作台面板" className="cg-toolbar" style={frame}>
      <button
        type="button"
        className="cg-button cg-button--secondary"
        aria-pressed={panel === "inventory"}
        onClick={() => openPanel("inventory")}
      >
        检查清单
      </button>
    </nav>
  );
}

function WorkbenchComposer({ busy, previewAction, submitTurn }: ComposerSlotProps) {
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(false);

  async function inspect() {
    const result = await previewAction({ actionId: "investigate" });
    setPrepared(result?.executable === true);
    setPreview(result ? `${result.displayName} · ${result.timeCost} 小时 · ${result.executable ? "可执行" : "不可执行"}` : "预检失败");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await submitTurn(text, prepared ? { actionId: "investigate" } : undefined);
    setPrepared(false);
    setPreview(null);
  }

  return (
    <footer data-slot="composer" data-region="composer" className="cg-composer">
      <button type="button" className="cg-button cg-button--quiet" disabled={busy} onClick={() => void inspect()}>
        预检线路
      </button>
      <button
        type="button"
        className="cg-button cg-button--quiet"
        disabled={busy}
        onClick={() => void submitTurn("触发系统记录", { actionId: "wait" })}
      >
        触发系统记录
      </button>
      {preview ? <p role="status">{preview}</p> : null}
      <form onSubmit={(event) => void submit(event)}>
        <label className="cg-sr-only" htmlFor="core-player-input">输入验证指令</label>
        <textarea
          id="core-player-input"
          aria-label="输入验证指令"
          value={input}
          disabled={busy}
          rows={2}
          maxLength={2000}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" className="cg-button cg-button--primary" disabled={busy || input.trim().length === 0}>
          {busy ? "验证中" : "提交验证"}
        </button>
      </form>
    </footer>
  );
}

function WorkbenchPauseMenu({ busy, dirty, save, exit, close }: PauseMenuSlotProps) {
  return (
    <div data-slot="pause-menu" className="cg-form-stack">
      <p>{dirty ? "当前回合尚未保存。" : "当前记录已保存。"}</p>
      <button type="button" className="cg-button cg-button--secondary" disabled={busy} onClick={() => void save()}>
        {busy ? "保存中" : "保存校准点"}
      </button>
      <button type="button" className="cg-button cg-button--quiet" disabled={busy} onClick={close}>继续校验</button>
      <button type="button" className="cg-button cg-button--primary" disabled={busy} onClick={() => void exit(false)}>
        返回剧目单
      </button>
    </div>
  );
}

function WorkbenchPanel({ state, close }: PanelSlotProps) {
  return (
    <section data-slot="panel-inventory" aria-label="自定义检查清单">
      <p>位置：{state.player.locationId}</p>
      <p>事件记录：{state.eventLog.length}</p>
      <button type="button" className="cg-button cg-button--secondary" onClick={close}>关闭检查清单</button>
    </section>
  );
}

function WorkbenchBubble({ entry, children }: BubbleSlotProps) {
  return (
    <article data-slot={`bubble-${entry.role}`} data-role={entry.role} className="cg-message" style={frame}>
      {children}
    </article>
  );
}

function WorkbenchMessageCard({ kind, children }: MessageCardSlotProps) {
  return (
    <section data-slot={`message-card-${kind}`} aria-label={`自定义 ${kind} 卡片`} style={frame}>
      {children}
    </section>
  );
}

function WorkbenchSettings({ settings, update }: SettingsSlotProps) {
  return (
    <label data-slot="settings-fixture" className="cg-switch">
      <span><strong>工作台确认音</strong><small>验证 settings:* 插槽能够读写宿主设置。</small></span>
      <input
        type="checkbox"
        checked={settings.effectsVolume > 0}
        onChange={(event) => update({ effectsVolume: event.target.checked ? 50 : 0 })}
      />
    </label>
  );
}

export default function registerCoreTestUi(context: ScriptUiContext): void {
  context.register("launcher", { component: WorkbenchLauncher });
  context.register("game-shell", { component: WorkbenchGameShell });
  context.register("scene", { component: WorkbenchScene });
  context.register("hud", { component: WorkbenchHud });
  context.register("objective-tracker", { component: WorkbenchObjectiveTracker });
  context.register("toolbar", { component: WorkbenchToolbar });
  context.register("composer", { component: WorkbenchComposer });
  context.register("pause-menu", { component: WorkbenchPauseMenu });
  context.register("panel:inventory", { component: WorkbenchPanel });
  context.register("bubble:world", { component: WorkbenchBubble });
  context.register("bubble:player", { component: WorkbenchBubble });
  context.register("bubble:system", { component: WorkbenchBubble });
  context.register("message-card:event", { component: WorkbenchMessageCard });
  context.register("message-card:location_enter", { component: WorkbenchMessageCard });
  context.register("message-card:item_reveal", { component: WorkbenchMessageCard });
  context.register("settings:fixture", { component: WorkbenchSettings });
}
