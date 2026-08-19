// WorldDefinition assembly helpers: build runtime-state-free index
// structures on top of the validated script data. Definitions are
// immutable — all mutable state lives in WorldState (types.ts).
import type {
  WorldDefinition,
  RelationState,
  ReputationState,
} from "./types";
import type { Npc } from "../script/schemas/npc";

/**
 * Builds the relation matrix base for an NPC from its script definition.
 * Relations are asymmetric (A->B may differ from B->A); the value is the
 * engine-owned fact source, the stance is the deterministic classification
 * layer derived from the value.
 */
export function valueToStance(value: number): string {
  if (value <= -60) return "hostile";
  if (value < -20) return "wary";
  if (value < 20) return "neutral";
  if (value < 60) return "friendly";
  return "allied";
}

/** Deterministic label for a numeric relationship value (classification layer). */
export function relationLabel(value: number): string {
  if (value <= -80) return "死敌";
  if (value <= -40) return "仇视";
  if (value <= -10) return "冷淡";
  if (value < 10) return "陌生";
  if (value < 40) return "友善";
  if (value < 70) return "亲近";
  return "挚友";
}

/** Deterministic label for a reputation value. */
export function reputationLabel(value: number): string {
  if (value <= -60) return "恶名昭著";
  if (value <= -20) return "声名狼藉";
  if (value < 20) return "籍籍无名";
  if (value < 60) return "小有名望";
  return "德高望重";
}

/** Builds relation states for an NPC from its script definition. */
export function buildNpcRelations(npc: Npc): RelationState[] {
  return (npc.relations ?? []).map((r) => ({
    npcId: r.target,
    value: r.value,
    stance: valueToStance(r.value),
    type: r.type,
    description: r.description,
  }));
}

/**
 * Builds the initial NPC runtime-state relation rows from a definition
 * (used when spawning an NPC runtime state).
 */
export function relationsFromDefinition(npc: Npc): RelationState[] {
  return buildNpcRelations(npc);
}

/** Builds reputation rows for an NPC from faction definitions it belongs to. */
export function reputationFromDefinition(
  definition: WorldDefinition,
  npcId: string,
): ReputationState[] {
  const out: ReputationState[] = [];
  for (const faction of definition.factions.values()) {
    if (faction.members.includes(npcId)) {
      out.push({ factionId: faction.id, value: 0 });
    }
  }
  return out;
}
