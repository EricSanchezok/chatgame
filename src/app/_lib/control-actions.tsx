import type { LucideIcon } from "lucide-react";
import { House, LibraryBig, Settings, UserRound } from "lucide-react";

export interface ControlAction {
  kind: "character" | "saves" | "settings" | "exit";
  icon: LucideIcon;
  label: string;
  description: string;
}

export const controlActions: readonly ControlAction[] = [
  { kind: "character", icon: UserRound, label: "角色", description: "查看记忆、目标与内在状态" },
  { kind: "saves", icon: LibraryBig, label: "存档", description: "管理当前世界的旅程" },
  { kind: "settings", icon: Settings, label: "设置", description: "调整阅读、动效与高级工具" },
  { kind: "exit", icon: House, label: "主菜单", description: "离开游戏，返回世界入口" },
] as const;
