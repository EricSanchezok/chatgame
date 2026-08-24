import type { LucideIcon } from "lucide-react";
import { House, LibraryBig, Settings } from "lucide-react";

export interface ControlAction {
  kind: "manage" | "exit";
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
}

export function controlActions(sessionId: string): readonly ControlAction[] {
  const base = `/play/${encodeURIComponent(sessionId)}/manage`;
  return [
    { kind: "manage", href: `${base}/saves`, icon: LibraryBig, label: "存档", description: "管理当前世界的旅程" },
    { kind: "manage", href: `${base}/settings`, icon: Settings, label: "设置", description: "调整阅读与动效偏好" },
    { kind: "exit", href: "/", icon: House, label: "主菜单", description: "离开游戏，返回世界入口" },
  ] as const;
}
