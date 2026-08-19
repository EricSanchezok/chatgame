// Engine runtime types. Every mutable game state lives here as immutable
// snapshots (pure updates produce new objects; the event log is append-only).
// Dual-track state (numeric value + deterministic label + LLM descriptor)
// is modelled per the three-layer separation: computation (values, engine),
import type { Actions } from "../script/schemas/actions";
import type { Director } from "../script/schemas/director";
import type { Event } from "../script/schemas/event";
import type { Faction } from "../script/schemas/faction";
import type { Item } from "../script/schemas/item";
import type { Location } from "../script/schemas/location";
import type { Mechanics } from "../script/schemas/mechanics";
import type { Npc } from "../script/schemas/npc";
import type {
  Opening,
  Style,
  LoreEntry,
  ExampleDialogue,
  EventText,
} from "../script/schemas/narrative";
import type { Origin } from "../script/schemas/origin";
import type { Plot } from "../script/schemas/plot";
import type { Run } from "../script/schemas/run";
import type { Safety } from "../script/schemas/safety";
import type { Script } from "../script/schemas/script";
import type { Task } from "../script/schemas/task";
import type { Time } from "../script/schemas/time";
import type { World } from "../script/schemas/world";
import type { Worldgen } from "../script/schemas/worldgen";
import type { Theme } from "../script/schemas/theme";
import type { AssetsManifest } from "../script/schemas/assets";

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/** Serializable RNG state (mulberry32). Stored in saves so runs continue. */
export interface RngState {
  seed: number;
  state: number;
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** Engine-managed game clock. All time flows through GameClock, never Date. */
export interface GameClock {
  /** Total elapsed hours since world start (canonical time source). */
  totalHours: number;
  /** 1-based day of month. */
  day: number;
  /** 1-based month. */
  month: number;
  /** 1-based year. */
  year: number;
  /** 0-23 hour of day. */
  hour: number;
  /** 0-based index into time.calendar.weekdays. */
  weekday: number;
  /** Current weather label (from worldgen/season tables). */
  weather: string;
  /** Current season label. */
  season: string;
}

// ---------------------------------------------------------------------------
// Values / inventory / needs
// ---------------------------------------------------------------------------

export type StatMap = Record<string, number>;
export type SkillMap = Record<string, number>;
export type NeedMap = Record<string, number>;

export interface ItemStack {
  itemId: string;
  quantity: number;
}

export interface InventoryState {
  stacks: ItemStack[];
  currency: number;
}

// ---------------------------------------------------------------------------
// Descriptor (dual-track state explanation layer)
// ---------------------------------------------------------------------------

/**
 * The explanation layer of dual-track state. `label` is deterministic
 * (value -> classification), `description` is LLM-generated prose (<=300
 * chars). Descriptors NEVER participate in resolution — values are the only
 * fact source. When stale, the engine lazily regenerates on next read.
 */
export interface Descriptor {
  /** Deterministic classification label (e.g. "friendly", "恋人"). */
  label: string;
  /** LLM-generated prose (<=300 chars). Empty until first generation. */
  description: string;
  /** Incremented on every regeneration (for caching/audit). */
  version: number;
  /** True when the underlying value/events changed; triggers lazy refresh. */
  stale: boolean;
  /** Event-log ids that informed the current description (auditable). */
  sourceEventIds: string[];
  /** Set when the player/author overrode the description manually. */
  userEdited: boolean;
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  text: string;
  importance: "major" | "minor" | "trivial";
  tags: string[];
  /** Absolute day (clock.totalHours / dayLength) at creation. */
  createdAtDay: number;
  /** 0..1 continuous strength: tier-initial, decays daily, boosted on access. */
  strength: number;
  /** Absolute day of the last injection; null when never injected. */
  lastAccessedDay: number | null;
  /** Absolute day of the last decay application (multi-day jumps decay once per day). */
  lastDecayDay: number;
  /** True when strength fell below threshold or superseded; injection filter. */
  archived: boolean;
  /** Id of the memory that superseded this one (audit trail). */
  supersededBy?: string;
}

// ---------------------------------------------------------------------------
// Relations (bidirectional matrix, asymmetric values allowed)
// ---------------------------------------------------------------------------

export interface RelationState {
  /** Target npc id (relations on an NPC point to other NPCs). */
  npcId: string;
  /** -100..100 numeric strength (engine-owned fact source). */
  value: number;
  /** Deterministic stance derived from value (classification layer). */
  stance: string;
  /** Relationship type (from script definition when present). */
  type: string;
  descriptor?: Descriptor;
}

export interface ReputationState {
  factionId: string;
  value: number;
  descriptor?: Descriptor;
}

// ---------------------------------------------------------------------------
// Status effects
// ---------------------------------------------------------------------------

export interface StatusInstance {
  statusId: string;
  /** Remaining ticks; null = permanent. */
  remainingTicks: number | null;
  stacks: number;
  descriptor?: Descriptor;
}

// ---------------------------------------------------------------------------
// Needs (with dual-track descriptors)
// ---------------------------------------------------------------------------

export interface NeedState {
  value: number;
  descriptor?: Descriptor;
}

// ---------------------------------------------------------------------------
// NPC / player runtime state
// ---------------------------------------------------------------------------

export interface NpcState {
  id: string;
  stats: StatMap;
  skills: SkillMap;
  needs: Record<string, NeedState>;
  inventory: InventoryState;
  /** Relations to other NPCs (asymmetric values allowed). */
  relations: RelationState[];
  memories: MemoryEntry[];
  knowledgeFlags: string[];
  /** Secret ids already revealed to the player. */
  revealedSecrets: string[];
  currentLocationId: string;
  statuses: StatusInstance[];
  reputation: ReputationState[];
}

export interface PlayerState {
  originId: string;
  name: string;
  stats: StatMap;
  skills: SkillMap;
  needs: Record<string, NeedState>;
  inventory: InventoryState;
  locationId: string;
  flags: string[];
  threatGauge: number;
  statuses: StatusInstance[];
  memories: MemoryEntry[];
  /** Relations from player to NPCs. */
  relations: RelationState[];
  reputation: ReputationState[];
}

// ---------------------------------------------------------------------------
// Commitment / director / task runtime state
// ---------------------------------------------------------------------------

export interface CommitmentState {
  commitmentId: string;
  triggered: boolean;
  deadlineMissed: boolean;
  triggeredAtDay?: number;
}

export interface DirectorState {
  /** Absolute day of the last director-selected event. */
  lastEventDay: number | null;
  /** Live tension variable values keyed by director.yaml name. */
  tension: Record<string, number>;
}

export type TaskInstanceState =
  | { taskId: string; status: "active"; acceptedDay: number; progress: number }
  | { taskId: string; status: "complete"; acceptedDay: number; completedDay: number }
  | { taskId: string; status: "failed"; acceptedDay: number; failedDay: number };

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export type EventLogType =
  | "action"
  | "resolution"
  | "commitment"
  | "director"
  | "world"
  | "system";

export interface EventLogEntry {
  id: string;
  /** Absolute day. */
  day: number;
  hour: number;
  type: EventLogType;
  /** "player" or npc id or system. */
  actor: string;
  summary: string;
  detail?: unknown;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ResultGrade = "fail" | "partial" | "success" | "crit";

export interface ResolutionLogEntry {
  actionId: string;
  target?: string;
  resolveType: "stat_check" | "skill_check" | "opposed_check" | "auto" | "narrative_only";
  roll: number | null;
  dc: number | null;
  grade: ResultGrade;
  /** Short human-readable effect summary (auditable). */
  effectsApplied: string[];
}

export interface TaskCompletion {
  taskId: string;
  status: "complete" | "fail";
  /** Narrative text for the completion/failure (from task.narrative). */
  narrative: string;
}

// ---------------------------------------------------------------------------
// Turn result
// ---------------------------------------------------------------------------

export interface DescriptorUpdate {
  /** Stable path like "player.needs.hunger" or "npcs.elara.relations.kade". */
  path: string;
  descriptor: Descriptor;
}

export interface RejectionInfo {
  reason: string;
  narrative: string;
}

export interface TurnResult {
  /** Full narrative text presented to the player. */
  narrative: string;
  /** Engine resolution log for the turn (if an action was resolved). */
  resolution?: ResolutionLogEntry;
  /** New event-log entries appended this turn. */
  logEntries: EventLogEntry[];
  /** Descriptors refreshed this turn (lazy regeneration). */
  descriptorUpdates: DescriptorUpdate[];
  /** Set when the intent was rejected (narrativized refusal). */
  rejection?: RejectionInfo;
  /** True when the intent fell back to the default talk action. */
  fellBackToTalk: boolean;
  /** Death policy consequence fired this turn (if any). */
  deathFired?: string;
  /** World events (festivals/ambient/scheduled) played this turn. */
  worldEvents: string[];
  /** Task completions/failures detected this turn. */
  taskCompletions: TaskCompletion[];
  /** Deterministic media cues derived from this turn (frontend cards/audio). */
  mediaCues: MediaCue[];
 }

// ---------------------------------------------------------------------------
// Transcript (complete conversation history, persisted in saves)
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  id: string;
  /** 1-based turn index within the session. */
  turn: number;
  role: "player" | "world" | "system";
  text: string;
  /** Media cues attached to this entry (rendered as inline cards). */
  mediaCues: MediaCue[];
}

// ---------------------------------------------------------------------------
// Media cues (engine-derived, never LLM-decided)
// ---------------------------------------------------------------------------

export type MediaCue =
  | { kind: "npc_speech"; npcId: string }
  | { kind: "location_enter"; locationId: string }
  | { kind: "event"; eventId: string };
// World state (the full immutable snapshot)
// ---------------------------------------------------------------------------

export interface WorldState {
  scriptId: string;
  clock: GameClock;
  player: PlayerState;
  npcs: Record<string, NpcState>;
  /** World-level flags (e.g. "mine-secret-leaked"). */
  flags: string[];
  /** Runtime facts observed via events (source: fact conditions). */
  facts: string[];
  eventLog: EventLogEntry[];
  commitments: CommitmentState[];
  director: DirectorState;
  rng: RngState;
  tasks: TaskInstanceState[];
  /** Event ids already played (single source of novelty truth). */
  playedEventIds: string[];
  /** Absolute day each event was last played (cooldown truth). */
  eventLastPlayedDay: Record<string, number>;
  /** Runtime secret holder mapping (secretId -> npcId). */
  secretHolders: Record<string, string>;
  /** Per-location inventories (take/trade sources). */
  locationInventories: Record<string, InventoryState>;
  /** Complete conversation history (persisted with saves). */
  transcript: TranscriptEntry[];
 }

// ---------------------------------------------------------------------------
// World definition (immutable script-derived blueprint)
// ---------------------------------------------------------------------------

export interface NarrativeAssets {
  opening: Opening;
  style: Style;
  lore: LoreEntry[];
  examples: ExampleDialogue[];
  eventTexts: EventText[];
}

/** Fully validated, indexed script — the immutable definition. */
export interface WorldDefinition {
  script: Script;
  world: World;
  time: Time;
  mechanics: Mechanics;
  actions: Actions;
  plot: Plot;
  director: Director;
  worldgen: Worldgen;
  run: Run;
  safety: Safety;
  origins: Map<string, Origin>;
  npcs: Map<string, Npc>;
  locations: Map<string, Location>;
  items: Map<string, Item>;
  factions: Map<string, Faction>;
  events: Map<string, Event>;
  tasks: Map<string, Task>;
  narrative: NarrativeAssets;
  /** Script themes (theme.yaml default + themes/*). Key = theme id. */
  themes: Map<string, Theme>;
  /** Presentation asset index (undefined when the script has no assets.yaml). */
  assets?: AssetsManifest;
  /** Directory the script was loaded from (for save paths). */
  sourceDir: string;
 }

// ---------------------------------------------------------------------------
// Save file
// ---------------------------------------------------------------------------

export interface SaveFile {
  saveSchemaVersion: number;
  scriptId: string;
  createdAt: string;
  updatedAt: string;
  worldState: WorldState;
}

// ---------------------------------------------------------------------------
// Session / engine options
// ---------------------------------------------------------------------------

export interface SessionOptions {
  scriptDir: string;
  originId: string;
  /** Fixed seed for deterministic runs (default: time-based). */
  seed?: number;
  /** Player display name (default: origin name). */
  playerName?: string;
}
