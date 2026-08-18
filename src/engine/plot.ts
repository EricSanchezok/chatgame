// Commitment system (plot.yaml): the "world gravity" — events that MUST
// happen, with deadlines and on_miss escalation. The engine tracks
// commitment state and fires related events/secrets deterministically
// (NCP-Bench evidence: LLM alone cannot keep commitments — the engine must).
import type { WorldState, CommitmentState, EventLogEntry } from "./types";
import type { WorldDefinition } from "./types";
import type { Plot } from "../script/schemas/plot";

/** The commitment definition type (from plot schema). */
type CommitmentDef = Plot["commitments"][number];
import { evalCondition, type ConditionContext } from "./condition";
import { applyEffects } from "./effect";
import { absoluteDay } from "./time";

export interface CommitmentCheckResult {
  state: WorldState;
  /** Commitments that fired this turn. */
  fired: string[];
  /** Commitments whose deadline was missed this turn. */
  missed: string[];
  /** New event-log entries. */
  logEntries: EventLogEntry[];
}

/** Evaluates a commitment trigger (time or condition). */
export function commitmentTriggerFires(
  commitment: CommitmentDef,
  ctx: ConditionContext,
): boolean {
  const trigger = commitment.trigger;
  if (trigger.time) {
    const clock = ctx.state.clock;
    const dayMatch = trigger.time.day === clock.day;
    const monthMatch = trigger.time.month === undefined || trigger.time.month === clock.month;
    const hourMatch = trigger.time.hour === undefined || trigger.time.hour === clock.hour;
    if (dayMatch && monthMatch && hourMatch) return true;
  }
  if (trigger.condition) {
    if (evalCondition(trigger.condition, ctx)) return true;
  }
  return false;
}

/** Checks whether a commitment's deadline has passed (time-based only). */
export function deadlinePassed(
  commitment: CommitmentDef,
  state: WorldState,
  definition: WorldDefinition,
): boolean {
  const deadline = commitment.deadline;
  if (!deadline?.time) return false;
  const targetDay = deadline.time.day;
  const today = absoluteDay(definition, state.clock);
  return today > targetDay;
}

/**
 * Checks all commitments: fires triggered ones (applying effects + related
 * events), and applies on_miss escalation for missed deadlines. Pure
 * immutable update.
 */
export function checkCommitments(
  state: WorldState,
  definition: WorldDefinition,
): CommitmentCheckResult {
  let current = state;
  const fired: string[] = [];
  const missed: string[] = [];
  const logEntries: EventLogEntry[] = [];
  const day = absoluteDay(definition, state.clock);

  const commitments = state.commitments;
  for (const commitment of definition.plot.commitments) {
    const cs = commitments.find((c) => c.commitmentId === commitment.id);
    if (!cs || cs.triggered) continue;

    const ctx: ConditionContext = { definition, state: current };
    const fires = commitmentTriggerFires(commitment, ctx);
    if (fires) {
      // Fire: mark triggered, apply effects, queue related events.
      current = {
        ...current,
        commitments: commitments.map((c) =>
          c.commitmentId === commitment.id ? { ...c, triggered: true, triggeredAtDay: day } : c,
        ),
      };
      fired.push(commitment.id);
      logEntries.push({
        id: `log-${current.eventLog.length + 1}`,
        day,
        hour: current.clock.hour,
        type: "commitment",
        actor: "system",
        summary: `commitment "${commitment.id}" fired`,
      });
      // Related events become active (available to the director/narrative).
      for (const eventId of commitment.related?.events ?? []) {
        if (!current.activeEventIds.includes(eventId)) {
          current = { ...current, activeEventIds: [...current.activeEventIds, eventId] };
        }
      }
      continue;
    }

    // Deadline miss (only when not fired).
    if (commitment.deadline && deadlinePassed(commitment, current, definition)) {
      const cs2 = current.commitments.find((c) => c.commitmentId === commitment.id);
      if (cs2 && !cs2.triggered && !cs2.deadlineMissed) {
        current = {
          ...current,
          commitments: current.commitments.map((c) =>
            c.commitmentId === commitment.id ? { ...c, deadlineMissed: true } : c,
          ),
        };
        missed.push(commitment.id);
        const onMiss = commitment.deadline?.on_miss;
        if (onMiss) {
          const out = applyEffects(current, onMiss.effects, { definition, day });
          current = out.state;
          logEntries.push({
            id: `log-${current.eventLog.length + 1}`,
            day,
            hour: current.clock.hour,
            type: "commitment",
            actor: "system",
            summary: `commitment "${commitment.id}" deadline missed: ${onMiss.escalation_text}`,
          });
        }
      }
    }
  }

  return { state: current, fired, missed, logEntries };
}

/**
 * Secret reveal guard: returns true when the NPC's secret may be narrated
 * to the player (reveal condition met OR already revealed). The LLM layer
 * consults this before writing secrets into narrative (anti-spoiler).
 */
export function secretRevealable(
  state: WorldState,
  definition: WorldDefinition,
  npcId: string,
  secretId: string,
): boolean {
  // Already revealed to the player -> fine.
  if (state.facts.includes(secretId)) return true;
  const npcDef = definition.npcs.get(npcId);
  const secret = npcDef?.secrets?.find((s) => s.id === secretId);
  if (!secret) return false;
  return evalCondition(secret.reveal.logic, { definition, state, selfNpcId: npcId });
}

/** Returns the list of secrets the player may currently know for an NPC. */
export function revealableSecrets(
  state: WorldState,
  definition: WorldDefinition,
  npcId: string,
): string[] {
  const npcDef = definition.npcs.get(npcId);
  if (!npcDef?.secrets) return [];
  return npcDef.secrets
    .filter((s) => secretRevealable(state, definition, npcId, s.id))
    .map((s) => s.id);
}

/** Returns a commitment state by id (undefined when absent). */
export function commitmentState(
  state: WorldState,
  commitmentId: string,
): CommitmentState | undefined {
  return state.commitments.find((c) => c.commitmentId === commitmentId);
}
