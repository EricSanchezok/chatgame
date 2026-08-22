import type { CSSProperties } from "react";
import {
  Button,
  Input,
  SCRIPT_UI_API_VERSION,
  SettingRow,
  Switch,
  type BubbleSlotProps,
  type GameShellSlotProps,
  type LauncherSlotProps,
  type MessageCardSlotProps,
  type PanelSlotProps,
  type SceneSlotProps,
  type ScriptUiContext,
  type SettingsSlotProps,
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
        <div className="cg-launcher-card" style={frame}><div className="cg-launcher__copy">
          <p style={{ color: "var(--cg-accent)" }}>UI API v6 · deterministic fixture</p>
          <h1 id="core-programme-title">{script.name}</h1>
          <p>{script.description}</p>
          <p>{detail.origins.length} 个出身 · {detail.catalog.locations.length} 个地点</p>
          {newGame.step === "overview" ? <div className="cg-launcher-card__actions"><Button type="button" variant="primary" disabled={resume.busy} onClick={actions.openNewGame}>建立值班</Button>{resume.save ? <Button type="button" variant="secondary" disabled={resume.busy} onClick={() => void resume.continueGame()}>继续值班</Button> : null}<Button type="button" variant="secondary" disabled={resume.busy || detail.saves.length === 0} onClick={actions.openSaves}>读取存档</Button></div> : null}
          {newGame.step === "origin" ? <div className="cg-form-stack"><h2>选择校验身份</h2>{newGame.status === "loading" ? <p role="status">读取出身……</p> : null}{newGame.status === "error" ? <><p role="alert">{newGame.error}</p><Button type="button" variant="secondary" onClick={newGame.retry}>重新加载</Button></> : null}{newGame.origins.map((origin) => <Button key={origin.id} type="button" variant={origin.id === newGame.selectedOriginId ? "primary" : "secondary"} disabled={!origin.available} onClick={() => newGame.selectOrigin(origin.id)}>{origin.name}{origin.available ? "" : " · 未解锁"}</Button>)}<div className="cg-dialog-actions"><Button type="button" variant="quiet" onClick={newGame.back}>返回</Button><Button type="button" variant="primary" disabled={!selected?.available} onClick={newGame.next}>确认出身</Button></div></div> : null}
          {newGame.step === "identity" ? <form className="cg-form-stack" onSubmit={(event) => { event.preventDefault(); if (selected) void actions.start(selected.id, newGame.playerName || undefined); }}><h2>确认身份</h2><p>{selected?.name} · {selected?.description}</p><label htmlFor="fixture-player-name">名字（可选）</label><Input id="fixture-player-name" value={newGame.playerName} onChange={(event) => newGame.setPlayerName(event.target.value)} /><div className="cg-dialog-actions"><Button type="button" variant="quiet" onClick={newGame.back}>重选出身</Button><Button type="submit" variant="primary">进入世界</Button></div></form> : null}
        </div></div>
      </section>
    </main>
  );
}

function WorkbenchGameShell({ regions }: GameShellSlotProps) {
  return <div data-slot="game-shell" className="cg-game-workspace">{regions.topbar}<main className="cg-game-main">{regions.conversation}</main>{regions.toolRail}{regions.overlays}</div>;
}

function WorkbenchScene({ transcript }: SceneSlotProps) {
  return <section data-slot="scene" aria-label="可追溯值班记录">{transcript}</section>;
}

function WorkbenchPanel({ state, close }: PanelSlotProps) {
  return <section data-slot="panel-inventory" aria-label="自定义检查清单"><p>位置：{state.player.locationId}</p><p>事件记录：{state.eventLog.length}</p><Button type="button" variant="secondary" onClick={close}>关闭检查清单</Button></section>;
}

function WorkbenchBubble({ entry, children }: BubbleSlotProps) {
  return <article data-slot={`bubble-${entry.role}`} data-role={entry.role} className="cg-message" style={frame}>{children}</article>;
}

function WorkbenchMessageCard({ kind, children }: MessageCardSlotProps) {
  return <section data-slot={`message-card-${kind}`} aria-label={`自定义 ${kind} 卡片`} style={frame}>{children}</section>;
}

function WorkbenchSettings({ settings, update }: SettingsSlotProps) {
  return <SettingRow data-slot="settings-fixture" controlId="fixture-effects" label="工作台确认音" description="验证 settings:* 插槽能够读写宿主设置。"><Switch id="fixture-effects" checked={settings.effectsVolume > 0} onCheckedChange={(checked) => update({ effectsVolume: checked ? 50 : 0 })} /></SettingRow>;
}

export default function registerCoreTestUi(context: ScriptUiContext): void {
  context.configureGame({
    objective: () => ({ title: "恢复信号", detail: "检查备用线路", progress: { value: 0, max: 1 } }),
    suggestions: () => [{ id: "inspect", label: "检查备用线路", detail: "确定性预检", intentHint: { actionId: "inspect" } }],
  });
  context.register("launcher", { component: WorkbenchLauncher });
  context.register("game-shell", { component: WorkbenchGameShell });
  context.register("scene", { component: WorkbenchScene });
  context.register("panel:inventory", { component: WorkbenchPanel });
  context.register("bubble:world", { component: WorkbenchBubble });
  context.register("bubble:player", { component: WorkbenchBubble });
  context.register("bubble:system", { component: WorkbenchBubble });
  context.register("message-card:event", { component: WorkbenchMessageCard });
  context.register("message-card:location_enter", { component: WorkbenchMessageCard });
  context.register("message-card:item_reveal", { component: WorkbenchMessageCard });
  context.register("settings:fixture", { component: WorkbenchSettings });
}
