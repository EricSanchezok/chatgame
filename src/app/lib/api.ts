// Typed fetch client — the single HTTP entry point for the UI. Every call
// returns the parsed body or throws {status, message} on non-2xx.

import type { ThemeView } from "./theme";

export interface ScriptSummary {
  id: string;
  name: string;
  description: string;
  author: string;
  tone: string[];
  language: string;
  theme?: { id: string; name: string; palette: ThemeView["palette"] };
  hasAssets: boolean;
  /** Content rating surface (present when the script ships safety.yaml). */
  safety?: { age_rating: string; content_classes: string[] };
}

export interface OriginSummary {
  id: string;
  name: string;
  description: string;
  difficulty?: string;
}

export interface AssetEntry {
  file?: string;
  prompt?: string;
  alt?: string;
  profile?: string;
}

export interface AssetManifest {
  portraits: Record<string, AssetEntry>;
  backgrounds: Record<string, AssetEntry>;
  icons: Record<string, AssetEntry>;
  sprites: Record<string, AssetEntry>;
  voices: Record<string, AssetEntry>;
  ambient: Record<string, AssetEntry>;
  effects: Record<string, AssetEntry>;
  ui: Record<string, AssetEntry>;
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
  needs: Array<{ name: string }>;
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

export interface RelationState {
  npcId: string;
  value: number;
  stance: string;
  type: string;
  /** Author's static description from the script (survives worldgen). */
  description?: string;
  descriptor?: { label: string; description: string };
}

export interface ItemStack {
  itemId: string;
  quantity: number;
}

export interface WorldState {
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
    inventory: { stacks: ItemStack[]; currency: number };
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
    relations: RelationState[];
    reputation: Array<{
      factionId: string;
      value: number;
      descriptor?: { label: string; description: string };
    }>;
  };
  npcs: Record<
    string,
    {
      id: string;
      stats: Record<string, number>;
      skills: Record<string, number>;
      currentLocationId: string;
      relations: RelationState[];
      statuses: Array<{
        statusId: string;
        remainingTicks: number | null;
        stacks: number;
        descriptor?: { label: string; description: string };
      }>;
    }
  >;
  flags: string[];
  facts: string[];
  eventLog: Array<{ id: string; day: number; hour: number; type: string; actor: string; summary: string }>;
  commitments: Array<{ commitmentId: string; triggered: boolean; deadlineMissed: boolean }>;
  tasks: Array<
    | { taskId: string; status: "active"; acceptedDay: number; progress: number }
    | { taskId: string; status: "complete"; acceptedDay: number; completedDay: number }
    | { taskId: string; status: "failed"; acceptedDay: number; failedDay: number }
  >;
  playedEventIds: string[];
  secretHolders: Record<string, string>;
  locationInventories: Record<string, { stacks: ItemStack[]; currency: number }>;
  transcript: TranscriptEntry[];
}

export interface TurnResult {
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
  logEntries: WorldState["eventLog"];
  descriptorUpdates: Array<{ path: string }>;
  fellBackToTalk: boolean;
  deathFired?: string;
  worldEvents: string[];
  taskCompletions: Array<{ taskId: string; status: "complete" | "fail"; narrative: string }>;
  mediaCues: MediaCue[];
}

export interface SessionPresentation {
  themes: ThemeView[];
  currentTheme: ThemeView;
  hasAssets: boolean;
}

export interface CreateSessionResult {
  id: string;
  state: WorldState;
  presentation: SessionPresentation;
}

export interface TurnResultFull extends TurnResult {
  state: WorldState;
  presentation: SessionPresentation;
}

export interface SaveSummary {
  runId: string;
  updatedAt: string;
}

export interface ScriptDetail {
  scriptId: string;
  presentation: { themes: ThemeView[]; assets: boolean };
  origins: OriginSummary[];
  catalog: Catalog;
  assets: AssetManifest;
  saves: SaveSummary[];
  safety: { age_rating: string; content_classes: string[] };
}

export interface ScriptMeta {
  scriptId: string;
  /** Origin ids unlocked by meta-progression (union across runs). */
  unlockedOrigins: string[];
  /** Origin ids that can be unlocked (run.yaml unlocks[].grant). */
  lockableOrigins: string[];
  updatedAt: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body: keep the status text.
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  listScripts: () => request<{ scripts: ScriptSummary[] }>("/api/scripts"),
  scriptDetail: (scriptId: string) =>
    request<ScriptDetail>(`/api/scripts/${encodeURIComponent(scriptId)}`),
  scriptMeta: (scriptId: string) =>
    request<ScriptMeta>(`/api/scripts/${encodeURIComponent(scriptId)}/meta`),
  importScript: (file: File, replace: boolean) => {
    const form = new FormData();
    form.set("file", file);
    form.set("replace", String(replace));
    return fetch("/api/scripts", { method: "POST", body: form }).then(async (res) => {
      const body = (await res.json()) as { error?: string; scriptId?: string; warnings?: string[] };
      if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
      return body as { scriptId: string; warnings: string[] };
    });
  },
  createSession: (body: {
    scriptId: string;
    originId?: string;
    seed?: number;
    playerName?: string;
    loadRunId?: string;
  }) => post<CreateSessionResult>("/api/sessions", body),
  turn: (id: string, input: string) =>
    post<TurnResultFull>(`/api/sessions/${encodeURIComponent(id)}/turn`, { input }),
  state: (id: string) =>
    request<{ id: string; state: WorldState; presentation: SessionPresentation }>(
      `/api/sessions/${encodeURIComponent(id)}/state`,
    ),
  save: (id: string) =>
    post<{ saved: boolean; path: string }>(`/api/sessions/${encodeURIComponent(id)}/save`, {}),
  /** User edit to a descriptor (explanation layer only; never touches values). */
  setDescriptor: (id: string, path: string, text: string) =>
    post<{ state: WorldState }>(`/api/sessions/${encodeURIComponent(id)}/descriptor`, { path, text }),
  advance: (id: string, hours: number) =>
    post<{ state: WorldState }>(`/api/sessions/${encodeURIComponent(id)}/advance`, { hours }),
  destroySession: (id: string) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    }),
  /** Raw asset file URL (manifest `file` paths start with `assets/`). */
  fileAsset: (scriptId: string, file: string) =>
    `/api/scripts/${encodeURIComponent(scriptId)}/assets/${file.replace(/^assets\//, "")}`,
  /** Prompt-generated entity asset (mock/off provider; 404 when unavailable). */
  entityAsset: (scriptId: string, kind: string, entityId: string) =>
    `/api/scripts/${encodeURIComponent(scriptId)}/entity-assets/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}`,
};
