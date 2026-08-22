/** Browser-safe contract shared by the host and script UI bundles. */
import type { ComponentType, ReactNode } from "react";
import type {
  AssetManifest,
  Catalog,
  ImportPreview,
  IntentHint,
  ScriptDetail,
  ScriptSummary,
  TranscriptEntry,
  WorldStateView,
} from "./client-dto";
import { SCRIPT_UI_API_VERSION } from "./client-dto";

export { SCRIPT_UI_API_VERSION };
export {
  Badge,
  Button,
  Checkbox,
  Frame,
  FramePanel,
  Input,
  InputGroup,
  Select,
  SettingRow,
  Slider,
  Switch,
  Textarea,
} from "./ui-runtime";
export type { ButtonVariant, ControlSize, SelectOption } from "./ui-runtime";

export type SlotId =
  | "launcher"
  | "game-shell"
  | "scene"
  | `panel:${GamePanelId}`
  | `bubble:${string}`
  | `message-card:${string}`
  | `settings:${string}`;

export type GamePanelId = "people" | "inventory" | "tasks" | "map" | "records";

export interface GameSuggestion {
  id: string;
  label: string;
  detail?: string;
  intentHint: IntentHint;
}

export interface GameObjective {
  title: string;
  detail?: string;
  progress?: { value: number; max: number };
}

export interface GamePresentation {
  suggestions(model: ScriptHostModel): readonly GameSuggestion[];
  objective(model: ScriptHostModel): GameObjective | null;
}

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
  resume: {
    save: ScriptDetail["saves"][number] | null;
    busy: boolean;
    continueGame(): Promise<void>;
  };
  newGame: {
    step: "overview" | "origin" | "identity";
    status: "idle" | "loading" | "ready" | "error";
    origins: Array<ScriptDetail["origins"][number] & { available: boolean }>;
    selectedOriginId: string;
    playerName: string;
    error: string | null;
    selectOrigin(originId: string): void;
    setPlayerName(playerName: string): void;
    next(): void;
    back(): void;
    retry(): void;
  };
  actions: {
    openNewGame(): void;
    openSaves(): void;
    start(originId: string, playerName?: string): Promise<void>;
    continueRun(runId: string): Promise<void>;
  };
}

export interface GameShellSlotProps extends ScriptHostModel {
  regions: {
    topbar: ReactNode;
    conversation: ReactNode;
    toolRail: ReactNode;
    overlays: ReactNode;
  };
}

export interface SceneSlotProps extends ScriptHostModel { transcript: ReactNode }

export interface PanelSlotProps extends ScriptHostModel {
  panelId: GamePanelId;
  focusId: string | null;
  trackedTaskId: string | null;
  trackTask(taskId: string | null): void;
  close(): void;
}
export interface BubbleSlotProps extends ScriptHostModel {
  entry: TranscriptEntry;
  speaker?: {
    id: string;
    name: string;
    description: string;
    occupation?: string;
    relationLabel?: string;
  };
  isFirstAppearance: boolean;
  children: ReactNode;
}

export interface MessageCardSlotProps extends ScriptHostModel {
  kind: string;
  entry: TranscriptEntry;
  payload: Readonly<Record<string, unknown>>;
  children: ReactNode;
}

export interface PlayerUiSettings {
  version: 3;
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
  trackedTasks: Record<string, string>;
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
        : K extends `panel:${GamePanelId}` ? PanelSlotProps
          : K extends `bubble:${string}` ? BubbleSlotProps
            : K extends `message-card:${string}` ? MessageCardSlotProps
              : K extends `settings:${string}` ? SettingsSlotProps
                : never;

export interface SlotDef<K extends SlotId = SlotId> { component: ComponentType<SlotProps<K>> }

export interface ScriptUiContext {
  readonly apiVersion: typeof SCRIPT_UI_API_VERSION;
  register<K extends SlotId>(slot: K, def: SlotDef<K>): void;
  configureGame(presentation: GamePresentation): void;
}
