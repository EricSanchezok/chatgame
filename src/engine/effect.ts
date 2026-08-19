// Effect algebra executor: applies script effect objects to world state.
// Pure immutable updates; ResultGrade coefficients scale numeric effects
// (partial = 0.5x, crit = 2x). The engine is the only writer of state
// (I1/I5): this module is the single funnel for state changes.
import type { Effect } from "../script/schemas/common";
import { isBuiltinEffect } from "../script/schemas/common";
import type { MemoryEntry, ResultGrade, WorldState } from "./types";
import type { WorldDefinition } from "./types";
import { valueToStance } from "./definition";
import { INITIAL_STRENGTH } from "./memory";

/** Coefficient applied to numeric effect values by result grade. */
export function gradeMultiplier(grade: ResultGrade): number {
  switch (grade) {
    case "partial":
      return 0.5;
    case "crit":
      return 2;
    default:
      return 1;
  }
}

export interface EffectContext {
  definition: WorldDefinition;
  /** Result grade scaling numeric effects. */
  grade: ResultGrade;
  /** Current absolute day (for memory/status timestamps). */
  day: number;
}

export interface EffectOutcome {
  state: WorldState;
  /** Human-readable summaries of what changed (auditable). */
  summaries: string[];
}

/** Immutably updates the player state via a transformer. */
function updatePlayer(
  state: WorldState,
  fn: (p: WorldState["player"]) => WorldState["player"],
): WorldState {
  return { ...state, player: fn(state.player) };
}

/** Immutably updates one NPC state via a transformer. */
function updateNpc(
  state: WorldState,
  npcId: string,
  fn: (n: WorldState["npcs"][string]) => WorldState["npcs"][string],
): WorldState {
  const npc = state.npcs[npcId];
  if (!npc) return state;
  return { ...state, npcs: { ...state.npcs, [npcId]: fn(npc) } };
}

/** Clamps a numeric value to [min, max] from the definition (if declared). */
function clampStat(ctx: EffectContext, name: string, value: number): number {
  const stat = ctx.definition.mechanics.stats.find((s) => s.name === name);
  if (!stat) return value;
  return Math.min(stat.max, Math.max(stat.min, value));
}

function clampSkill(ctx: EffectContext, name: string, value: number): number {
  const skill = ctx.definition.mechanics.skills?.find((s) => s.name === name);
  if (!skill) return value;
  return Math.min(skill.max, Math.max(skill.min, value));
}

function clampNeed(ctx: EffectContext, name: string, value: number): number {
  const need = ctx.definition.mechanics.needs?.find((s) => s.name === name);
  if (!need) return value;
  return Math.min(need.max, Math.max(need.min, value));
}

/** Scales a numeric value by the grade multiplier and rounds to integer. */
function scaled(ctx: EffectContext, value: number): number {
  return Math.round(value * gradeMultiplier(ctx.grade));
}

// ---------------------------------------------------------------------------
// Numeric effects (stat / skill / need / currency / item)
// ---------------------------------------------------------------------------

function applyStat(
  state: WorldState,
  ctx: EffectContext,
  target: string,
  stat: string,
  direction: "add" | "remove" | "set",
  value: number,
): { state: WorldState; summary: string } {
  const delta = scaled(ctx, value);
  const apply = (map: Record<string, number>): Record<string, number> => {
    const current = map[stat] ?? 0;
    const next =
      direction === "set" ? delta : current + (direction === "remove" ? -delta : delta);
    return { ...map, [stat]: clampStat(ctx, stat, next) };
  };
  if (target === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, stats: apply(p.stats) })),
      summary: `player stat ${stat} ${direction} ${delta}`,
    };
  }
  return {
    state: updateNpc(state, target, (n) => ({ ...n, stats: apply(n.stats) })),
    summary: `${target} stat ${stat} ${direction} ${delta}`,
  };
}

function applySkill(
  state: WorldState,
  ctx: EffectContext,
  target: string,
  skill: string,
  direction: "add" | "remove" | "set",
  value: number,
): { state: WorldState; summary: string } {
  const delta = scaled(ctx, value);
  const apply = (map: Record<string, number>): Record<string, number> => {
    const current = map[skill] ?? 0;
    const next =
      direction === "set" ? delta : current + (direction === "remove" ? -delta : delta);
    return { ...map, [skill]: clampSkill(ctx, skill, next) };
  };
  if (target === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, skills: apply(p.skills) })),
      summary: `player skill ${skill} ${direction} ${delta}`,
    };
  }
  return {
    state: updateNpc(state, target, (n) => ({ ...n, skills: apply(n.skills) })),
    summary: `${target} skill ${skill} ${direction} ${delta}`,
  };
}

function applyNeed(
  state: WorldState,
  ctx: EffectContext,
  target: string,
  need: string,
  direction: "add" | "remove" | "set",
  value: number,
): { state: WorldState; summary: string } {
  const delta = scaled(ctx, value);
  const apply = (
    needs: WorldState["player"]["needs"],
  ): WorldState["player"]["needs"] => {
    const current = needs[need]?.value ?? 0;
    const next =
      direction === "set" ? delta : current + (direction === "remove" ? -delta : delta);
    return {
      ...needs,
      [need]: {
        value: clampNeed(ctx, need, next),
        descriptor: needs[need]?.descriptor
          ? { ...needs[need].descriptor!, stale: true }
          : undefined,
      },
    };
  };
  if (target === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, needs: apply(p.needs) })),
      summary: `player need ${need} ${direction} ${delta}`,
    };
  }
  return {
    state: updateNpc(state, target, (n) => ({ ...n, needs: apply(n.needs) })),
    summary: `${target} need ${need} ${direction} ${delta}`,
  };
}

function applyCurrency(
  state: WorldState,
  ctx: EffectContext,
  target: string,
  direction: "add" | "remove" | "set",
  value: number,
): { state: WorldState; summary: string } {
  const delta = scaled(ctx, value);
  const apply = (inv: WorldState["player"]["inventory"]): WorldState["player"]["inventory"] => {
    const current = inv.currency;
    const next =
      direction === "set"
        ? delta
        : Math.max(0, current + (direction === "remove" ? -delta : delta));
    return { ...inv, currency: next };
  };
  if (target === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, inventory: apply(p.inventory) })),
      summary: `player currency ${direction} ${delta}`,
    };
  }
  return {
    state: updateNpc(state, target, (n) => ({ ...n, inventory: apply(n.inventory) })),
    summary: `${target} currency ${direction} ${delta}`,
  };
}

function applyItem(
  state: WorldState,
  ctx: EffectContext,
  target: string,
  item: string,
  direction: "add" | "remove" | "set",
  value: number | undefined,
): { state: WorldState; summary: string } {
  const qty = scaled(ctx, value ?? 1);
  const apply = (inv: WorldState["player"]["inventory"]): WorldState["player"]["inventory"] => {
    const stacks = inv.stacks.map((s) => ({ ...s }));
    const existing = stacks.find((s) => s.itemId === item);
    if (direction === "set") {
      if (qty <= 0) {
        return { ...inv, stacks: stacks.filter((s) => s.itemId !== item) };
      }
      if (existing) existing.quantity = qty;
      else stacks.push({ itemId: item, quantity: qty });
      return { ...inv, stacks };
    }
    const delta = direction === "remove" ? -qty : qty;
    if (existing) {
      existing.quantity += delta;
      if (existing.quantity <= 0) {
        return { ...inv, stacks: stacks.filter((s) => s.itemId !== item) };
      }
      return { ...inv, stacks };
    }
    if (delta > 0) {
      stacks.push({ itemId: item, quantity: delta });
      return { ...inv, stacks };
    }
    return inv;
  };
  if (target === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, inventory: apply(p.inventory) })),
      summary: `player item ${item} ${direction} ${qty}`,
    };
  }
  return {
    state: updateNpc(state, target, (n) => ({ ...n, inventory: apply(n.inventory) })),
    summary: `${target} item ${item} ${direction} ${qty}`,
  };
}

// ---------------------------------------------------------------------------
// Relational effects (relation / reputation)
// ---------------------------------------------------------------------------

function upsertRelation(
  rels: WorldState["player"]["relations"],
  npcId: string,
  value: number,
  type?: string,
): WorldState["player"]["relations"] {
  const existing = rels.find((r) => r.npcId === npcId);
  const nextValue = Math.max(-100, Math.min(100, value));
  if (existing) {
    // Semantic label (type) is authored/managed by the script or the LLM
    // layer — the engine never overwrites it. Only the deterministic stance
    // (classification layer) tracks the value, and the descriptor is marked
    // stale so the LLM can re-explain the changed value.
    return rels.map((r) =>
      r.npcId === npcId
        ? {
            ...r,
            value: nextValue,
            stance: valueToStance(nextValue),
            type: type ?? r.type,
            descriptor: r.descriptor ? { ...r.descriptor, stale: true } : undefined,
          }
        : r,
    );
  }
  return [
    ...rels,
    { npcId, value: nextValue, stance: valueToStance(nextValue), type: type ?? "acquaintance" },
  ];
}

function applyRelation(
  state: WorldState,
  ctx: EffectContext,
  owner: string,
  npcId: string,
  direction: "add" | "remove" | "set",
  value: number,
): { state: WorldState; summary: string } {
  const delta = scaled(ctx, value);
  const apply = (rels: WorldState["player"]["relations"]): WorldState["player"]["relations"] => {
    const current = rels.find((r) => r.npcId === npcId)?.value ?? 0;
    const next =
      direction === "set" ? delta : current + (direction === "remove" ? -delta : delta);
    return upsertRelation(rels, npcId, next);
  };
  if (owner === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, relations: apply(p.relations) })),
      summary: `player relation ${npcId} ${direction} ${delta}`,
    };
  }
  return {
    state: updateNpc(state, owner, (n) => ({ ...n, relations: apply(n.relations) })),
    summary: `${owner} relation ${npcId} ${direction} ${delta}`,
  };
}

function applyReputation(
  state: WorldState,
  ctx: EffectContext,
  owner: string,
  factionId: string,
  direction: "add" | "remove" | "set",
  value: number,
): { state: WorldState; summary: string } {
  const delta = scaled(ctx, value);
  const apply = (
    reps: WorldState["player"]["reputation"],
  ): WorldState["player"]["reputation"] => {
    const existing = reps.find((r) => r.factionId === factionId);
    const current = existing?.value ?? 0;
    const next = Math.max(
      -100,
      Math.min(100, direction === "set" ? delta : current + (direction === "remove" ? -delta : delta)),
    );
    const row = {
      factionId,
      value: next,
      descriptor: existing?.descriptor ? { ...existing.descriptor, stale: true } : undefined,
    };
    return existing ? reps.map((r) => (r.factionId === factionId ? row : r)) : [...reps, row];
  };
  if (owner === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, reputation: apply(p.reputation) })),
      summary: `player reputation ${factionId} ${direction} ${delta}`,
    };
  }
  return {
    state: updateNpc(state, owner, (n) => ({ ...n, reputation: apply(n.reputation) })),
    summary: `${owner} reputation ${factionId} ${direction} ${delta}`,
  };
}

// ---------------------------------------------------------------------------
// State effects (flag / teleport / status / memory / secret / event / narrative)
// ---------------------------------------------------------------------------

function applyFlag(
  state: WorldState,
  target: string,
  flag: string,
  direction: "add" | "remove" | "set",
): { state: WorldState; summary: string } {
  const add = direction !== "remove";
  if (target === "player") {
    const flags = add
      ? state.player.flags.includes(flag)
        ? state.player.flags
        : [...state.player.flags, flag]
      : state.player.flags.filter((f) => f !== flag);
    return {
      state: updatePlayer(state, (p) => ({ ...p, flags })),
      summary: `player flag ${flag} ${add ? "set" : "cleared"}`,
    };
  }
  // World-level flags when target is "world" or any non-player entity
  const flags = add
    ? state.flags.includes(flag)
      ? state.flags
      : [...state.flags, flag]
    : state.flags.filter((f) => f !== flag);
  return { state: { ...state, flags }, summary: `world flag ${flag} ${add ? "set" : "cleared"}` };
}

function applyTeleport(
  state: WorldState,
  target: string,
  location: string,
): { state: WorldState; summary: string } {
  if (target === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, locationId: location })),
      summary: `player teleported to ${location}`,
    };
  }
  return {
    state: updateNpc(state, target, (n) => ({ ...n, currentLocationId: location })),
    summary: `${target} teleported to ${location}`,
  };
}

function applyStatus(
  state: WorldState,
  ctx: EffectContext,
  target: string,
  statusId: string,
  direction: "add" | "remove" | "set",
): { state: WorldState; summary: string } {
  const statusDef = ctx.definition.mechanics.status_effects?.find((s) => s.id === statusId);
  const duration = statusDef?.duration ?? null;
  const apply = (
    statuses: WorldState["player"]["statuses"],
  ): WorldState["player"]["statuses"] => {
    const existing = statuses.find((s) => s.statusId === statusId);
    if (direction === "remove") return statuses.filter((s) => s.statusId !== statusId);
    if (existing) {
      const stacks = statusDef?.stackable ? existing.stacks + 1 : existing.stacks;
      return statuses.map((s) =>
        s.statusId === statusId
          ? {
              ...s,
              stacks,
              descriptor: s.descriptor ? { ...s.descriptor, stale: true } : undefined,
            }
          : s,
      );
    }
    return [...statuses, { statusId, remainingTicks: duration, stacks: 1 }];
  };
  if (target === "player") {
    return {
      state: updatePlayer(state, (p) => ({ ...p, statuses: apply(p.statuses) })),
      summary: `player status ${statusId} ${direction}`,
    };
  }
  return {
    state: updateNpc(state, target, (n) => ({ ...n, statuses: apply(n.statuses) })),
    summary: `${target} status ${statusId} ${direction}`,
  };
}

function applyMemory(
  state: WorldState,
  ctx: EffectContext,
  target: string,
  text: string,
  importance: "major" | "minor" | "trivial" | undefined,
  tags: string[] = [],
  replaces?: string,
): { state: WorldState; summary: string } {
  const build = (
    memories: MemoryEntry[],
  ): { memories: MemoryEntry[]; entry: MemoryEntry } => {
    // Deterministic, batch-unique id: actor list length is monotonically
    // increasing (memories are never physically removed) and the target
    // prefix keeps actors distinct. Replaces the old eventLog-length scheme
    // which collided within a single effects batch / nested events.
    const id = `${target}-mem-${ctx.day}-${memories.length}`;
    const entry: MemoryEntry = {
      id,
      text,
      importance: importance ?? "minor",
      tags,
      createdAtDay: ctx.day,
      strength: INITIAL_STRENGTH[importance ?? "minor"],
      lastAccessedDay: null,
      lastDecayDay: ctx.day,
      archived: false,
    };
    let next = memories;
    if (replaces !== undefined) {
      next = next.map((m) =>
        m.id === replaces && !m.archived ? { ...m, archived: true, supersededBy: id } : m,
      );
    }
    return { memories: [...next, entry], entry };
  };
  if (target === "player") {
    return {
      state: updatePlayer(state, (p) => {
        const { memories } = build(p.memories);
        return { ...p, memories };
      }),
      summary: "player memory added",
    };
  }
  return {
    state: updateNpc(state, target, (n) => {
      const { memories } = build(n.memories);
      return { ...n, memories };
    }),
    summary: `${target} memory added`,
  };
}

function applySecret(
  state: WorldState,
  target: string,
  secretId: string,
): { state: WorldState; summary: string } {
  // Secrets revealed to the player become world facts (knowledge filter uses
  // these). NPCs record the reveal on themselves.
  if (target === "player") {
    const facts = state.facts.includes(secretId) ? state.facts : [...state.facts, secretId];
    return {
      state: {
        ...state,
        facts,
        npcs: Object.fromEntries(
          Object.entries(state.npcs).map(([id, n]) => [
            id,
            n.revealedSecrets.includes(secretId)
              ? n
              : { ...n, revealedSecrets: [...n.revealedSecrets, secretId] },
          ]),
        ),
      },
      summary: `secret ${secretId} revealed`,
    };
  }
  return { state, summary: `secret ${secretId} (no-op target ${target})` };
}


// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export interface ApplyEffectsOptions {
  definition: WorldDefinition;
  grade?: ResultGrade;
  day: number;
  /**
   * Optional event-playback hook: called for each event-kind effect so the
   * events layer can play it (with its own depth guard). When omitted,
   * event-kind effects are recorded as summaries only (no playback).
   */
  onEvent?: (eventId: string) => WorldState;
}

/** Applies a list of effects immutably; returns new state + summaries. */
export function applyEffects(
  state: WorldState,
  effects: Effect[],
  options: ApplyEffectsOptions,
): EffectOutcome {
  let current = state;
  const summaries: string[] = [];
  const ctx: EffectContext = {
    definition: options.definition,
    grade: options.grade ?? "success",
    day: options.day,
  };

  for (const effect of effects) {
    // Custom effect kinds are dispatched to the script's engine extension.
    // Unregistered kinds are skipped with a summary (the validator reports
    // them as errors at load time, so this is a runtime-only safety net).
    if (!isBuiltinEffect(effect)) {
      const handler = options.definition.extensions?.effects[effect.kind];
      if (handler) {
        const out = handler(current, effect, ctx);
        current = out.state;
        summaries.push(...out.summaries);
      } else {
        summaries.push(`custom effect "${effect.kind}" has no registered handler`);
      }
      continue;
    }
    const direction = effect.direction ?? "add";
    switch (effect.kind) {
      case "stat": {
        const out = applyStat(current, ctx, effect.target, effect.stat, direction, effect.value);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "skill": {
        const out = applySkill(current, ctx, effect.target, effect.skill, direction, effect.value);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "need": {
        const out = applyNeed(current, ctx, effect.target, effect.need, direction, effect.value);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "item": {
        const out = applyItem(current, ctx, effect.target, effect.item, direction, effect.value);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "currency": {
        const out = applyCurrency(current, ctx, effect.target, direction, effect.value);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "relation": {
        const out = applyRelation(current, ctx, effect.target, effect.npc, direction, effect.value);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "reputation": {
        const out = applyReputation(current, ctx, effect.target, effect.faction, direction, effect.value);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "flag": {
        const out = applyFlag(current, effect.target, effect.flag, direction);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "teleport": {
        const out = applyTeleport(current, effect.target, effect.location);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "status": {
        const out = applyStatus(current, ctx, effect.target, effect.status, direction);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "memory": {
        const out = applyMemory(
          current,
          ctx,
          effect.target,
          effect.text,
          effect.importance,
          effect.tags,
          effect.replaces,
        );
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "secret": {
        const out = applySecret(current, effect.target, effect.secret);
        current = out.state;
        summaries.push(out.summary);
        break;
      }
      case "event": {
        current = options.onEvent ? options.onEvent(effect.event) : current;
        summaries.push(`event ${effect.event} played`);
        break;
      }
      case "narrative":
        // Pure narrative hint — no state change (I6: prose never mutates state).
        summaries.push(`narrative: ${effect.text.slice(0, 40)}`);
        break;
    }
  }

  return { state: current, summaries };
}
