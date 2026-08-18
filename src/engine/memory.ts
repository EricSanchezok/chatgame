// Memory runtime: layered memories (major/minor/trivial) with retention
// days and archiving. Memory is engine-owned (invariant I3: the LLM/player
// text can never write memory directly — only engine effects do).
import type { MemoryEntry, WorldState, NpcState, PlayerState } from "./types";
import type { WorldDefinition } from "./types";

/** Creates a memory entry with a stable id. */
export function createMemoryEntry(
  text: string,
  importance: MemoryEntry["importance"],
  day: number,
  tags: string[] = [],
  idPrefix = "mem",
): MemoryEntry {
  return {
    id: `${idPrefix}-${day}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    importance,
    tags,
    createdAtDay: day,
    archived: false,
  };
}

/**
 * Applies the forget policy: archives memories older than their tier's
 * retention days (major = permanent when major_keep is true). Uses the
 * run.yaml memory.tier_retention_days and the NPC's forget_policy.
 */
export function applyForgetting(
  memories: MemoryEntry[],
  currentDay: number,
  retention: { major: number; minor: number; trivial: number },
  majorKeep: boolean,
): MemoryEntry[] {
  return memories.map((m) => {
    if (m.archived) return m;
    const age = currentDay - m.createdAtDay;
    const limit =
      m.importance === "major" ? (majorKeep ? Infinity : retention.major) :
      m.importance === "minor" ? retention.minor :
      retention.trivial;
    return age > limit ? { ...m, archived: true } : m;
  });
}

/** Applies forgetting to all actors (player + NPCs) using run.yaml policy. */
export function applyGlobalForgetting(state: WorldState, definition: WorldDefinition): WorldState {
  const retention = definition.run.memory.tier_retention_days;
  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  const playerMemories = applyForgetting(
    state.player.memories,
    day,
    retention,
    true,
  );
  const npcs: Record<string, NpcState> = {};
  for (const [id, n] of Object.entries(state.npcs)) {
    const def = definition.npcs.get(id);
    npcs[id] = {
      ...n,
      memories: applyForgetting(
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

/** Adds a memory to an actor's list (player or npc), respecting order. */
export function addMemory(
  actor: PlayerState | NpcState,
  entry: MemoryEntry,
): PlayerState | NpcState {
  return { ...actor, memories: [...actor.memories, entry] };
}

/** Returns active (non-archived) memories sorted newest-first. */
export function activeMemories(actor: PlayerState | NpcState): MemoryEntry[] {
  return [...actor.memories]
    .filter((m) => !m.archived)
    .sort((a, b) => b.createdAtDay - a.createdAtDay);
}

/** Returns memories matching any tag. */
export function memoriesByTag(actor: PlayerState | NpcState, tag: string): MemoryEntry[] {
  return activeMemories(actor).filter((m) => m.tags.includes(tag));
}

/**
 * Summarizes recent major memories for context injection (deterministic
 * proxy for LLM summarization in v1 — archiving + truncation only).
 */
export function summarizeForInjection(actor: PlayerState | NpcState, limit = 8): string {
  return activeMemories(actor)
    .slice(0, limit)
    .map((m) => `[${m.importance}] ${m.text}`)
    .join("\n");
}
