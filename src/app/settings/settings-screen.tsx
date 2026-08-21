"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { httpGamePort, type ScriptDetail, type ScriptSummary } from "../lib/api";
import {
  getPlayerSettingsSnapshot,
  getServerPlayerSettingsSnapshot,
  hydratePlayerSettings,
  patchPlayerSettings,
  subscribePlayerSettings,
  type PlayerSettingsV3,
} from "../lib/settings";
import {
  loadScriptUi,
  registeredSlots,
} from "../lib/script-registry";
import { applyHostTheme } from "../lib/theme";
import { SlotRenderer } from "../ui/game/slots";

function EmptyScriptSettings() {
  return null;
}

export function SettingsScreen() {
  const settings = useSyncExternalStore(
    subscribePlayerSettings,
    getPlayerSettingsSnapshot,
    getServerPlayerSettingsSnapshot,
  );
  const [script, setScript] = useState<ScriptSummary | null>(null);
  const [detail, setDetail] = useState<ScriptDetail | null>(null);
  const [status, setStatus] = useState("设置会自动保存在此浏览器中。");

  useEffect(() => {
    applyHostTheme();
    const current = hydratePlayerSettings();
    const controller = new AbortController();
    void (async () => {
      try {
        const { scripts } = await httpGamePort.listScripts(controller.signal);
        const active = scripts.find((item) => item.id === current.activeScriptId) ?? scripts[0] ?? null;
        if (!active) return;
        const nextDetail = await httpGamePort.scriptDetail(active.id, controller.signal);
        const activation = await loadScriptUi(active.id, nextDetail.presentation.uiBundle);
        if (controller.signal.aborted || activation.stale) return;
        setScript(active);
        setDetail(nextDetail);
        if (!activation.ok) setStatus("剧本专属设置扩展加载失败；全局设置仍可使用。");
      } catch (error) {
        if (!controller.signal.aborted) setStatus(`剧本设置读取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => controller.abort();
  }, []);

  function update(patch: Partial<Omit<PlayerSettingsV3, "version">>) {
    patchPlayerSettings(patch);
    setStatus("设置已保存。");
  }

  const settingSlots = registeredSlots("settings:");
  return (
    <div className="cg-host-page cg-settings-page">
      <header className="cg-host-header">
        <Link className="cg-wordmark" href="/">Chatgame</Link>
        <nav className="cg-host-nav" aria-label="全局">
          <Link href="/">游戏</Link>
          <Link href="/scripts">剧本</Link>
          <span aria-current="page">设置</span>
        </nav>
      </header>

      <main className="cg-settings">
        <header className="cg-page-heading">
          <div><h1>设置</h1><p>这些偏好属于宿主，不会被单个剧本覆盖。</p></div>
        </header>

        <section className="cg-settings-section" aria-labelledby="reading-title">
          <div><h2 id="reading-title">阅读</h2><p>调整文字密度与信息辨识度。</p></div>
          <div className="cg-setting-fields">
            <label htmlFor="text-scale"><span>文字大小</span><select id="text-scale" value={settings.textScale} onChange={(event) => update({ textScale: Number(event.target.value) as PlayerSettingsV3["textScale"] })}><option value="1">标准</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
            <label htmlFor="contrast"><span>对比度</span><select id="contrast" value={settings.contrast} onChange={(event) => update({ contrast: event.target.value as PlayerSettingsV3["contrast"] })}><option value="system">跟随系统</option><option value="more">增强</option></select></label>
            <label htmlFor="theme-mode"><span>游戏主题</span><select id="theme-mode" value={settings.themeMode} onChange={(event) => update({ themeMode: event.target.value })}><option value="follow">跟随剧本与地点</option>{detail?.presentation.themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
          </div>
        </section>

        <section className="cg-settings-section" aria-labelledby="motion-title">
          <div><h2 id="motion-title">声音与动效</h2><p>减少动效不会移除等待与结果反馈。</p></div>
          <div className="cg-setting-fields">
            <label className="cg-switch"><span><strong>声音</strong><small>进入世界后播放剧本声明的环境音与音效。</small></span><input type="checkbox" checked={settings.audioEnabled} onChange={(event) => update({ audioEnabled: event.target.checked })} /></label>
            <label htmlFor="master-volume"><span>总音量 · {settings.masterVolume}%</span><input id="master-volume" type="range" min="0" max="100" value={settings.masterVolume} onChange={(event) => update({ masterVolume: Number(event.target.value) })} /></label>
            <label htmlFor="ambient-volume"><span>环境音 · {settings.ambientVolume}%</span><input id="ambient-volume" type="range" min="0" max="100" value={settings.ambientVolume} onChange={(event) => update({ ambientVolume: Number(event.target.value) })} /></label>
            <label htmlFor="voice-volume"><span>语音 · {settings.voiceVolume}%</span><input id="voice-volume" type="range" min="0" max="100" value={settings.voiceVolume} onChange={(event) => update({ voiceVolume: Number(event.target.value) })} /></label>
            <label htmlFor="effects-volume"><span>音效 · {settings.effectsVolume}%</span><input id="effects-volume" type="range" min="0" max="100" value={settings.effectsVolume} onChange={(event) => update({ effectsVolume: Number(event.target.value) })} /></label>
            <label htmlFor="motion"><span>动效</span><select id="motion" value={settings.motion} onChange={(event) => update({ motion: event.target.value as PlayerSettingsV3["motion"] })}><option value="system">跟随系统</option><option value="reduce">减少</option></select></label>
            <label className="cg-switch"><span><strong>开始时进入全屏</strong><small>浏览器拒绝全屏时，游戏仍会在窗口中继续。</small></span><input type="checkbox" checked={settings.fullscreenOnStart} onChange={(event) => update({ fullscreenOnStart: event.target.checked })} /></label>
          </div>
        </section>

        {script && detail && settingSlots.length > 0 ? (
          <section className="cg-settings-section" aria-labelledby="script-settings-title">
            <div><h2 id="script-settings-title">《{script.name}》</h2><p>由当前剧本提供的可选设置。</p></div>
            <div className="cg-setting-fields">
              {settingSlots.map((slot) => (
                <SlotRenderer
                  key={slot}
                  slot={slot as `settings:${string}`}
                  fallback={EmptyScriptSettings}
                  slotProps={{ script, detail, settings, update }}
                />
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <p className="cg-status-line" role="status" aria-live="polite">{status}</p>
    </div>
  );
}
