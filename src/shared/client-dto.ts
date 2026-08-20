/**
 * Browser-safe protocol shared by Route Handlers, GamePort implementations,
 * the player host, Storybook and tests. This module must never import engine,
 * filesystem or Next.js runtime code.
 */

export const CLIENT_API_VERSION = 3 as const;
export const SCRIPT_UI_API_VERSION = 3 as const;

export interface ThemeFontFile {
  file: string;
  weight: number;
  style: "normal" | "italic";
}

export interface ThemeFontFace {
  id: string;
  family: string;
  files: ThemeFontFile[];
}

export type SystemFontRole = "serif" | "sans" | "mono";
export type FontRole = SystemFontRole | string;

export interface ThemePalette {
  background: string;
  surface: string;
  surface_alt: string;
  primary: string;
  on_primary: string;
  accent: string;
  text: string;
  text_dim: string;
  border: string;
  focus: string;
  success: string;
  warning: string;
  danger: string;
  selected: string;
}

export interface ThemeTypography {
  font: SystemFontRole;
  scale: number;
  line_height: number;
  letter_spacing_em: number;
  faces: ThemeFontFace[];
  roles: { ui?: FontRole; narrative?: FontRole; mono?: FontRole };
}

export interface ThemeEffects {
  bubble_radius: number;
  chrome_radius: number;
  glass: number;
  blur_px: number;
  shadow: "none" | "soft" | "medium" | "hard";
  border_width_px: number;
  density: "compact" | "cozy" | "comfy";
  motion: "minimal" | "subtle" | "standard" | "playful";
  scene_tint: string;
  overlay_strength: number;
}

export interface ThemeView {
  id: string;
  name: string;
  palette: ThemePalette;
  typography: ThemeTypography;
  effects: ThemeEffects;
}

export interface AssetEntry {
  file?: string;
  prompt?: string;
  alt?: string;
  profile?: string;
}

export interface AssetManifest {
  cover?: AssetEntry;
  portraits: Record<string, AssetEntry>;
  backgrounds: Record<string, AssetEntry>;
  icons: Record<string, AssetEntry>;
  sprites: Record<string, AssetEntry>;
  voices: Record<string, AssetEntry>;
  ambient: Record<string, AssetEntry>;
  effects: Record<string, AssetEntry>;
  ui: Record<string, AssetEntry>;
}

export interface ScriptUiBundleDescriptor {
  apiVersion: typeof SCRIPT_UI_API_VERSION;
  dependencyHash: string;
  url: string;
}

export interface ScriptSummary {
  id: string;
  name: string;
  description: string;
  author: string;
  tone: string[];
  language: string;
  schemaVersion: string;
  source: { kind: "built-in" | "imported"; label: string };
  defaultThemeId: string;
  theme?: { id: string; name: string; palette: ThemePalette };
  cover?: AssetEntry;
  hasAssets: boolean;
  safety?: { age_rating: string; content_classes: string[] };
}

export interface OriginSummary {
  id: string;
  name: string;
  description: string;
  difficulty?: string;
}

export interface Catalog {
  locations: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    npcsPresent: string[];
    connections: Array<{ to: string; distance: number; travel_time: number }>;
  }>;
  items: Array<{ id: string; name: string; type: string; description: string }>;
  npcs: Array<{ id: string; name: string }>;
  events: Array<{ id: string; name: string }>;
  actions: Array<{ id: string; displayName: string }>;
  stats: Array<{ name: string; min: number; max: number; description?: string }>;
  skills: Array<{ name: string; min: number; max: number; description?: string }>;
  needs: Array<{ name: string }>;
  factions: Array<{ id: string; name: string }>;
  statusEffects: Array<{ id: string; name: string; description?: string }>;
  tasks: Array<{ id: string; name: string }>;
  origins: Array<{ id: string; name: string }>;
  currency: { name: string; symbol: string };
  hpStat: string;
}

export type MediaCue =
  | { kind: "npc_speech"; npcId: string }
  | { kind: "location_enter"; locationId: string }
  | { kind: "event"; eventId: string };

export interface TranscriptEntry {
  id: string;
  turn: number;
  role: "player" | "world" | "system";
  text: string;
  mediaCues: MediaCue[];
}

export interface RelationStateView {
  npcId: string;
  value: number;
  stance: string;
  type: string;
  description?: string;
  descriptor?: { label: string; description: string };
}

export interface ItemStackView {
  itemId: string;
  quantity: number;
}

export interface WorldStateView {
  scriptId: string;
  clock: {
    totalHours: number;
    day: number;
    month: number;
    year: number;
    hour: number;
    weekday: number;
    weather: string;
    season: string;
  };
  player: {
    originId: string;
    name: string;
    stats: Record<string, number>;
    skills: Record<string, number>;
    needs: Record<string, { value: number; descriptor?: { label: string; description: string } }>;
    inventory: { stacks: ItemStackView[]; currency: number };
    locationId: string;
    flags: string[];
    threatGauge: number;
    statuses: Array<{
      statusId: string;
      remainingTicks: number | null;
      stacks: number;
      descriptor?: { label: string; description: string };
    }>;
    memories: Array<{
      id: string;
      text: string;
      importance: string;
      tags: string[];
      strength: number;
      lastAccessedDay: number | null;
      archived: boolean;
    }>;
    relations: RelationStateView[];
    reputation: Array<{
      factionId: string;
      value: number;
      descriptor?: { label: string; description: string };
    }>;
  };
  npcs: Record<string, {
    id: string;
    stats: Record<string, number>;
    skills: Record<string, number>;
    needs: Record<string, { value: number; descriptor?: { label: string; description: string } }>;
    currentLocationId: string;
    relations: RelationStateView[];
    reputation: Array<{ factionId: string; value: number; descriptor?: { label: string; description: string } }>;
    statuses: Array<{
      statusId: string;
      remainingTicks: number | null;
      stacks: number;
      descriptor?: { label: string; description: string };
    }>;
  }>;
  flags: string[];
  facts: string[];
  eventLog: Array<{ id: string; day: number; hour: number; type: string; actor: string; summary: string }>;
  commitments: Array<{ commitmentId: string; triggered: boolean; deadlineMissed: boolean }>;
  tasks: Array<
    | { taskId: string; status: "active"; acceptedDay: number; acceptedEventCount: number; progress: number }
    | { taskId: string; status: "complete"; acceptedDay: number; completedDay: number }
    | { taskId: string; status: "failed"; acceptedDay: number; failedDay: number }
  >;
  playedEventIds: string[];
  secretHolders: Record<string, string>;
  locationInventories: Record<string, { stacks: ItemStackView[]; currency: number }>;
  transcript: TranscriptEntry[];
  runtimeState: Readonly<Record<string, unknown>>;
}

export interface IntentHint {
  actionId: string;
  target?: string;
  params?: Readonly<Record<string, string | number | boolean>>;
}

export interface TurnInput {
  text: string;
  intentHint?: IntentHint;
}

export interface ActionPreview {
  actionId: string;
  displayName: string;
  executable: boolean;
  reasonCode?: string;
  reason?: string;
  timeCost: number;
  costs: {
    currency: number;
    items: Array<{ itemId: string; quantity: number }>;
    resources?: Array<{
      kind: "need" | "stat" | "skill" | "runtime";
      id: string;
      amount: number;
    }>;
  };
  risk: { type: "none" | "stat" | "skill" | "opposed"; key?: string; dc?: number };
}

export interface TurnResultView {
  narrative: string;
  resolution?: {
    actionId: string;
    target?: string;
    resolveType: string;
    roll: number | null;
    dc: number | null;
    grade: "fail" | "partial" | "success" | "crit";
    effectsApplied: string[];
  };
  logEntries: WorldStateView["eventLog"];
  descriptorUpdates: Array<{ path: string }>;
  rejection?: { reason: string; narrative: string };
  fellBackToTalk: boolean;
  deathFired?: string;
  worldEvents: string[];
  taskCompletions: Array<{ taskId: string; status: "complete" | "fail"; narrative: string }>;
  mediaCues: MediaCue[];
}

export interface SessionPresentation {
  themes: ThemeView[];
  currentTheme: ThemeView;
  defaultThemeId: string;
  uiBundle?: ScriptUiBundleDescriptor;
  hasAssets: boolean;
}

export interface CreateSessionResult {
  id: string;
  state: WorldStateView;
  presentation: SessionPresentation;
}

export interface TurnResultFull extends TurnResultView {
  state: WorldStateView;
  presentation: SessionPresentation;
}

export interface SaveSummary {
  runId: string;
  updatedAt: string;
}

export interface ScriptDetail {
  scriptId: string;
  presentation: {
    themes: ThemeView[];
    defaultThemeId: string;
    uiBundle?: ScriptUiBundleDescriptor;
    assets: boolean;
  };
  origins: OriginSummary[];
  catalog: Catalog;
  assets: AssetManifest;
  saves: SaveSummary[];
  safety: { age_rating: string; content_classes: string[] };
}

export interface ScriptMeta {
  scriptId: string;
  unlockedOrigins: string[];
  lockableOrigins: string[];
  updatedAt: string | null;
}

export interface ImportRisk {
  code: "engine-code" | "ui-code" | "replace";
  label: string;
  detail: string;
}

export interface ImportPreview {
  token: string;
  scriptId: string;
  name: string;
  sourceName: string;
  schemaVersion: string | null;
  apiVersions: { hostUi: typeof SCRIPT_UI_API_VERSION; engine: number | null; scriptUi: number | null };
  cover?: AssetEntry;
  coverUrl?: string;
  conflicts: { installed: boolean; replaceAllowed: boolean };
  permissions: Array<"engine" | "ui" | "assets">;
  assetProvenance: {
    manifestPresent: boolean;
    coveredFiles: number;
    totalFiles: number;
    missingFiles: string[];
    extraFiles: string[];
    remoteReferences: string[];
  };
  risks: ImportRisk[];
  errors: string[];
  warnings: string[];
}

export interface ImportCommitResult {
  scriptId: string;
  warnings: string[];
}
