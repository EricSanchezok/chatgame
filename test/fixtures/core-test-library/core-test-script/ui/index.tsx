import { useState, type CSSProperties, type FormEvent } from "react";
import {
  Button,
  Input,
  SCRIPT_UI_API_VERSION,
  SettingRow,
  Switch,
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

function WorkbenchLauncher({ script, detail, resume, newGame, actions }: LauncherSlotProps) {
  const selected = newGame.origins.find((origin) => origin.id === newGame.selectedOriginId);
  return (
    <main data-slot="launcher" className="cg-launcher-stage" aria-labelledby="core-programme-title">
      <section className="cg-launcher-step" style={{ display: "grid", placeItems: "center" }}>
        <div className="cg-launcher-card" style={frame}>
        <div className="cg-launcher__copy">
          <p style={{ color: "var(--cg-accent)" }}>UI API v5 · deterministic fixture</p>
          <h1 id="core-programme-title">{script.name}</h1>
          <p>{script.description}</p>
          <p>{detail.origins.length} 个出身 · {detail.catalog.locations.length} 个地点</p>
          {newGame.step === "overview" ? <div className="cg-launcher-card__actions"><Button type="button" variant="primary" disabled={resume.busy} onClick={actions.openNewGame}>建立值班</Button>{resume.save ? <Button type="button" variant="secondary" disabled={resume.busy} onClick={() => void resume.continueGame()}>继续值班</Button> : null}<Button type="button" variant="secondary" disabled={resume.busy || detail.saves.length === 0} onClick={actions.openSaves}>读取存档</Button></div> : null}
          {newGame.step === "origin" ? <div className="cg-form-stack"><h2>选择校验身份</h2>{newGame.status === "loading" ? <p role="status">读取出身……</p> : null}{newGame.status === "error" ? <><p role="alert">{newGame.error}</p><Button type="button" variant="secondary" onClick={newGame.retry}>重新加载</Button></> : null}{newGame.origins.map((origin) => <Button key={origin.id} type="button" variant={origin.id === newGame.selectedOriginId ? "primary" : "secondary"} disabled={!origin.available} onClick={() => newGame.selectOrigin(origin.id)}>{origin.name}{origin.available ? "" : " · 未解锁"}</Button>)}<div className="cg-dialog-actions"><Button type="button" variant="quiet" onClick={newGame.back}>返回</Button><Button type="button" variant="primary" disabled={!selected?.available} onClick={newGame.next}>确认出身</Button></div></div> : null}
          {newGame.step === "identity" ? <form className="cg-form-stack" onSubmit={(event) => { event.preventDefault(); if (selected) void actions.start(selected.id, newGame.playerName || undefined); }}><h2>确认身份</h2><p>{selected?.name} · {selected?.description}</p><label htmlFor="fixture-player-name">名字（可选）</label><Input id="fixture-player-name" value={newGame.playerName} onChange={(event) => newGame.setPlayerName(event.target.value)} /><div className="cg-dialog-actions"><Button type="button" variant="quiet" onClick={newGame.back}>重选出身</Button><Button type="submit" variant="primary">进入世界</Button></div></form> : null}
        </div>
        </div>
      </section>
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
      <Button
        type="button"
        variant="secondary"
        aria-pressed={panel === "inventory"}
        onClick={() => openPanel("inventory")}
      >
        检查清单
      </Button>
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
      <Button type="button" variant="quiet" disabled={busy} onClick={() => void inspect()}>
        预检线路
      </Button>
      <Button
        type="button"
        variant="quiet"
        disabled={busy}
        onClick={() => void submitTurn("触发系统记录", { actionId: "wait" })}
      >
        触发系统记录
      </Button>
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
        <Button type="submit" variant="primary" disabled={busy || input.trim().length === 0}>
          {busy ? "验证中" : "提交验证"}
        </Button>
      </form>
    </footer>
  );
}

function WorkbenchPauseMenu({ busy, dirty, save, exit, close }: PauseMenuSlotProps) {
  return (
    <div data-slot="pause-menu" className="cg-form-stack">
      <p>{dirty ? "当前回合尚未保存。" : "当前记录已保存。"}</p>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void save()}>
        {busy ? "保存中" : "保存校准点"}
      </Button>
      <Button type="button" variant="quiet" disabled={busy} onClick={close}>继续校验</Button>
      <Button type="button" variant="primary" disabled={busy} onClick={() => void exit(false)}>
        返回剧目单
      </Button>
    </div>
  );
}

function WorkbenchPanel({ state, close }: PanelSlotProps) {
  return (
    <section data-slot="panel-inventory" aria-label="自定义检查清单">
      <p>位置：{state.player.locationId}</p>
      <p>事件记录：{state.eventLog.length}</p>
      <Button type="button" variant="secondary" onClick={close}>关闭检查清单</Button>
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
    <SettingRow
      data-slot="settings-fixture"
      controlId="fixture-effects"
      label="工作台确认音"
      description="验证 settings:* 插槽能够读写宿主设置。"
    >
      <Switch
        id="fixture-effects"
        checked={settings.effectsVolume > 0}
        onCheckedChange={(checked) => update({ effectsVolume: checked ? 50 : 0 })}
      />
    </SettingRow>
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
