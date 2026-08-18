// Relation matrix runtime: bidirectional NPC<->NPC + NPC<->player edges.
// Values are asymmetric (A->B may differ from B->A — Sims/RimWorld model);
// the numeric value is the engine-owned fact source, the stance/label are
// the deterministic classification layer (descriptors are the explanation
// layer, managed by descriptors.ts).
import type { WorldState, RelationState, NpcState, PlayerState } from "./types";
import { valueToStance } from "./definition";

export const PLAYER_REF = "player";

/** Finds a relation edge from owner's relation list to a target. */
export function findRelation(
  relations: RelationState[],
  targetId: string,
): RelationState | undefined {
  return relations.find((r) => r.npcId === targetId);
}

/**
 * Sets/updates a relation edge on an owner (player or npc) immutably.
 * Marks the descriptor stale when one exists (lazy regeneration).
 */
export function setRelation(
  relations: RelationState[],
  targetId: string,
  value: number,
  type?: string,
  stance?: string,
): RelationState[] {
  const nextValue = Math.max(-100, Math.min(100, value));
  const existing = relations.find((r) => r.npcId === targetId);
  if (existing) {
    return relations.map((r) =>
      r.npcId === targetId
        ? {
            ...r,
            value: nextValue,
            stance: stance ?? valueToStance(nextValue),
            type: type ?? r.type,
            descriptor: r.descriptor ? { ...r.descriptor, stale: true } : undefined,
          }
        : r,
    );
  }
  return [
    ...relations,
    {
      npcId: targetId,
      value: nextValue,
      stance: stance ?? valueToStance(nextValue),
      type: type ?? "acquaintance",
    },
  ];
}

/** Adds a delta to an existing edge (creates with delta if absent). */
export function adjustRelation(
  relations: RelationState[],
  targetId: string,
  delta: number,
): RelationState[] {
  const current = findRelation(relations, targetId)?.value ?? 0;
  return setRelation(relations, targetId, current + delta);
}

/** Immutable player update helper. */
function updatePlayer(
  state: WorldState,
  fn: (p: PlayerState) => PlayerState,
): WorldState {
  return { ...state, player: fn(state.player) };
}

/** Immutable NPC update helper. */
function updateNpc(
  state: WorldState,
  npcId: string,
  fn: (n: NpcState) => NpcState,
): WorldState {
  const npc = state.npcs[npcId];
  if (!npc) return state;
  return { ...state, npcs: { ...state.npcs, [npcId]: fn(npc) } };
}

export interface RelationUpdate {
  owner: "player" | string;
  target: string;
  value: number;
}

/**
 * Applies a list of relation updates to the world state immutably.
 * Each update is one directed edge; reverse edges are NOT auto-synced
 * (asymmetric values are intentional — the engine decides both sides).
 */
export function applyRelationUpdates(
  state: WorldState,
  updates: RelationUpdate[],
): WorldState {
  let current = state;
  for (const u of updates) {
    if (u.owner === "player") {
      current = updatePlayer(current, (p) => ({
        ...p,
        relations: setRelation(p.relations, u.target, u.value),
      }));
    } else {
      const ownerId = u.owner;
      current = updateNpc(current, ownerId, (n) => ({
        ...n,
        relations: setRelation(n.relations, u.target, u.value),
      }));
    }
  }
  return current;
}

/** Returns the player's relation value toward an NPC (0 when absent). */
export function playerRelationValue(state: WorldState, npcId: string): number {
  return findRelation(state.player.relations, npcId)?.value ?? 0;
}

/** Returns an NPC's relation value toward the player (0 when absent). */
export function npcRelationValue(state: WorldState, npcId: string): number {
  const npc = state.npcs[npcId];
  return npc ? findRelation(npc.relations, PLAYER_REF)?.value ?? 0 : 0;
}


/** Whether two NPCs are in the same location (used by legality checks). */
export function sameLocation(state: WorldState, aId: string, bId: string): boolean {
  if (aId === PLAYER_REF) {
    return state.player.locationId === state.npcs[bId]?.currentLocationId;
  }
  if (bId === PLAYER_REF) {
    return state.npcs[aId]?.currentLocationId === state.player.locationId;
  }
  return state.npcs[aId]?.currentLocationId === state.npcs[bId]?.currentLocationId;
}
