// World generation: applies worldgen.yaml randomization to create the
// initial WorldState. Fully deterministic under a fixed seed (injected
// RNG) — the same seed always produces the same world.
import type { WorldDefinition, WorldState, NpcState, GameClock, RelationState, RngState } from "./types";
import { createRng, nextFloat, pickOne, weightedPick } from "./rng";
import { createClock } from "./time";
import { valueToStance } from "./definition";
import { createMemoryEntry } from "./memory";

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
  /** Event id selected for the opening (worldgen.target starting_event). */
  startingEvent?: string;
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
  // Trait effects apply to initial stats/skills (definition order).
  let statsOut = stats;
  const skillsOut = skills;
  for (const trait of npc.traits ?? []) {
    for (const effect of trait.effects ?? []) {
      if (effect.kind === "stat" && effect.target === "player") {
        const name = effect.stat;
        const base = statsOut[name] ?? 0;
        const delta = effect.direction === "set" ? effect.value : base + (effect.direction === "remove" ? -effect.value : effect.value);
        const statDef = def.mechanics.stats.find((s) => s.name === name);
        statsOut = { ...statsOut, [name]: statDef ? Math.min(statDef.max, Math.max(statDef.min, delta)) : delta };
      }
    }
  }
  // Initial memories (npc.memory.initial) seeded with deterministic ids.
  const memories = (npc.memory?.initial ?? []).map((m, idx) =>
    createMemoryEntry(m.text, m.importance, 0, m.tags, `mem-${npc.id}-${idx}`),
  );
  return {
    id: npc.id,
    stats: statsOut,
    skills: skillsOut,
    needs,
    inventory: { stacks: (npc.items ?? []).map((itemId) => ({ itemId, quantity: 1 })), currency: 0 },
    relations,
    memories,
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
  // Exclusive leads become player flags (authors consume via conditions).
  const exclusiveFlags = (origin.exclusive_leads ?? []).map((lead) => `exclusive-lead:${lead}`);
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
    flags: [...(origin.starting_knowledge ?? []), ...exclusiveFlags],
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

  // NPC stats jitter + trait effects.
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

  // Secret holder randomization (worldgen.target secret_holder) — runtime
  // mapping (secretId -> npcId). The definition stays immutable.
  const secretEntry = worldgen.randomize.find((r) => r.target === "secret_holder");
  const secretHolders: Record<string, string> = {};
  for (const npcDef of def.npcs.values()) {
    for (const secret of npcDef.secrets ?? []) {
      secretHolders[secret.id] = npcDef.id;
    }
  }
  if (secretEntry?.pool && secretEntry.pool.length > 0) {
    const holderPool = secretEntry.pool;
    const picked = pickOne(rng, holderPool);
    const sourceNpc = [...def.npcs.values()].find((n) => (n.secrets?.length ?? 0) > 0);
    if (picked && sourceNpc && picked !== sourceNpc.id) {
      for (const secret of sourceNpc.secrets ?? []) {
        secretHolders[secret.id] = picked;
      }
      summary.push(`secret_holder randomized to ${picked}`);
    }
  }

  // Faction stance jitter (worldgen.target faction_stance) — documented
  // no-op: faction-vs-faction relations have no runtime consumer in v1.
  const stanceEntry = worldgen.randomize.find((r) => r.target === "faction_stance");
  if (stanceEntry) {
    summary.push("faction_stance randomization is a no-op in v1 (no runtime consumer)");
  }

  // NPC placement (worldgen.target npc_placement) — randomize initial home.
  const placementEntry = worldgen.randomize.find((r) => r.target === "npc_placement");
  if (placementEntry?.pool && placementEntry.pool.length > 0) {
    const allLocations = [...def.locations.keys()];
    if (allLocations.length > 0) {
      for (const id of placementEntry.pool) {
        const npc = npcs[id];
        if (npc) {
          npcs[id] = { ...npc, currentLocationId: pickOne(rng, allLocations) ?? npc.currentLocationId };
        }
      }
      summary.push("npc_placement randomized");
    }
  }

  // Item placement (worldgen.target item_placement) — place into a random location.
  const itemEntry = worldgen.randomize.find((r) => r.target === "item_placement");
  const locationInventories: Record<string, { stacks: { itemId: string; quantity: number }[]; currency: number }> = {};
  for (const loc of def.locations.values()) {
    locationInventories[loc.id] = {
      stacks: (loc.items ?? []).map((itemId) => ({ itemId, quantity: 1 })),
      currency: 0,
    };
  }
  if (itemEntry?.pool && itemEntry.pool.length > 0) {
    const allLocations = [...def.locations.keys()];
    if (allLocations.length > 0) {
      for (const id of itemEntry.pool) {
        const loc = pickOne(rng, allLocations);
        if (loc) {
          locationInventories[loc] = {
            ...locationInventories[loc],
            stacks: [...locationInventories[loc].stacks, { itemId: id, quantity: 1 }],
          };
        }
      }
      summary.push("item_placement randomized");
    }
  }

  // Starting event (worldgen.target starting_event)
  const eventEntry = worldgen.randomize.find((r) => r.target === "starting_event");
  let startingEvent: string | undefined;
  if (eventEntry?.pool && eventEntry.pool.length > 0) {
    const picked = pickOne(rng, eventEntry.pool);
    if (picked) {
      startingEvent = picked;
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
      lastEventDay: null,
      tension: Object.fromEntries(
        def.director.tension.variables.map((v) => [v.name, v.initial]),
      ),
    },
    rng,
    tasks: [],
    playedEventIds: [],
    eventLastPlayedDay: {},
    actionCooldowns: {},
    secretHolders,
    locationInventories,
    transcript: [],
  };

  return { state, summary, startingEvent };
}
