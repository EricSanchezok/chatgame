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
import { playEvent } from "./events";

export interface CommitmentCheckResult {
  state: WorldState;
  /** Commitments that fired this turn. */
  fired: string[];
  /** Commitments whose deadline was missed this turn. */
  missed: string[];
  /** Narrative texts of related events played by fired commitments. */
  eventTexts: string[];
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

/** Checks whether a commitment's deadline has passed (time or condition). */
export function deadlinePassed(
  commitment: CommitmentDef,
  state: WorldState,
  definition: WorldDefinition,
): boolean {
  const deadline = commitment.deadline;
  if (!deadline) return false;
  if (deadline.time) {
    const targetDay = deadline.time.day;
    const today = absoluteDay(definition, state.clock);
    if (today > targetDay) return true;
  }
  if (deadline.condition) {
    const ctx: ConditionContext = { definition, state };
    if (evalCondition(deadline.condition, ctx)) return true;
  }
  return false;
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
  const eventTexts: string[] = [];
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
      const firedLog: EventLogEntry = {
        id: `log-${current.eventLog.length + 1}`,
        day,
        hour: current.clock.hour,
        type: "commitment",
        actor: "system",
        summary: `commitment "${commitment.id}" fired`,
      };
      current = { ...current, eventLog: [...current.eventLog, firedLog] };
      logEntries.push(firedLog);
      // Related events play immediately (with the events layer's depth guard).
      for (const eventId of commitment.related?.events ?? []) {
        const out = playEvent(current, definition, eventId);
        current = out.state;
        if (out.played) {
          logEntries.push(...out.logEntries);
          if (out.text) eventTexts.push(out.text);
        }
      }
      // Related secrets reveal to the player (become world facts).
      for (const secretId of commitment.related?.secrets ?? []) {
        const out = applyEffects(current, [{ kind: "secret", target: "player", secret: secretId }], { definition, day });
        current = out.state;
        const secretLog: EventLogEntry = {
          id: `log-${current.eventLog.length + 1}`,
          day,
          hour: current.clock.hour,
          type: "commitment",
          actor: "system",
          summary: `commitment "${commitment.id}" revealed secret "${secretId}"`,
        };
        current = { ...current, eventLog: [...current.eventLog, secretLog] };
        logEntries.push(secretLog);
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
          const missLog: EventLogEntry = {
            id: `log-${current.eventLog.length + 1}`,
            day,
            hour: current.clock.hour,
            type: "commitment",
            actor: "system",
            summary: `commitment "${commitment.id}" deadline missed: ${onMiss.escalation_text}`,
          };
          current = { ...current, eventLog: [...current.eventLog, missLog] };
          logEntries.push(missLog);
        }
      }
    }
  }

  return { state: current, fired, missed, eventTexts, logEntries };
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
  if (state.secretHolders[secretId] !== npcId) return false;
  // Already revealed to the player -> fine.
  if (state.facts.includes(secretId)) return true;
  const secret = secretDefinition(definition, secretId);
  if (!secret) return false;
  return evalCondition(secret.reveal.logic, { definition, state, selfNpcId: npcId });
}

export function secretDefinition(
  definition: WorldDefinition,
  secretId: string,
) {
  return [...definition.npcs.values()]
    .flatMap((npc) => npc.secrets ?? [])
    .find((entry) => entry.id === secretId);
}

/** Returns the list of secrets the player may currently know for an NPC. */
export function revealableSecrets(
  state: WorldState,
  definition: WorldDefinition,
  npcId: string,
): string[] {
  return Object.entries(state.secretHolders)
    .filter(([, holder]) => holder === npcId)
    .map(([secretId]) => secretId)
    .filter((secretId) => secretRevealable(state, definition, npcId, secretId));
}

/** Revealable definitions, resolved independently from their runtime holder. */
export function revealableSecretDefinitions(
  state: WorldState,
  definition: WorldDefinition,
  npcId: string,
) {
  return revealableSecrets(state, definition, npcId)
    .map((secretId) => secretDefinition(definition, secretId))
    .filter((secret): secret is NonNullable<typeof secret> => secret !== undefined);
}

/** Returns a commitment state by id (undefined when absent). */
export function commitmentState(
  state: WorldState,
  commitmentId: string,
): CommitmentState | undefined {
  return state.commitments.find((c) => c.commitmentId === commitmentId);
}
