import type { LucideIcon } from "lucide-react";
import { House, LibraryBig, Settings, Waypoints } from "lucide-react";

export interface ControlAction {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
}

export const controlActions: readonly ControlAction[] = [
  { href: "/", icon: House, label: "主菜单", description: "回到游戏入口" },
  { href: "/saves", icon: LibraryBig, label: "存档", description: "切换、命名或删除旅程" },
  { href: "/worlds", icon: Waypoints, label: "世界", description: "开始新游戏或导入剧本" },
  { href: "/settings", icon: Settings, label: "设置", description: "调整阅读与动效偏好" },
] as const;
