"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Select, SettingRow, Slider, Switch } from "@/shared/ui-runtime";
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
import { HostAppShell } from "../ui/host-app-shell";

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
  const [hasError, setHasError] = useState(false);

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
        if (!activation.ok) {
          setStatus("剧本专属设置扩展加载失败；全局设置仍可使用。");
          setHasError(true);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatus(`剧本设置读取失败：${error instanceof Error ? error.message : String(error)}`);
          setHasError(true);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  function update(patch: Partial<Omit<PlayerSettingsV3, "version">>) {
    patchPlayerSettings(patch);
    setStatus("设置已保存。");
    setHasError(false);
  }

  const settingSlots = registeredSlots("settings:");
  return (
    <HostAppShell active="settings" script={script ? { name: script.name, description: script.description } : null} status={status} statusVisible={hasError}>
      <div className="cg-settings">
        <header className="cg-page-heading">
          <div><h1>设置</h1><p>偏好会自动保存在此浏览器中，不会被单个剧本覆盖。</p></div>
        </header>

        <section className="cg-settings-section" aria-labelledby="reading-title">
          <header><h2 id="reading-title">阅读</h2><p>调整文字密度与信息辨识度。</p></header>
          <div className="cg-setting-fields">
            <SettingRow controlId="text-scale" label="文字大小" description="同时调整界面和叙事正文的字号。"><Select id="text-scale" value={String(settings.textScale)} onValueChange={(value) => update({ textScale: Number(value) as PlayerSettingsV3["textScale"] })} options={[{ value: "1", label: "标准" }, { value: "1.25", label: "125%" }, { value: "1.5", label: "150%" }, { value: "2", label: "200%" }]} /></SettingRow>
            <SettingRow controlId="contrast" label="对比度" description="增强模式会提升边界与文字辨识度。"><Select id="contrast" value={settings.contrast} onValueChange={(value) => update({ contrast: value as PlayerSettingsV3["contrast"] })} options={[{ value: "system", label: "跟随系统" }, { value: "more", label: "增强" }]} /></SettingRow>
            <SettingRow controlId="theme-mode" label="游戏主题" description="可固定主题，或跟随当前剧本与地点。"><Select id="theme-mode" value={settings.themeMode} onValueChange={(value) => update({ themeMode: value })} options={[{ value: "follow", label: "跟随剧本与地点" }, ...(detail?.presentation.themes.map((theme) => ({ value: theme.id, label: theme.name })) ?? [])]} /></SettingRow>
          </div>
        </section>

        <section className="cg-settings-section" aria-labelledby="sound-title">
          <header><h2 id="sound-title">声音</h2><p>统一管理环境音、语音与事件音效。</p></header>
          <div className="cg-setting-fields">
            <SettingRow controlId="audio-enabled" label="声音" description="进入世界后播放剧本声明的环境音与音效。"><Switch id="audio-enabled" checked={settings.audioEnabled} onCheckedChange={(checked) => update({ audioEnabled: checked })} /></SettingRow>
            <SettingRow label="总音量"><div className="cg-slider-field"><Slider aria-label="总音量" min={0} max={100} value={settings.masterVolume} onValueChange={(value) => update({ masterVolume: value })} /><output>{settings.masterVolume}%</output></div></SettingRow>
            <SettingRow label="环境音"><div className="cg-slider-field"><Slider aria-label="环境音" min={0} max={100} value={settings.ambientVolume} onValueChange={(value) => update({ ambientVolume: value })} /><output>{settings.ambientVolume}%</output></div></SettingRow>
            <SettingRow label="语音"><div className="cg-slider-field"><Slider aria-label="语音" min={0} max={100} value={settings.voiceVolume} onValueChange={(value) => update({ voiceVolume: value })} /><output>{settings.voiceVolume}%</output></div></SettingRow>
            <SettingRow label="音效"><div className="cg-slider-field"><Slider aria-label="音效" min={0} max={100} value={settings.effectsVolume} onValueChange={(value) => update({ effectsVolume: value })} /><output>{settings.effectsVolume}%</output></div></SettingRow>
          </div>
        </section>

        <section className="cg-settings-section" aria-labelledby="display-title">
          <header><h2 id="display-title">显示与动效</h2><p>减少动效不会移除等待与结果反馈。</p></header>
          <div className="cg-setting-fields">
            <SettingRow controlId="motion" label="动效" description="可关闭横向位移、缩放和非必要过渡。"><Select id="motion" value={settings.motion} onValueChange={(value) => update({ motion: value as PlayerSettingsV3["motion"] })} options={[{ value: "system", label: "跟随系统" }, { value: "reduce", label: "减少" }]} /></SettingRow>
            <SettingRow controlId="fullscreen-on-start" label="开始时进入全屏" description="浏览器拒绝全屏时，游戏仍会在窗口中继续。"><Switch id="fullscreen-on-start" checked={settings.fullscreenOnStart} onCheckedChange={(checked) => update({ fullscreenOnStart: checked })} /></SettingRow>
          </div>
        </section>

        {script && detail && settingSlots.length > 0 ? (
          <section className="cg-settings-section" aria-labelledby="script-settings-title">
            <header><h2 id="script-settings-title">《{script.name}》</h2><p>由当前剧本提供的可选设置。</p></header>
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
      </div>
    </HostAppShell>
  );
}
