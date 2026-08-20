/** Browser-safe contract shared by the host and script UI bundles. */
import type { ComponentType, ReactNode } from "react";
import type {
  AssetManifest,
  ActionPreview,
  Catalog,
  ImportPreview,
  IntentHint,
  ScriptDetail,
  ScriptSummary,
  TranscriptEntry,
  WorldStateView,
} from "./client-dto";

export { SCRIPT_UI_API_VERSION } from "./client-dto";

export type SlotId =
  | "launcher"
  | "game-shell"
  | "scene"
  | "hud"
  | "toolbar"
  | "composer"
  | "pause-menu"
  | `panel:${string}`
  | `bubble:${string}`
  | `message-card:${string}`
  | `settings:${string}`;

export interface ScriptHostModel {
  scriptId: string;
  state: WorldStateView;
  catalog: Catalog;
  assets: AssetManifest;
}

export interface LauncherSlotProps {
  script: ScriptSummary;
  detail: ScriptDetail;
  coverUrl: string;
  actions: {
    openNewGame(): void;
    openSaves(): void;
    start(originId: string, playerName?: string): Promise<void>;
    continueRun(runId: string): Promise<void>;
  };
}

export interface GameShellSlotProps extends ScriptHostModel {
  regions: { hud: ReactNode; scene: ReactNode; toolbar: ReactNode; composer: ReactNode; overlays: ReactNode };
}

export interface SceneSlotProps extends ScriptHostModel { transcript: ReactNode }
export type HudSlotProps = ScriptHostModel;

export interface ToolbarSlotProps extends ScriptHostModel {
  panel: string | null;
  openPanel(panel: string): void;
}

export interface ComposerSlotProps extends ScriptHostModel {
  busy: boolean;
  submitTurn(text: string, intentHint?: IntentHint): Promise<void>;
  previewAction(intentHint: IntentHint): Promise<ActionPreview | null>;
}

export interface PauseMenuSlotProps extends ScriptHostModel {
  busy: boolean;
  dirty: boolean;
  themeMode: string;
  themes: Array<{ id: string; name: string }>;
  audioEnabled: boolean;
  isFullscreen: boolean;
  setTheme(mode: string): void;
  setAudio(enabled: boolean): void;
  exitFullscreen(): Promise<void>;
  close(): void;
  save(): Promise<void>;
  exit(saveFirst: boolean): Promise<void>;
}

export interface PanelSlotProps extends ScriptHostModel { panelId: string; close(): void }
export interface BubbleSlotProps extends ScriptHostModel { entry: TranscriptEntry; children: ReactNode }

export interface MessageCardSlotProps extends ScriptHostModel {
  kind: string;
  entry: TranscriptEntry;
  payload: Readonly<Record<string, unknown>>;
  children: ReactNode;
}

export interface PlayerUiSettings {
  version: 2;
  audioEnabled: boolean;
  masterVolume: number;
  ambientVolume: number;
  voiceVolume: number;
  effectsVolume: number;
  fullscreenOnStart: boolean;
  themeMode: "follow" | string;
  textScale: 1 | 1.25 | 1.5 | 2;
  contrast: "system" | "more";
  motion: "system" | "reduce";
  activeScriptId: string | null;
  lastRun: { scriptId: string; runId: string } | null;
}

export interface SettingsSlotProps {
  script: ScriptSummary;
  detail: ScriptDetail;
  settings: PlayerUiSettings;
  preview?: ImportPreview;
  update(patch: Partial<Omit<PlayerUiSettings, "version">>): void;
}

export type SlotProps<K extends SlotId> =
  K extends "launcher" ? LauncherSlotProps
    : K extends "game-shell" ? GameShellSlotProps
      : K extends "scene" ? SceneSlotProps
        : K extends "hud" ? HudSlotProps
          : K extends "toolbar" ? ToolbarSlotProps
            : K extends "composer" ? ComposerSlotProps
              : K extends "pause-menu" ? PauseMenuSlotProps
                : K extends `panel:${string}` ? PanelSlotProps
                  : K extends `bubble:${string}` ? BubbleSlotProps
                    : K extends `message-card:${string}` ? MessageCardSlotProps
                      : K extends `settings:${string}` ? SettingsSlotProps
                        : never;

export interface SlotDef<K extends SlotId = SlotId> { component: ComponentType<SlotProps<K>> }

export interface ScriptUiContext {
  readonly apiVersion: 3;
  register<K extends SlotId>(slot: K, def: SlotDef<K>): void;
}
