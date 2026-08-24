import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SettingsPanel } from "./settings-panel";

export function SettingsScreen() {
  return (
    <main className="cg-settings-page">
      <header className="cg-settings-page__header">
        <Link className="cg-back-link" href="/"><ArrowLeft aria-hidden="true" />主菜单</Link>
        <p className="cg-eyebrow">本机偏好</p>
        <h1>设置</h1>
        <p>调整外观、文字和动态效果。所有偏好只保存在这台设备上。</p>
      </header>
      <SettingsPanel />
    </main>
  );
}
