// Memory runtime: continuous-strength layered memories (major/minor/trivial)
// with relevance-ranked injection, access reinforcement and supersede
// semantics. Memory is engine-owned (invariant I3: the LLM/player text can
// never write memory directly — only engine effects do). Deterministic:
// no Math.random / wall-clock ids; same state + same input -> same output.
import type { MemoryEntry, WorldState, NpcState, PlayerState } from "./types";
import type { WorldDefinition } from "./types";

// ---------------------------------------------------------------------------
// Engine constants (not script-configurable; authors steer via importance/tags)
// ---------------------------------------------------------------------------

/** Initial strength per importance tier (0..1). */
export const INITIAL_STRENGTH: Record<MemoryEntry["importance"], number> = {
  major: 1.0,
  minor: 0.6,
  trivial: 0.3,
};
/** Strength below which a memory is archived (removed from injection). */
const FORGET_THRESHOLD = 0.05;
/** Strength boost applied when a memory is injected into the prompt. */
const ACCESS_BOOST = 0.15;
/** Score weight per relevance signal hit (tag matches npc/location/input). */
const RELEVANCE_WEIGHT = 0.5;
/** Relevance hits are capped so a single signal cannot dominate the score. */
const MAX_RELEVANCE_HITS = 3;

/** Tier retention days (run.yaml memory.tier_retention_days). */
export interface MemoryRetention {
  major: number;
  minor: number;
  trivial: number;
}

/** Creates a memory entry with a deterministic id (agile: no Math.random). */
export function createMemoryEntry(
  text: string,
  importance: MemoryEntry["importance"],
  day: number,
  tags: string[] = [],
  idPrefix = "mem",
): MemoryEntry {
  return {
    id: `${idPrefix}-${day}-${tags.length}`,
    text,
    importance,
    tags,
    createdAtDay: day,
    strength: INITIAL_STRENGTH[importance],
    lastAccessedDay: null,
    lastDecayDay: day,
    archived: false,
  };
}

/**
 * Applies the continuous decay policy. Each day a memory's strength is
 * multiplied by a tier factor calibrated so it reaches FORGET_THRESHOLD
 * exactly on its tier's retention day (archived on the following day
 * boundary — ±1 day fuzz, interpretable as "retained for N days").
 * major + majorKeep and retentionDays === 0 are permanent. Multi-day jumps
 * decay once per elapsed day (idempotent via lastDecayDay).
 */
export function applyMemoryDecay(
  memories: MemoryEntry[],
  currentDay: number,
  retention: MemoryRetention,
  majorKeep: boolean,
): MemoryEntry[] {
  return memories.map((m) => {
    if (m.archived) return m;
    const tierDays =
      m.importance === "major"
        ? retention.major
        : m.importance === "minor"
          ? retention.minor
          : retention.trivial;
    if (tierDays === 0 || (m.importance === "major" && majorKeep)) {
      // Permanent: no decay; keep lastDecayDay current for future policy.
      return { ...m, lastDecayDay: currentDay };
    }
    const factor = (FORGET_THRESHOLD / INITIAL_STRENGTH[m.importance]) ** (1 / tierDays);
    const daysElapsed = Math.max(0, currentDay - m.lastDecayDay);
    const strength = m.strength * factor ** daysElapsed;
    return {
      ...m,
      strength,
      lastDecayDay: currentDay,
      archived: strength < FORGET_THRESHOLD,
    };
  });
}

/** Applies memory decay to all actors (player + NPCs) using run.yaml policy. */
export function applyGlobalMemoryDecay(
  state: WorldState,
  definition: WorldDefinition,
): WorldState {
  const retention = definition.run.memory.tier_retention_days;
  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  const playerMemories = applyMemoryDecay(state.player.memories, day, retention, true);
  const npcs: Record<string, NpcState> = {};
  for (const [id, n] of Object.entries(state.npcs)) {
    const def = definition.npcs.get(id);
    npcs[id] = {
      ...n,
      memories: applyMemoryDecay(
        n.memories,
        day,
        retention,
        def?.memory?.forget_policy?.major_keep ?? true,
      ),
    };
  }
  return {
    ...state,
    player: { ...state.player, memories: playerMemories },
    npcs,
  };
}

/**
 * Boosts strength (capped at 1) and records the access day for each injected
 * memory id, across player and NPCs. Unknown ids are silently ignored —
 * idempotent and deterministic. Called after narrative generation with the
 * ids actually injected into the prompt.
 */
export function recordMemoryAccess(
  state: WorldState,
  definition: WorldDefinition,
  ids: string[],
): WorldState {
  if (ids.length === 0) return state;
  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  const idSet = new Set(ids);
  const boost = (m: MemoryEntry): MemoryEntry =>
    idSet.has(m.id)
      ? { ...m, strength: Math.min(1, m.strength + ACCESS_BOOST), lastAccessedDay: day }
      : m;
  const npcs: Record<string, NpcState> = {};
  for (const [id, n] of Object.entries(state.npcs)) {
    npcs[id] = { ...n, memories: n.memories.map(boost) };
  }
  return {
    ...state,
    player: { ...state.player, memories: state.player.memories.map(boost) },
    npcs,
  };
}

/** Returns active (non-archived) memories sorted newest-first. */
export function activeMemories(actor: PlayerState | NpcState): MemoryEntry[] {
  return [...actor.memories]
    .filter((m) => !m.archived)
    .sort((a, b) => b.createdAtDay - a.createdAtDay);
}

/** Context signals used for relevance scoring at injection time. */
export interface MemorySelectContext {
  /** Id of the NPC currently speaking (relevant for NPC memory). */
  npcId?: string;
  /** Player's current location id (relevant for location-bound memories). */
  locationId?: string;
  /** The player's latest free-text input (keyword/tag overlap). */
  playerInput?: string;
}

export interface MemorySelection {
  /** Ids of the selected memories (feed back into recordMemoryAccess). */
  ids: string[];
  /** Rendered injection text: one "[importance] text" line per entry. */
  text: string;
}

/**
 * Selects top-K active memories by score = strength + relevance bonus.
 * Relevance hits: a tag matching the speaking npc, the current location, or
 * a substring of the player input. Stable tie-break: createdAtDay desc then
 * id asc — deterministic for identical states.
 */
export function selectMemories(
  actor: PlayerState | NpcState,
  context: MemorySelectContext,
  limit = 8,
): MemorySelection {
  const scored = activeMemories(actor).map((m) => {
    const hits = m.tags.filter(
      (t) =>
        (context.npcId !== undefined && t === context.npcId) ||
        (context.locationId !== undefined && t === context.locationId) ||
        (context.playerInput !== undefined && context.playerInput.includes(t)),
    ).length;
    return {
      m,
      score: m.strength + RELEVANCE_WEIGHT * Math.min(hits, MAX_RELEVANCE_HITS),
    };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.m.createdAtDay - a.m.createdAtDay ||
      (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0),
  );
  const selected = scored.slice(0, limit).map((s) => s.m);
  return {
    ids: selected.map((m) => m.id),
    text: selected.map((m) => `[${m.importance}] ${m.text}`).join("\n"),
  };
}
