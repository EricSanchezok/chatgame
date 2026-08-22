"use client";

import {
  Backpack,
  BookOpenText,
  CirclePause,
  LayoutGrid,
  ListChecks,
  Map,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Dialog } from "../dialog";
import type { PanelId, PanelSelection } from "./state";

interface GameTool {
  id: PanelId;
  label: string;
  icon: LucideIcon;
}

export const GAME_TOOLS: readonly GameTool[] = [
  { id: "people", label: "人物", icon: UsersRound },
  { id: "inventory", label: "背包", icon: Backpack },
  { id: "tasks", label: "任务", icon: ListChecks },
  { id: "map", label: "地图", icon: Map },
  { id: "records", label: "档案", icon: BookOpenText },
];

interface ToolProps {
  panel: PanelSelection | null;
  onOpenPanel(panel: PanelId): void;
  onOpenPause(): void;
}

export function GameToolRail({ panel, onOpenPanel, onOpenPause }: ToolProps) {
  return (
    <nav className="cg-game-tools" aria-label="游戏资料">
      <div className="cg-game-tools__group">
        {GAME_TOOLS.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="cg-game-tools__button"
                  aria-label={label}
                  aria-pressed={panel?.id === id}
                  onClick={() => onOpenPanel(id)}
                />
              }
            >
              <Icon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="cg-game-tools__footer">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="cg-game-tools__button"
                aria-label="游戏菜单"
                onClick={onOpenPause}
              />
            }
          >
            <CirclePause aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>游戏菜单</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}

export function MobileToolsButton({ onClick }: { onClick(): void }) {
  return (
    <button type="button" className="cg-mobile-tools-button" aria-label="打开游戏资料" onClick={onClick}>
      <LayoutGrid aria-hidden="true" />
    </button>
  );
}

export function ToolPickerDialog({ onClose, onOpenPanel, onOpenPause }: {
  onClose(): void;
  onOpenPanel(panel: PanelId): void;
  onOpenPause(): void;
}) {
  return (
    <Dialog title="游戏资料" description="选择要查看的资料。" onClose={onClose} className="cg-game-dialog cg-tool-picker-dialog">
      <div className="cg-tool-picker">
        {GAME_TOOLS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => { onClose(); onOpenPanel(id); }}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
        <button type="button" onClick={() => { onClose(); onOpenPause(); }}>
          <CirclePause aria-hidden="true" />
          <span>游戏菜单</span>
        </button>
      </div>
    </Dialog>
  );
}
