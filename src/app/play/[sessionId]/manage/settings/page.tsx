import { SettingsPanel } from "../../../../_components/settings-panel";

export default function GameSettingsPage() {
  return (
    <section className="cg-game-manage__section" aria-labelledby="game-settings-title">
      <header>
        <p className="cg-eyebrow">本机偏好</p>
        <h2 id="game-settings-title">设置</h2>
        <p>改动会立即应用到当前对话和其他管理页面。</p>
      </header>
      <SettingsPanel />
    </section>
  );
}
