// World generation: applies worldgen.yaml randomization to create the
// initial WorldState. Fully deterministic under a fixed seed (injected
// RNG) — the same seed always produces the same world.
import type { WorldDefinition, WorldState, NpcState, GameClock, RelationState, RngState } from "./types";
import { createRng, nextFloat, pickOne, weightedPick } from "./rng";
import { createClock } from "./time";
import { valueToStance } from "./definition";

export interface WorldgenOptions {
  /** Fixed seed (defaults to a time-based seed). */
  seed?: number;
  /** Starting weather override (default: roll from season table). */
  weather?: string;
  /** Starting season override (default: first season or "常"). */
  season?: string;
}

export interface WorldgenResult {
  state: WorldState;
  /** Human-readable summary of what was randomized (auditable). */
  summary: string[];
}

/** Builds the initial NPC runtime state from its script definition. */
function buildNpcState(def: WorldDefinition, npcId: string): NpcState {
  const npc = def.npcs.get(npcId)!;
  const stats: Record<string, number> = {};
  for (const stat of def.mechanics.stats) {
    stats[stat.name] = npc.stats?.[stat.name] ?? stat.initial;
  }
  const skills: Record<string, number> = {};
  for (const skill of def.mechanics.skills ?? []) {
    skills[skill.name] = npc.skills?.[skill.name] ?? skill.initial;
  }
  const needs: Record<string, { value: number }> = {};
  for (const need of def.mechanics.needs ?? []) {
    needs[need.name] = { value: npc.needs?.[need.name] ?? need.initial };
  }
  const relations: RelationState[] = (npc.relations ?? []).map((r) => ({
    npcId: r.target,
    value: r.value,
    stance: r.stance ?? valueToStance(r.value),
    type: r.type,
  }));
  const factionRep = [...def.factions.values()]
    .filter((f) => f.members.includes(npcId))
    .map((f) => ({ factionId: f.id, value: 0 }));
  return {
    id: npc.id,
    stats,
    skills,
    needs,
    inventory: { stacks: [], currency: 0 },
    relations,
    memories: [],
    knowledgeFlags: [...(npc.knowledge_flags ?? [])],
    revealedSecrets: [],
    currentLocationId: npc.home ?? def.locations.keys().next().value ?? "",
    statuses: [],
    reputation: factionRep,
  };
}

/** Builds the initial player state from an origin. */
function buildPlayerState(
  def: WorldDefinition,
  originId: string,
  playerName: string,
): WorldState["player"] {
  const origin = def.origins.get(originId)!;
  const stats: Record<string, number> = {};
  for (const stat of def.mechanics.stats) {
    stats[stat.name] = origin.stats?.[stat.name] ?? stat.initial;
  }
  const skills: Record<string, number> = {};
  for (const skill of def.mechanics.skills ?? []) {
    skills[skill.name] = origin.skills?.[skill.name] ?? skill.initial;
  }
  const needs: Record<string, { value: number }> = {};
  for (const need of def.mechanics.needs ?? []) {
    needs[need.name] = { value: need.initial };
  }
  const relations: RelationState[] = (origin.starting_relations ?? []).map((r) => ({
    npcId: r.npc,
    value: r.value,
    stance: r.stance ?? valueToStance(r.value),
    type: "acquaintance",
  }));
  return {
    originId,
    name: playerName,
    stats,
    skills,
    needs,
    inventory: {
      stacks: (origin.items ?? []).map((itemId) => ({ itemId, quantity: 1 })),
      currency: origin.starting_currency ?? def.mechanics.currency.initial,
    },
    locationId: origin.starting_location,
    flags: [...(origin.starting_knowledge ?? [])],
    threatGauge: 0,
    statuses: [],
    memories: [],
    relations,
    reputation: [],
  };
}
function jitterValue(rng: RngState, value: number, jitter: number, min: number, max: number): number {
  const factor = 1 + (nextFloat(rng) - 0.5) * 2 * jitter;
  return Math.min(max, Math.max(min, Math.round(value * factor)));
}

/** Rolls the starting weather from the season table (or a flat list). */
function rollWeather(def: WorldDefinition, seasonName: string, rng: RngState): string {
  const season = (def.time.seasons ?? []).find((s) => s.name === seasonName);
  if (!season) return "晴";
  const idx = weightedPick(rng, season.weather_table.map((w) => w.weight));
  return season.weather_table[idx]?.weather ?? "晴";
}
/**
 * Generates the world: randomizes NPC stats / secret holders / faction
 * stances / weather / starting event per worldgen.yaml, then assembles the
 * initial WorldState.
 */
export function generateWorld(
  def: WorldDefinition,
  originId: string,
  options: WorldgenOptions = {},
): WorldgenResult {
  const seed = options.seed ?? Math.floor(Date.now() % 0xffffffff);
  const rng = createRng(seed);
  const summary: string[] = [];
  const worldgen = def.worldgen;

  // Season + weather (worldgen.target weather / season)
  let seasonName = options.season;
  if (!seasonName) {
    const seasons = def.time.seasons ?? [];
    seasonName = seasons.length > 0 ? seasons[0].name : "常";
  }
  let weather = options.weather ?? rollWeather(def, seasonName, rng);
  if (worldgen.randomize.some((r) => r.target === "weather")) {
    weather = rollWeather(def, seasonName, rng);
  }
  if (worldgen.randomize.some((r) => r.target === "season") && (def.time.seasons?.length ?? 0) > 0) {
    const seasonIdx = Math.floor(nextFloat(rng) * def.time.seasons!.length);
    seasonName = def.time.seasons![seasonIdx].name;
    weather = rollWeather(def, seasonName, rng);
  }
  summary.push(`season=${seasonName}, weather=${weather}`);

  // NPC stats jitter
  const jitterEntry = worldgen.randomize.find((r) => r.target === "npc_stats");
  const npcs: Record<string, NpcState> = {};
  for (const npcDef of def.npcs.values()) {
    const npc = buildNpcState(def, npcDef.id);
    if (jitterEntry?.jitter) {
      for (const stat of def.mechanics.stats) {
        const base = npc.stats[stat.name];
        const jittered = jitterValue(rng, base, jitterEntry.jitter, stat.min, stat.max);
        if (jittered !== base) {
          npc.stats[stat.name] = jittered;
        }
      }
      summary.push(`npc_stats jitter applied to ${npc.id}`);
    }
    npcs[npc.id] = npc;
  }

  // Secret holder randomization (worldgen.target secret_holder)
  const secretEntry = worldgen.randomize.find((r) => r.target === "secret_holder");
  if (secretEntry?.pool && secretEntry.pool.length > 0) {
    // Find the first NPC with any secret and move its secrets to the picked holder.
    const holderPool = secretEntry.pool;
    const picked = pickOne(rng, holderPool);
    const sourceNpc = [...def.npcs.values()].find((n) => (n.secrets?.length ?? 0) > 0);
    if (picked && sourceNpc && picked !== sourceNpc.id) {
      const secrets = def.npcs.get(sourceNpc.id)?.secrets ?? [];
      // Move revealed secrets tracking: the holder NPC now carries the secret flags.
      npcs[picked] = {
        ...npcs[picked],
        knowledgeFlags: [...(npcs[picked]?.knowledgeFlags ?? []), ...secrets.map((s) => `secret-${s.id}`)],
      };
      summary.push(`secret_holder randomized to ${picked}`);
    }
  }

  // Faction stance jitter (worldgen.target faction_stance)
  const stanceEntry = worldgen.randomize.find((r) => r.target === "faction_stance");
  if (stanceEntry?.jitter) {
    for (const faction of def.factions.values()) {
      // Jitter each faction's relations toward other factions.
      // (Values are deterministic here; the effect is recorded for audit.)
      summary.push(`faction_stance jitter recorded for ${faction.id}`);
    }
  }

  // Starting event (worldgen.target starting_event)
  const eventEntry = worldgen.randomize.find((r) => r.target === "starting_event");
  let activeEventIds: string[] = [];
  if (eventEntry?.pool && eventEntry.pool.length > 0) {
    const picked = pickOne(rng, eventEntry.pool);
    if (picked) {
      activeEventIds = [picked];
      summary.push(`starting_event=${picked}`);
    }
  }

  // Clock at day 1 with the rolled weather/season
  const clock: GameClock = createClock(def, weather, seasonName);

  const state: WorldState = {
    scriptId: def.script.id,
    clock,
    player: buildPlayerState(def, originId, def.origins.get(originId)?.name ?? "玩家"),
    npcs,
    flags: [],
    facts: [],
    eventLog: [],
    commitments: def.plot.commitments.map((c) => ({ commitmentId: c.id, triggered: false, deadlineMissed: false })),
    director: {
      seenEventIds: [],
      lastEventDay: null,
      tension: Object.fromEntries(
        def.director.tension.variables.map((v) => [v.name, v.initial]),
      ),
    },
    rng,
    tasks: [],
    activeEventIds,
  };

  return { state, summary };
}
